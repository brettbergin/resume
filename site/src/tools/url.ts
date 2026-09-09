/*
 * Percent-encoding, both directions.
 *
 * `encodeURIComponent`/`decodeURIComponent` do the work — the value of the
 * tool is not the codec, it is the two things around it:
 *
 * - Decoding repeats until the value settles, and reports how many passes it
 *   took. A parameter that crossed a redirect twice arrives as `%2520`, and
 *   the useful answer is " " *and* the fact that it was encoded twice, which
 *   is usually the bug being chased.
 * - A malformed escape is an error result, not a thrown `URIError`. `%zz` and
 *   a truncated `%E0%A4` are exactly the input someone pastes when they are
 *   trying to work out why a request failed, so the pane has to survive them.
 *
 * `detect` looks for an escape that actually decodes: `100%` and `50% off`
 * contain a `%` but are not encoded text, and scoring them would hijack magic
 * paste from whatever the reader meant.
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

/** A percent escape, well-formed as far as its shape goes. */
const ESCAPE = /%[0-9a-fA-F]{2}/

/** One decode pass that never throws: an input a later layer cannot decode is
 * returned unchanged, which `decodeLayers` reads as the end of the chain. The
 * first pass is validated separately by `decode`, so a genuinely malformed
 * input is still reported rather than silently passed through. */
function decodeOnce(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function decode(input: string): ToolResult {
  try {
    decodeURIComponent(input)
  } catch {
    return {
      ok: false,
      output: '',
      error: 'malformed percent-encoding: an escape is truncated or not hex',
    }
  }

  const { value, layers } = decodeLayers(input, decodeOnce)
  const field = layersField(layers)
  return { ok: true, output: value, fields: field ? [field] : undefined }
}

function run(input: string, toolOptions: ToolOptions): ToolResult {
  if (input === '') return { ok: true, output: '' }
  return toolOptions.mode === 'encode'
    ? { ok: true, output: encodeURIComponent(input) }
    : decode(input)
}

function detect(input: string): number {
  if (!ESCAPE.test(input)) return 0
  try {
    return decodeURIComponent(input) === input ? 0 : 0.7
  } catch {
    return 0
  }
}

export const url = {
  id: 'url',
  name: 'url',
  options,
  detect,
  run,
} satisfies Tool
