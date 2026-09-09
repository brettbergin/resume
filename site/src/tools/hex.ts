/*
 * Hex to bytes and back.
 *
 * Decoding is deliberately forgiving about how the digits arrived. Hex gets
 * copied out of a debugger as `0x48 0x65`, out of a packet capture as
 * `48:65:6c`, out of a fingerprint as `48-65-6C` and out of a log line wrapped
 * across three rows — all of it means the same bytes, and a tool that made the
 * reader clean it up first would not be worth opening. What it will not do is
 * guess at an odd number of digits: a truncated paste is a real thing to catch
 * rather than pad, so that is an error result.
 *
 * As with base64, bytes that are not valid UTF-8 render as a hex dump instead
 * of a row of replacement characters — decoding hex to look at a binary header
 * is most of why anyone decodes hex.
 *
 * `detect` has to lose to the epoch tool on all-digit input. `1755112233` is a
 * perfectly good even-length hex string and is essentially never meant as one,
 * so digits alone score 0.5, under magic paste's 0.6 threshold: hex only wins
 * when the input contains a digit hex has and decimal does not.
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
]

const utf8 = new TextEncoder()

/** Below this many digits, hex is too short to be a confident guess: `ab` is
 * a word before it is a byte. */
const CONFIDENT_LENGTH = 4

/** Strip everything that decorates hex without carrying information: line
 * wrapping, per-byte `0x` prefixes, and the `:` or `-` separators fingerprints
 * and captures use. `x` is not a hex digit, so removing every `0x` cannot eat
 * a meaningful pair. */
function normalise(input: string): string {
  return input
    .replace(/\s+/g, '')
    .replace(/0x/gi, '')
    .replace(/[:-]/g, '')
}

/** The bytes as text, or `null` when they are not valid UTF-8. */
function asText(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

function decode(input: string): ToolResult {
  const digits = normalise(input)
  if (digits === '') return { ok: true, output: '' }

  if (!/^[0-9a-fA-F]+$/.test(digits)) {
    return {
      ok: false,
      output: '',
      error: 'not valid hex: expected only 0-9 and a-f, optionally separated',
    }
  }
  if (digits.length % 2 !== 0) {
    return {
      ok: false,
      output: '',
      error: `odd number of hex digits (${digits.length}) — the input looks truncated`,
    }
  }

  const bytes = new Uint8Array(digits.length / 2)
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(digits.slice(index * 2, index * 2 + 2), 16)
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

function encode(input: string): ToolResult {
  const bytes = utf8.encode(input)
  const output = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
  return {
    ok: true,
    output,
    fields: [{ label: 'Input', value: `${bytes.length} bytes` }],
  }
}

function run(input: string, toolOptions: ToolOptions): ToolResult {
  if (input === '') return { ok: true, output: '' }
  return toolOptions.mode === 'encode' ? encode(input) : decode(input)
}

function detect(input: string): number {
  const digits = normalise(input)
  if (digits === '') return 0
  if (!/^[0-9a-fA-F]+$/.test(digits)) return 0
  if (digits.length % 2 !== 0) return 0
  // Under magic paste's threshold on purpose: an all-digit string is an epoch,
  // an id or a port far more often than it is bytes written in hex.
  if (/^\d+$/.test(digits)) return 0.5
  return digits.length >= CONFIDENT_LENGTH ? 0.75 : 0.5
}

export const hex = {
  id: 'hex',
  name: 'hex',
  options,
  detect,
  run,
} satisfies Tool
