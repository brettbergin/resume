/*
 * base64, both directions, both alphabets.
 *
 * Two decisions worth stating up front, because they are what a working
 * decoder needs and a textbook one leaves out:
 *
 * - Decoding is lenient about padding and about which alphabet the input
 *   uses. Real pastes come out of logs, JWTs and config files with the `=`
 *   stripped or with `-`/`_` in place of `+`/`/`, and refusing them would
 *   make the tool useless exactly when it is needed. The `alphabet` option
 *   therefore chooses what *encoding* emits; decoding accepts either.
 * - Not every base64 payload is text. When the decoded bytes are not valid
 *   UTF-8 the output becomes a hex dump rather than a run of replacement
 *   characters, so a DER blob or a raw key still tells the reader something.
 *
 * `detect` is capped at 0.7 on purpose. A 16-digit epoch, a hex digest and a
 * base64 string all live in overlapping character sets, so magic paste has to
 * be able to prefer a more specific format; a tool that scored its own format
 * at 1.0 would win every tie. All-digit input scores 0 outright for the same
 * reason: it is an epoch or an id far more often than it is base64.
 */

import { hexdump } from './hexdump.ts'
import type { Tool, ToolOption, ToolOptions, ToolResult } from './types.ts'

const options: readonly ToolOption[] = [
  {
    key: 'mode',
    label: 'Mode',
    kind: 'select',
    default: 'decode',
    choices: [
      { value: 'decode', label: 'decode' },
      { value: 'encode', label: 'encode' },
    ],
  },
  {
    key: 'alphabet',
    label: 'Alphabet',
    kind: 'select',
    default: 'standard',
    choices: [
      { value: 'standard', label: 'standard (+/)' },
      { value: 'urlsafe', label: 'url-safe (-_)' },
    ],
  },
]

const utf8 = new TextEncoder()

/** Every character either alphabet may contain, plus trailing padding. */
const BASE64_CHARS = /^[A-Za-z0-9+/\-_]*={0,2}$/

/** Bytes to base64, in the chosen alphabet. url-safe drops the padding too:
 * `=` has to be percent-escaped in a query string, which is the situation the
 * alphabet exists for. */
function encodeBytes(bytes: Uint8Array, alphabet: string): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  const standard = btoa(binary)
  return alphabet === 'urlsafe'
    ? standard.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
    : standard
}

/** base64 (either alphabet, padded or not) to bytes, or `null` when the input
 * is not base64 at all. Whitespace — the line wrapping every PEM file and
 * most log output carries — is stripped first. */
function decodeToBytes(input: string): Uint8Array | null {
  const compact = input.replace(/\s+/g, '')
  if (compact === '') return new Uint8Array(0)
  if (!BASE64_CHARS.test(compact)) return null

  const standard = compact
    .replaceAll('-', '+')
    .replaceAll('_', '/')
    .replace(/=+$/, '')
  const padded = standard.padEnd(
    standard.length + ((4 - (standard.length % 4)) % 4),
    '=',
  )
  try {
    const binary = atob(padded)
    return Uint8Array.from(binary, (character) => character.charCodeAt(0))
  } catch {
    return null
  }
}

/** The bytes as text, or `null` when they are not valid UTF-8. */
function asText(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

function run(input: string, toolOptions: ToolOptions): ToolResult {
  const mode = toolOptions.mode === 'encode' ? 'encode' : 'decode'
  const alphabet = toolOptions.alphabet === 'urlsafe' ? 'urlsafe' : 'standard'

  if (input === '') return { ok: true, output: '' }

  if (mode === 'encode') {
    const bytes = utf8.encode(input)
    return {
      ok: true,
      output: encodeBytes(bytes, alphabet),
      fields: [{ label: 'Input', value: `${bytes.length} bytes` }],
    }
  }

  const bytes = decodeToBytes(input)
  if (bytes === null) {
    return {
      ok: false,
      output: '',
      error: 'not valid base64: unexpected character or truncated payload',
    }
  }

  const text = asText(bytes)
  if (text === null) {
    return {
      ok: true,
      output: hexdump(bytes),
      fields: [
        { label: 'Decoded', value: `${bytes.length} bytes` },
        {
          label: 'Encoding',
          value: 'not valid UTF-8 — shown as a hex dump',
          warn: true,
        },
      ],
    }
  }

  return {
    ok: true,
    output: text,
    fields: [{ label: 'Decoded', value: `${bytes.length} bytes` }],
  }
}

function detect(input: string): number {
  const compact = input.replace(/\s+/g, '')
  if (compact === '') return 0
  // Unpadded base64 is decoded happily above, but as a *signal* a length that
  // is not a whole number of quartets is weak enough to be worth nothing.
  if (compact.length % 4 !== 0) return 0
  // Digits alone are an epoch, a port, an id — never usefully base64.
  if (/^\d+$/.test(compact)) return 0
  if (!BASE64_CHARS.test(compact)) return 0

  const bytes = decodeToBytes(compact)
  if (bytes === null || bytes.length === 0) return 0

  // A decode/encode round trip has to reproduce the input. Padding that sits
  // in the middle, or a final quartet whose unused bits are not zero, decodes
  // without complaint but is not something any encoder produced.
  const canonical = encodeBytes(bytes, 'standard').replace(/=+$/, '')
  const normalised = compact
    .replaceAll('-', '+')
    .replaceAll('_', '/')
    .replace(/=+$/, '')
  if (canonical !== normalised) return 0

  let score = 0.5
  if (compact.length >= 8) score += 0.1
  if (/[A-Z]/.test(compact) && /[a-z]/.test(compact)) score += 0.05
  if (asText(bytes) !== null) score += 0.05
  return Math.min(0.7, score)
}

/* `satisfies` rather than an annotation: the registry only needs a `Tool`,
 * but callers of this module — its tests, and magic paste, which delegates to
 * a detected tool — get the concrete signatures back, so a synchronous `run`
 * does not have to be awaited to be read. */
export const base64 = {
  id: 'base64',
  name: 'base64',
  options,
  detect,
  run,
} satisfies Tool
