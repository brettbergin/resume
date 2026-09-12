/*
 * HTTP security header grader: paste a raw response (status line plus
 * headers, as a browser's network panel or `curl -I` shows them) and get a
 * row per graded header plus an overall letter grade.
 *
 * `analyzeCSP` from `./csp.ts` is reused rather than duplicated for the
 * `content-security-policy` row and for deciding whether `frame-ancestors`
 * covers a missing `x-frame-options` — see the note on that export in
 * `csp.ts`. `Set-Cookie` attributes are checked the same way, via
 * `analyzeCookie` from `./cookie.ts`, so a rule about what makes a cookie
 * safe lives in exactly one place regardless of which tool is asking.
 *
 * Everything here is pure: `parseHeaders` and `gradeHeaders` take strings and
 * return data, with no knowledge of where the header block came from.
 */

import { analyzeCookie, parseSetCookieHeader } from './cookie.ts'
import { analyzeCSP } from './csp.ts'
import type { Tool, ToolField, ToolOptions, ToolResult } from './types.ts'

/** A raw header block split into lowercased names and their values, in the
 * order they appeared. A `Map` rather than a plain object because a header
 * name is looked up by exact key, and an array of values per name is what
 * keeps repeated headers — `Set-Cookie` above all — intact instead of the
 * last one silently overwriting the rest.
 *
 * An optional leading status line (`HTTP/1.1 200 OK`) is dropped rather than
 * mis-parsed as a header with no colon. Only the first `:` on a line splits
 * name from value, so a value containing its own colon (a `Date`, a URL in
 * `Location`) is not truncated. */
export function parseHeaders(raw: string): Map<string, string[]> {
  const headers = new Map<string, string[]>()

  const lines = raw.split(/\r?\n/)
  for (const line of lines) {
    if (line.trim() === '') continue
    if (/^HTTP\/\d/i.test(line.trim())) continue

    const colonIndex = line.indexOf(':')
    if (colonIndex === -1) continue

    const name = line.slice(0, colonIndex).trim().toLowerCase()
    const value = line.slice(colonIndex + 1).trim()
    if (name === '') continue

    const existing = headers.get(name)
    if (existing) {
      existing.push(value)
    } else {
      headers.set(name, [value])
    }
  }

  return headers
}

/** The grade result: one `ToolField` row per graded header (plus the final
 * `Grade` row), the letter grade, and the numeric score it came from — kept
 * alongside the grade rather than only in the summary string so a caller
 * (or a test) can assert on it directly. */
export interface HeaderGradeResult {
  fields: ToolField[]
  grade: string
  score: number
}

function scoreToGrade(score: number): string {
  if (score >= 90) return 'A+'
  if (score >= 80) return 'A'
  if (score >= 70) return 'B'
  if (score >= 60) return 'C'
  if (score >= 40) return 'D'
  return 'F'
}

/** Whether a CSP's directives include `frame-ancestors`. Matched on the
 * directive name at a `;` or string boundary rather than via `analyzeCSP`'s
 * findings, since a positive here needs to be true independent of whatever
 * else is wrong with the policy. */
function cspHasFrameAncestors(csp: string): boolean {
  return /(?:^|;)\s*frame-ancestors\b/i.test(csp)
}

function firstValue(headers: Map<string, string[]>, name: string): string | undefined {
  return headers.get(name)?.[0]
}

/** Grade a parsed header set. Starts at 100 and applies the deductions
 * described in the header comment for each rule below, then floors at 0 and
 * maps the result to a letter grade — except the credentialed wildcard CORS
 * case, which forces both to their worst value regardless of anything else
 * that scored well. */
export function gradeHeaders(headers: Map<string, string[]>): HeaderGradeResult {
  let score = 100
  const fields: ToolField[] = []
  let forcedFail = false

  // Strict-Transport-Security
  const hsts = firstValue(headers, 'strict-transport-security')
  if (hsts === undefined) {
    score -= 20
    fields.push({ label: 'Strict-Transport-Security', value: 'missing', warn: true })
  } else {
    const maxAgeMatch = /max-age=(\d+)/i.exec(hsts)
    const maxAge = maxAgeMatch ? Number(maxAgeMatch[1]) : 0
    const includesSubDomains = /includesubdomains/i.test(hsts)
    const preload = /preload/i.test(hsts)

    const notes: string[] = []
    let warn = false
    if (maxAgeMatch === null || maxAge < 31536000) {
      score -= 10
      warn = true
      notes.push(`max-age ${maxAgeMatch ? `${maxAge}s` : 'missing'} < 1 year`)
    }
    if (!includesSubDomains) {
      score -= 5
      warn = true
      notes.push('no includeSubDomains')
    }
    if (!preload) {
      score -= 2
      warn = true
      notes.push('no preload')
    }
    fields.push({
      label: 'Strict-Transport-Security',
      value: notes.length > 0 ? `${hsts} (${notes.join(', ')})` : hsts,
      warn,
    })
  }

  // Content-Security-Policy
  const csp = firstValue(headers, 'content-security-policy')
  if (csp === undefined) {
    score -= 25
    fields.push({ label: 'Content-Security-Policy', value: 'missing', warn: true })
  } else {
    const analysis = analyzeCSP(csp)
    const deduction = Math.min(analysis.warnings.length * 5, 20)
    score -= deduction
    fields.push({
      label: 'Content-Security-Policy',
      value:
        analysis.warnings.length === 0
          ? 'present, no warnings'
          : `${analysis.warnings.length} warning(s): ${analysis.warnings.map((w) => w.message).join('; ')}`,
      warn: analysis.warnings.length > 0,
    })
  }

  // X-Content-Type-Options
  const xcto = firstValue(headers, 'x-content-type-options')
  if (xcto === undefined || xcto.toLowerCase() !== 'nosniff') {
    score -= 10
    fields.push({
      label: 'X-Content-Type-Options',
      value: xcto === undefined ? 'missing' : xcto,
      warn: true,
    })
  } else {
    fields.push({ label: 'X-Content-Type-Options', value: xcto })
  }

  // X-Frame-Options vs. CSP frame-ancestors
  const xfo = firstValue(headers, 'x-frame-options')
  const frameAncestors = csp !== undefined && cspHasFrameAncestors(csp)
  if (xfo === undefined && !frameAncestors) {
    score -= 10
    fields.push({ label: 'X-Frame-Options', value: 'missing, no frame-ancestors in CSP either', warn: true })
  } else if (xfo !== undefined && frameAncestors) {
    fields.push({
      label: 'X-Frame-Options',
      value: `${xfo} (deprecated in favor of the CSP's frame-ancestors)`,
    })
  } else if (xfo !== undefined) {
    fields.push({ label: 'X-Frame-Options', value: xfo })
  } else {
    fields.push({ label: 'X-Frame-Options', value: 'missing, covered by CSP frame-ancestors' })
  }

  // Referrer-Policy
  const referrerPolicy = firstValue(headers, 'referrer-policy')
  if (referrerPolicy === undefined) {
    score -= 5
    fields.push({ label: 'Referrer-Policy', value: 'missing', warn: true })
  } else if (['no-referrer-when-downgrade', 'unsafe-url'].includes(referrerPolicy.toLowerCase())) {
    score -= 10
    fields.push({ label: 'Referrer-Policy', value: `${referrerPolicy} (leaks the referrer over an insecure or cross-origin request)`, warn: true })
  } else {
    fields.push({ label: 'Referrer-Policy', value: referrerPolicy })
  }

  // Permissions-Policy
  const permissionsPolicy = firstValue(headers, 'permissions-policy')
  if (permissionsPolicy === undefined) {
    score -= 5
    fields.push({ label: 'Permissions-Policy', value: 'missing', warn: true })
  } else {
    fields.push({ label: 'Permissions-Policy', value: permissionsPolicy })
  }

  // Cross-Origin-Opener-Policy
  const coop = firstValue(headers, 'cross-origin-opener-policy')
  if (coop === undefined) {
    score -= 10
    fields.push({ label: 'Cross-Origin-Opener-Policy', value: 'missing', warn: true })
  } else {
    fields.push({ label: 'Cross-Origin-Opener-Policy', value: coop })
  }

  // Cross-Origin-Resource-Policy
  const corp = firstValue(headers, 'cross-origin-resource-policy')
  if (corp === undefined) {
    score -= 5
    fields.push({ label: 'Cross-Origin-Resource-Policy', value: 'missing', warn: true })
  } else {
    fields.push({ label: 'Cross-Origin-Resource-Policy', value: corp })
  }

  // Access-Control-Allow-Origin (+ credentials)
  const acao = firstValue(headers, 'access-control-allow-origin')
  const acac = firstValue(headers, 'access-control-allow-credentials')
  if (acao === '*') {
    const credentialed = acac !== undefined && acac.trim().toLowerCase() === 'true'
    if (credentialed) {
      forcedFail = true
      fields.push({
        label: 'Access-Control-Allow-Origin',
        value: '* with Access-Control-Allow-Credentials: true — any origin can read credentialed responses',
        warn: true,
      })
    } else {
      score -= 15
      fields.push({ label: 'Access-Control-Allow-Origin', value: '* (any origin may read the response)', warn: true })
    }
  } else if (acao !== undefined) {
    fields.push({ label: 'Access-Control-Allow-Origin', value: acao })
  }

  // Set-Cookie (one field per repeated header value)
  const setCookies = headers.get('set-cookie') ?? []
  for (const cookie of setCookies) {
    const { name, value, attributes } = parseSetCookieHeader(cookie)
    const analysis = analyzeCookie(name, value, attributes, { isRequest: false })
    const missing: string[] = []
    if (!analysis.secure) {
      score -= 5
      missing.push('Secure')
    }
    if (!analysis.httpOnly) {
      score -= 5
      missing.push('HttpOnly')
    }
    if (analysis.sameSite === null) {
      score -= 3
      missing.push('SameSite')
    }
    fields.push({
      label: `Set-Cookie: ${name || cookie}`,
      value: missing.length > 0 ? `missing ${missing.join(', ')}` : 'Secure, HttpOnly, SameSite all set',
      warn: missing.length > 0,
    })
  }

  const finalScore = forcedFail ? 0 : Math.max(0, score)
  const grade = forcedFail ? 'F' : scoreToGrade(finalScore)

  fields.push({ label: 'Grade', value: grade })

  return { fields, grade, score: finalScore }
}

/** A representative header block has several lines of the `Name: value`
 * form. Three is the floor: fewer and the input is more likely a stray line
 * or two of something else that happens to contain a colon. The score is the
 * fraction of non-empty lines that match, so a block that is *entirely*
 * headers outranks one with header lines mixed among unrelated text (a log
 * excerpt, a curl command and its output). */
export function detect(input: string): number {
  const lines = input.split(/\r?\n/).filter((line) => line.trim() !== '')
  if (lines.length === 0) return 0

  const matchCount = lines.filter((line) => /^[A-Za-z][A-Za-z-]*:\s/.test(line)).length
  if (matchCount < 3) return 0

  return Math.min(1, Math.max(0, matchCount / lines.length))
}

function run(input: string, _options: ToolOptions): ToolResult {
  if (input.trim() === '') return { ok: true, output: '' }

  const headers = parseHeaders(input)
  const { fields, grade, score } = gradeHeaders(headers)

  return {
    ok: grade !== 'F',
    output: `Security grade: ${grade}  (score: ${score}/100)`,
    fields,
  }
}

export const headers = {
  id: 'headers',
  name: 'HTTP Headers',
  detect,
  run,
} satisfies Tool
