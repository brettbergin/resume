/*
 * Cookie parser and security checks: paste a `Set-Cookie` response header or a
 * `Cookie` request header and see, per cookie, which of the attributes that
 * matter for security are set — `Secure`, `HttpOnly`, `SameSite`, `Domain`,
 * `Path` — and whether the expiry makes it a session cookie or a persistent
 * one.
 *
 * `analyzeCookie` is exported on its own, separate from the `Tool` object,
 * because the HTTP header grader (`./headers.ts`) needs the same per-cookie
 * analysis for the `Set-Cookie` rows in its report — duplicating the attribute
 * checks there would drift the moment either copy changed a rule.
 *
 * A `Set-Cookie` header and a `Cookie` header share a `name=value` shape but
 * mean different things: the former is what a server asked for, complete with
 * the attributes it set; the latter is what a browser is sending back, which
 * is only ever `name=value` pairs — a real browser never echoes `Secure` or
 * `HttpOnly` back to the server, because those attributes are not something
 * script or the request line can see. Treating a `Cookie` header as if its
 * *absent* attributes meant "the server did not set them" would be reporting
 * a false negative as a finding, so the two forms are parsed by two different
 * functions and analysis is told which one it is looking at.
 */

import type { Tool, ToolField, ToolOptions, ToolResult } from './types.ts'

/** One `Set-Cookie` header value, parsed into its name/value pair and its
 * attributes. Attribute keys are lower-cased on the way in — the spec treats
 * `Secure`, `secure` and `SECURE` identically, and a `Map` keyed inconsistently
 * would make every lookup a case dance. A boolean attribute (`Secure`,
 * `HttpOnly`) maps to `true` rather than `''`, so a caller can tell "present
 * with no value" apart from "present with an empty value" — no real attribute
 * takes an empty value, but the distinction is free to keep. */
export interface ParsedSetCookie {
  name: string
  value: string
  attributes: Map<string, string | true>
}

/** One pair out of a `Cookie` request header — just a name and a value, since
 * that is all a request header ever carries. */
export interface ParsedCookiePair {
  name: string
  value: string
}

const SET_COOKIE_PREFIX = /^set-cookie:\s*/i
const COOKIE_PREFIX = /^cookie:\s*/i

/** Attribute keywords that mark a semicolon-separated list as a `Set-Cookie`
 * value rather than a `Cookie` header's plain name=value pairs. Matched
 * case-insensitively, since a header value's attribute casing is not
 * normative. */
const KNOWN_ATTRIBUTES = ['secure', 'httponly', 'samesite', 'path', 'domain', 'expires', 'max-age']

const ATTRIBUTE_AFTER_SEMICOLON = new RegExp(
  `;\\s*(${KNOWN_ATTRIBUTES.join('|')})\\b`,
  'i',
)

function splitNameValue(part: string): { name: string; value: string } {
  const eq = part.indexOf('=')
  if (eq === -1) return { name: part.trim(), value: '' }
  return { name: part.slice(0, eq).trim(), value: part.slice(eq + 1).trim() }
}

/** Parse one `Set-Cookie` header value (with or without the `Set-Cookie:`
 * prefix) into its name, value and attributes. Malformed input degrades
 * gracefully — a line with no `=` becomes a cookie with an empty value rather
 * than throwing, since a pasted header is attacker- or typo-supplied text. */
export function parseSetCookieHeader(line: string): ParsedSetCookie {
  const stripped = line.replace(SET_COOKIE_PREFIX, '').trim()
  const parts = stripped
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part !== '')

  const [nameValuePart, ...attributeParts] = parts
  const { name, value } = splitNameValue(nameValuePart ?? '')

  const attributes = new Map<string, string | true>()
  for (const part of attributeParts) {
    const eq = part.indexOf('=')
    if (eq === -1) {
      attributes.set(part.toLowerCase(), true)
    } else {
      const key = part.slice(0, eq).trim().toLowerCase()
      const attributeValue = part.slice(eq + 1).trim()
      attributes.set(key, attributeValue)
    }
  }

  return { name, value, attributes }
}

/** Parse a `Cookie` request header (with or without the `Cookie:` prefix)
 * into its semicolon-separated `name=value` pairs. There are no attributes to
 * parse — a request header never carries one. */
export function parseCookieHeader(line: string): ParsedCookiePair[] {
  const stripped = line.replace(COOKIE_PREFIX, '').trim()
  if (stripped === '') return []

  return stripped
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .map((part) => splitNameValue(part))
}

/** Which header form a line is, decided the way the task describes: an
 * explicit `Set-Cookie:` / `Cookie:` prefix wins outright, and otherwise a
 * known attribute keyword right after a `;` marks it as a `Set-Cookie` value
 * — a `Cookie` header is bare `name=value` pairs and never carries one. */
export function detectHeaderKind(input: string): 'set-cookie' | 'cookie' {
  const trimmed = input.trim()
  if (/^set-cookie:/i.test(trimmed)) return 'set-cookie'
  if (/^cookie:/i.test(trimmed)) return 'cookie'
  return ATTRIBUTE_AFTER_SEMICOLON.test(trimmed) ? 'set-cookie' : 'cookie'
}

/** The verdict on one cookie: its observable attributes, its expiry, and
 * whatever is worth flagging about it. `domainScopeUnknown` is set when the
 * cookie carries a `Domain` but no comparison host was given — the analysis
 * cannot say whether the scope is wider than intended, and that is a
 * different thing from the scope having been checked and found fine. */
export interface CookieAnalysis {
  name: string
  value: string
  secure: boolean
  httpOnly: boolean
  sameSite: string | null
  domain: string | null
  path: string | null
  expiry: string
  isSession: boolean
  domainScopeUnknown: boolean
  warnings: string[]
}

const utf8 = new TextEncoder()

/** The byte ceiling most browsers enforce per cookie (name + value, not
 * counting attributes) — RFC 6265's suggested minimum a server can rely on. */
const MAX_COOKIE_BYTES = 4096

function attribute(attributes: Map<string, string | true>, key: string): string | true | undefined {
  return attributes.get(key.toLowerCase())
}

function stringAttribute(attributes: Map<string, string | true>, key: string): string | null {
  const value = attribute(attributes, key)
  return typeof value === 'string' ? value : null
}

/** An absolute expiry from `Max-Age` (seconds from now) or `Expires` (an
 * HTTP-date), or `'session'` when neither is present — a cookie with no
 * expiry attribute is deleted when the browser session ends. `Max-Age` takes
 * priority when both are present, matching every real implementation of the
 * spec. An attribute present but unparseable (a non-numeric `Max-Age`, an
 * invalid `Expires` date) is treated as absent rather than thrown on. */
function resolveExpiry(attributes: Map<string, string | true>): { expiry: string; isSession: boolean } {
  const maxAge = stringAttribute(attributes, 'max-age')
  if (maxAge !== null && maxAge.trim() !== '') {
    const seconds = Number(maxAge)
    if (Number.isFinite(seconds)) {
      return { expiry: new Date(Date.now() + seconds * 1000).toISOString(), isSession: false }
    }
  }

  const expires = stringAttribute(attributes, 'expires')
  if (expires !== null && expires.trim() !== '') {
    const date = new Date(expires)
    if (!Number.isNaN(date.getTime())) {
      return { expiry: date.toISOString(), isSession: false }
    }
  }

  return { expiry: 'session', isSession: true }
}

/** Whether `host` is covered by a cookie's `Domain` attribute value, per
 * RFC 6265: the leading dot some servers still write is cosmetic, and a
 * `Domain` matches its own host as well as any subdomain of it. */
function domainCoversHost(domain: string, host: string): boolean {
  const normalizedDomain = domain.replace(/^\./, '').toLowerCase()
  const normalizedHost = host.toLowerCase()
  return normalizedHost === normalizedDomain || normalizedHost.endsWith(`.${normalizedDomain}`)
}

/**
 * Analyze one cookie's attributes for the security properties that matter:
 * `Secure`, `HttpOnly`, `SameSite`, `Domain` scope, `__Host-`/`__Secure-`
 * prefix compliance, and size. Pure — no network access, no knowledge of
 * where the cookie came from beyond what `opts` says.
 *
 * `opts.isRequest` suppresses every "missing attribute" warning: those
 * attributes are server-controlled and a `Cookie` request header cannot
 * observe them, so their absence here means "not visible", not "not set".
 * `opts.host`, when given, is the host being compared against the cookie's
 * `Domain` scope; omitted, that comparison is skipped and reported as
 * unknown rather than silently passed.
 */
export function analyzeCookie(
  name: string,
  value: string,
  attributes: Map<string, string | true>,
  opts: { host?: string; isRequest: boolean },
): CookieAnalysis {
  const secure = attribute(attributes, 'secure') === true
  const httpOnly = attribute(attributes, 'httponly') === true
  const sameSite = stringAttribute(attributes, 'samesite')
  const domain = stringAttribute(attributes, 'domain')
  const path = stringAttribute(attributes, 'path')
  const { expiry, isSession } = resolveExpiry(attributes)

  const warnings: string[] = []

  if (!isSession && new Date(expiry).getTime() <= Date.now()) {
    warnings.push('already expired — Max-Age or Expires puts this cookie in the past, so the browser deletes it immediately')
  }

  if (!opts.isRequest) {
    if (!secure) warnings.push('missing Secure — the cookie can be sent over plain HTTP')
    if (!httpOnly) warnings.push('missing HttpOnly — readable by JavaScript, which XSS can exploit')
    if (sameSite === null) {
      warnings.push('missing SameSite — falls back to browser-default Lax rather than an explicit choice')
    } else if (sameSite.toLowerCase() === 'none' && !secure) {
      warnings.push('SameSite=None without Secure — modern browsers reject this combination outright')
    }
  }

  const host = opts.host?.trim() ?? ''
  let domainScopeUnknown = false
  if (domain !== null) {
    if (host === '') {
      domainScopeUnknown = true
    } else if (domainCoversHost(domain, host) && domain.replace(/^\./, '').toLowerCase() !== host.toLowerCase()) {
      warnings.push(`Domain=${domain} scopes the cookie to all of ${domain.replace(/^\./, '')}, wider than host ${host}`)
    }
  }

  if (name.startsWith('__Host-')) {
    const violations: string[] = []
    if (!secure) violations.push('not Secure')
    if (path !== '/') violations.push('Path is not "/"')
    if (domain !== null) violations.push('carries a Domain attribute')
    if (violations.length > 0) {
      warnings.push(`__Host- prefix requires Secure, Path=/ and no Domain: ${violations.join(', ')}`)
    }
  } else if (name.startsWith('__Secure-') && !secure) {
    warnings.push('__Secure- prefix requires Secure, which is missing')
  }

  const byteLength = utf8.encode(`${name}=${value}`).length
  if (byteLength > MAX_COOKIE_BYTES) {
    warnings.push(`name+value is ${byteLength} bytes, over the ${MAX_COOKIE_BYTES}-byte limit many browsers enforce`)
  }

  return {
    name,
    value,
    secure,
    httpOnly,
    sameSite,
    domain,
    path,
    expiry,
    isSession,
    domainScopeUnknown,
    warnings,
  }
}

/** A representative `Set-Cookie` value has a `name=value` pair followed by at
 * least one `; ` separated, recognised attribute keyword — a plain `Cookie`
 * header, a JWT or prose does not.
 *
 * Scored as the fraction of non-blank lines that look like a `Set-Cookie`
 * value, the same way `headers.ts` scores the fraction of lines that look
 * like `Name: value`. A flat score regardless of surrounding context would
 * let a single `Set-Cookie` line outscore `headers.detect` on a whole raw
 * response (status line plus a handful of headers, one of them
 * `Set-Cookie`) — exactly the paste the header grader is meant to catch —
 * and magic paste would open this tool instead. Capped below 1 so a pure
 * multi-line cookie paste never edges out an unambiguous header block. */
export function detect(input: string): number {
  const lines = input.split(/\r?\n/).filter((line) => line.trim() !== '')
  if (lines.length === 0) return 0

  const matchCount = lines.filter(
    (line) => line.includes('=') && ATTRIBUTE_AFTER_SEMICOLON.test(line),
  ).length
  if (matchCount === 0) return 0

  return Math.min(0.85, matchCount / lines.length)
}

function expiryLabel(analysis: CookieAnalysis): string {
  return analysis.isSession ? 'session (cleared when the browser closes)' : analysis.expiry
}

function runSetCookie(lines: string[], host: string): ToolResult {
  const fields: ToolField[] = []
  const summaries: string[] = []
  let anyWarning = false

  for (const line of lines) {
    const { name, value, attributes } = parseSetCookieHeader(line)
    if (name === '') continue

    const analysis = analyzeCookie(name, value, attributes, {
      host: host === '' ? undefined : host,
      isRequest: false,
    })
    if (analysis.warnings.length > 0) anyWarning = true

    fields.push({ label: `${name}: Secure`, value: analysis.secure ? 'yes' : 'no', warn: !analysis.secure })
    fields.push({ label: `${name}: HttpOnly`, value: analysis.httpOnly ? 'yes' : 'no', warn: !analysis.httpOnly })
    fields.push({
      label: `${name}: SameSite`,
      value: analysis.sameSite ?? 'not set',
      warn: analysis.sameSite === null || (analysis.sameSite.toLowerCase() === 'none' && !analysis.secure),
    })
    fields.push({ label: `${name}: Domain`, value: analysis.domain ?? '(host-only)' })
    fields.push({ label: `${name}: Path`, value: analysis.path ?? '(not set)' })
    fields.push({ label: `${name}: Expiry`, value: expiryLabel(analysis) })
    if (analysis.domainScopeUnknown) {
      fields.push({
        label: `${name}: Domain scope`,
        value: 'no host given to compare against — unknown whether the Domain scope is wider than intended',
      })
    }
    for (const warning of analysis.warnings) {
      fields.push({ label: `${name}: warning`, value: warning, warn: true })
    }

    summaries.push(
      analysis.warnings.length === 0
        ? `${name}: no issues found`
        : `${name}: ${analysis.warnings.length} warning(s)`,
    )
  }

  return {
    ok: !anyWarning,
    output: summaries.length > 0 ? summaries.join('\n') : 'No cookies found in the input.',
    fields,
  }
}

function runCookieHeader(lines: string[]): ToolResult {
  const pairs = lines.flatMap((line) => parseCookieHeader(line))
  const fields: ToolField[] = pairs.map((pair) => ({ label: pair.name, value: pair.value }))

  return {
    ok: true,
    output:
      pairs.length === 0
        ? 'No cookies found in the input.'
        : `${pairs.length} cookie(s) parsed from a request header. Server-side attributes (Secure, HttpOnly, SameSite, Domain, Path, expiry) are not observable from a Cookie: request header.`,
    fields,
  }
}

function run(input: string, options: ToolOptions): ToolResult {
  if (input.trim() === '') return { ok: true, output: '' }

  const host = options.host?.trim() ?? ''
  const lines = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')

  return detectHeaderKind(input) === 'set-cookie' ? runSetCookie(lines, host) : runCookieHeader(lines)
}

export const cookie = {
  id: 'cookie',
  name: 'Cookie',
  options: [{ key: 'host', label: 'Host', kind: 'text', default: '', placeholder: 'example.com' }],
  detect,
  run,
} satisfies Tool
