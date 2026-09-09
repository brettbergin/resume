/*
 * HTML entity escaping, both directions.
 *
 * Encoding covers the five characters that change how markup parses —
 * `& < > " '` — and nothing else. A tool that also escaped every accented
 * character would turn readable text into unreadable text for no safety
 * gained, and the reader pasting a payload in here wants to see what an
 * escaper would have done to it, not a maximal entity table.
 *
 * Decoding is the wider half, because it has to read what other people's
 * encoders emit: the named entities this one produces, plus decimal `&#39;`
 * and hex `&#x27;`, which is how most escapers write the apostrophe. Unknown
 * names are left alone rather than dropped — `&foo;` is text.
 *
 * Like the url tool, decoding repeats until the value settles and reports the
 * pass count: `&amp;lt;` is a template that escaped an already-escaped value,
 * and "2 layers" is the finding.
 *
 * Everything here is string work. Deliberately no `innerHTML` round trip,
 * which is the usual shortcut and would run whatever it was handed.
 */

import { decodeLayers, layersField } from './layers.ts'
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

/** The characters that change how markup parses, and what encoding makes of
 * them. `'` becomes `&#39;` rather than `&apos;`: the numeric form is
 * understood everywhere, including HTML 4 and XML alike. */
const ESCAPES: readonly [string, string][] = [
  ['&', '&amp;'],
  ['<', '&lt;'],
  ['>', '&gt;'],
  ['"', '&quot;'],
  ["'", '&#39;'],
]

/** Named entities decoding understands: the ones encoding emits, plus `apos`,
 * which other escapers use for the same character. A `Map` rather than an
 * object literal so a lookup cannot reach `Object.prototype` — `&constructor;`
 * is text, and an object would answer it with a function. */
const NAMED = new Map<string, string>([
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', "'"],
])

/** A named, decimal or hex entity reference. */
const ENTITY = /&(?:#[xX]([0-9a-fA-F]+)|#(\d+)|([a-zA-Z][a-zA-Z0-9]*));/g

/** The character a numeric reference names, or `null` when the code point is
 * not one — `&#1114112;` is out of range, and surrogates are not characters
 * on their own. */
function fromCodePoint(code: number): string | null {
  if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) return null
  if (code >= 0xd800 && code <= 0xdfff) return null
  return String.fromCodePoint(code)
}

/** One decode pass. Never throws, and leaves anything it does not recognise
 * exactly as it found it, so an unchanged return ends `decodeLayers`' walk. */
function decodeOnce(value: string): string {
  return value.replace(ENTITY, (match, hexDigits, decimal, name) => {
    if (hexDigits !== undefined) {
      return fromCodePoint(Number.parseInt(hexDigits, 16)) ?? match
    }
    if (decimal !== undefined) {
      return fromCodePoint(Number.parseInt(decimal, 10)) ?? match
    }
    return NAMED.get(name) ?? match
  })
}

function encode(input: string): string {
  let output = input
  for (const [character, entity] of ESCAPES) {
    output = output.replaceAll(character, entity)
  }
  return output
}

function decode(input: string): ToolResult {
  const { value, layers } = decodeLayers(input, decodeOnce)
  const field = layersField(layers)
  return { ok: true, output: value, fields: field ? [field] : undefined }
}

function run(input: string, toolOptions: ToolOptions): ToolResult {
  if (input === '') return { ok: true, output: '' }
  return toolOptions.mode === 'encode'
    ? { ok: true, output: encode(input) }
    : decode(input)
}

function detect(input: string): number {
  // An entity that decodes to itself is not an entity: `&foo;` is prose, and
  // scoring it would take magic paste away from whatever the input really is.
  return decodeOnce(input) === input ? 0 : 0.7
}

export const html = {
  id: 'html',
  name: 'html',
  options,
  detect,
  run,
} satisfies Tool
