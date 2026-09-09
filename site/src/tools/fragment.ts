/*
 * The `~/tools` page keeps all of its state in the URL fragment, which is the
 * one part of a URL a browser never sends to a server. That is what makes a
 * shared link safe *and* what makes the page work with no backend: the whole
 * decoded thing travels in the link, and GitHub Pages serves a static file.
 *
 * The shape is `#/tools/<toolId>?i=<base64url(input)>&o=<base64url(JSON)>`.
 * The route prefix comes first so `App.tsx` can decide what to render from
 * `location.hash` alone, and the payload is base64url so a pasted PEM's
 * newlines, an option value's `&` and any non-ASCII text survive the trip
 * without a second layer of percent-escaping.
 *
 * This module deliberately imports nothing from `registry.ts`: it deals in
 * tool *id strings*, never tool objects. That keeps the URL layer testable on
 * its own and stops every tool implementation being pulled into the bundle
 * path that only wanted to read the hash. Validating that an id names a real
 * tool is the caller's job.
 *
 * Nothing here throws. A hash is attacker-supplied text — truncated by a chat
 * client, hand-edited, or from an older version of the page — so every parse
 * failure degrades to the default state instead of blanking the page.
 *
 * Secrets: `buildToolHash` writes whatever options it is handed. Filtering
 * out `ToolOption.secret` values happens in the UI, which is the layer that
 * knows the option definitions; see `ToolOption` in `types.ts`.
 */

import type { ToolOptions } from './types.ts'

/** The hash path that selects the tools page. */
export const TOOLS_ROUTE = '/tools'

/** The tool shown when the fragment names none: magic paste, which sniffs the
 * input and delegates, so the landing state needs no choice from the reader. */
export const DEFAULT_TOOL_ID = 'magic'

/**
 * The largest input, in UTF-8 bytes, that is written into the hash.
 *
 * A pasted certificate chain is tens of kilobytes; base64url-encoded into a
 * URL it becomes a link that chat clients truncate, servers reject and nobody
 * can read. Past this ceiling the input simply stays out of the URL — the
 * page still works, the share button just greys out.
 */
export const MAX_HASH_INPUT_BYTES = 4096

/** Tool ids are bare path segments: lowercase, no slashes, no escaping. */
const TOOL_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** The state a tools URL encodes. */
export interface ToolHashState {
  tool: string
  input: string
  options: ToolOptions
}

const FALLBACK: ToolHashState = {
  tool: DEFAULT_TOOL_ID,
  input: '',
  options: {},
}

const utf8 = new TextEncoder()

/** UTF-8 byte length, which is what the ceiling is measured in — `.length`
 * counts UTF-16 code units and would let a paste of CJK text through at twice
 * the intended size. */
const byteLength = (text: string): number => utf8.encode(text).length

/** True when `input` is too big to travel in the hash, so the UI can grey out
 * its share button and explain why rather than silently dropping the state. */
export function exceedsHashLimit(input: string): boolean {
  return byteLength(input) > MAX_HASH_INPUT_BYTES
}

/** Text to base64url: RFC 4648 §5's alphabet with the padding stripped, so
 * the result carries no `+`, `/` or `=` to be re-escaped by anything that
 * later handles the URL. */
function encodePayload(text: string): string {
  let binary = ''
  for (const byte of utf8.encode(text)) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

/** base64url back to text, or `null` for anything that is not a valid
 * encoding of valid UTF-8. Padding is restored first because it was stripped
 * on the way out. */
function decodePayload(value: string): string | null {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) return null
  const standard = value.replaceAll('-', '+').replaceAll('_', '/')
  const padded = standard.padEnd(
    standard.length + ((4 - (standard.length % 4)) % 4),
    '=',
  )
  try {
    const binary = atob(padded)
    const bytes = Uint8Array.from(binary, (character) =>
      character.charCodeAt(0),
    )
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

/** The hash without its leading `#`, and without the leading `#!` some older
 * hash-routing conventions use. */
const stripHash = (hash: string): string => hash.replace(/^#!?/, '')

/** True when `hash` addresses the tools page: `#/tools`, `#/tools/`, or
 * `#/tools/<id>`, each optionally carrying a query string. A hash that merely
 * starts with the same letters (`#/toolsmith`) is not the tools route. */
export function isToolsRoute(hash: string): boolean {
  const path = stripHash(hash).split('?')[0]
  return path === TOOLS_ROUTE || path.startsWith(`${TOOLS_ROUTE}/`)
}

/** An options map parsed out of `o=`, or `{}` for anything that is not a flat
 * object of strings — a JSON array, a nested object, `null`. */
function parseOptions(json: string): ToolOptions {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return {}
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed) ||
    !Object.values(parsed).every((value) => typeof value === 'string')
  ) {
    return {}
  }
  return { ...(parsed as ToolOptions) }
}

/**
 * Read the tool state out of a `location.hash`.
 *
 * Every failure — a hash for some other route, an unparseable payload, an id
 * that is not a bare path segment — falls back to the default tool with an
 * empty input rather than throwing, so a mangled link lands the reader on
 * magic paste instead of a blank page.
 */
export function parseToolHash(hash: string): ToolHashState {
  if (!isToolsRoute(hash)) return { ...FALLBACK }

  const [path, query = ''] = stripHash(hash).split('?')
  const segment = path.slice(TOOLS_ROUTE.length).replace(/^\//, '')
  const tool = TOOL_ID.test(segment) ? segment : DEFAULT_TOOL_ID

  const params = new URLSearchParams(query)
  const rawInput = params.get('i')
  const rawOptions = params.get('o')

  const input = rawInput === null ? '' : (decodePayload(rawInput) ?? '')
  const optionsJson =
    rawOptions === null ? null : (decodePayload(rawOptions) ?? null)

  return {
    tool,
    input,
    options: optionsJson === null ? {} : parseOptions(optionsJson),
  }
}

/**
 * Build the `#/tools/...` string for a state.
 *
 * An input over `MAX_HASH_INPUT_BYTES` is left out entirely — `i=` is absent
 * rather than truncated, because half a certificate decodes to an error and
 * looks like a bug. The tool id and the options are kept either way, so the
 * link still opens the right tool configured the right way and only the paste
 * is missing.
 */
export function buildToolHash(state: ToolHashState): string {
  const tool = TOOL_ID.test(state.tool) ? state.tool : DEFAULT_TOOL_ID
  const params: string[] = []

  if (state.input !== '' && !exceedsHashLimit(state.input)) {
    params.push(`i=${encodePayload(state.input)}`)
  }
  if (Object.keys(state.options).length > 0) {
    params.push(`o=${encodePayload(JSON.stringify(state.options))}`)
  }

  const query = params.length > 0 ? `?${params.join('&')}` : ''
  return `#${TOOLS_ROUTE}/${tool}${query}`
}
