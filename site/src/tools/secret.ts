/*
 * Generators: passwords, diceware passphrases, random bytes, UUIDs, API keys.
 *
 * The odd one out on the page. Every other tool transforms what the reader
 * pasted; this one ignores the input entirely and produces something new each
 * time it runs, which is why `run` has no empty-input shortcut — an empty pane
 * is exactly the state someone is in when they want a password, and returning
 * nothing there would make the tool unusable.
 *
 * `generates: true` is what makes that reach the page: the pane skips the run
 * for an empty input otherwise, which for this tool would mean it never ran at
 * all. With the flag set it runs on mount and on every option change, is drawn
 * without the input box it would ignore, and gets a Generate button for
 * another value.
 *
 * Two properties are worth more than the convenience here:
 *
 * Uniformity. Every value comes out of `crypto.getRandomValues`, and every
 * index into an alphabet or a wordlist is drawn by rejection sampling rather
 * than `% k`. A byte reduced modulo 90 hands the first 76 characters of a
 * 90-character alphabet a 3/256 chance and the rest 2/256 — a real, if small,
 * bias, and one that costs nothing to remove: discard the bytes at the top of
 * the range that do not divide evenly and draw again.
 *
 * Honest entropy. The bits reported are computed from the alphabet actually
 * used — after ambiguous characters are excluded, which *shrinks* it — times
 * the length actually generated. Anything fixed contributes nothing and is
 * counted as nothing: an API key's prefix, a passphrase's separators, and the
 * six bits a v4 UUID spends on its version and variant are all structure an
 * attacker already knows, not secret.
 *
 * Nothing leaves the browser, here least of all: the wordlist is vendored
 * beside this file rather than downloaded, and the only source of randomness
 * is the one the platform provides.
 */

import type {
  Tool,
  ToolField,
  ToolOption,
  ToolOptions,
  ToolResult,
} from './types.ts'
import { EFF_SHORT_WORDLIST } from './vendor/eff-short.ts'

const options: readonly ToolOption[] = [
  {
    key: 'generator',
    label: 'Generate',
    kind: 'select',
    default: 'password',
    choices: [
      { value: 'password', label: 'password' },
      { value: 'passphrase', label: 'passphrase' },
      { value: 'hex', label: 'hex bytes' },
      { value: 'base64', label: 'base64 bytes' },
      { value: 'uuid', label: 'UUID v4' },
      { value: 'apikey', label: 'API key' },
    ],
  },
  {
    key: 'length',
    label: 'Length',
    kind: 'text',
    default: '16',
    placeholder: 'characters',
  },
  {
    key: 'chars',
    label: 'Characters',
    kind: 'select',
    default: 'all',
    choices: [
      { value: 'all', label: 'a-z A-Z 0-9 symbols' },
      { value: 'alphanumeric', label: 'a-z A-Z 0-9' },
      { value: 'lower+digits', label: 'a-z 0-9' },
      { value: 'lower', label: 'a-z' },
    ],
  },
  {
    key: 'noAmbig',
    label: 'Ambiguous',
    kind: 'select',
    default: 'no',
    choices: [
      { value: 'no', label: 'keep 0 O l 1 I |' },
      { value: 'yes', label: 'exclude 0 O l 1 I |' },
    ],
  },
  {
    key: 'words',
    label: 'Words',
    kind: 'text',
    default: '4',
    placeholder: 'word count',
  },
  {
    key: 'separator',
    label: 'Separator',
    kind: 'text',
    default: '-',
    placeholder: 'between words',
  },
  {
    key: 'bytes',
    label: 'Bytes',
    kind: 'text',
    default: '16',
    placeholder: 'random bytes',
  },
  {
    key: 'prefix',
    label: 'Prefix',
    kind: 'text',
    default: '',
    placeholder: 'sk, ghp, …',
  },
]

const LOWER = 'abcdefghijklmnopqrstuvwxyz'
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const DIGITS = '0123456789'
/** Punctuation a password field, a shell and a CSV all survive. 28 characters,
 * which with the letters and digits makes the full set 90. */
const SYMBOLS = '!@#$%^&*()-_=+[]{}<>?,.:;/|~'

/** The character classes the `chars` option offers, in the order a reader
 * would narrow them: everything, then no symbols, then no capitals. */
const ALPHABETS: Record<string, string> = {
  all: LOWER + UPPER + DIGITS + SYMBOLS,
  alphanumeric: LOWER + UPPER + DIGITS,
  'lower+digits': LOWER + DIGITS,
  lower: LOWER,
}

/** Characters that get misread off a screen or a sticky note, either way
 * round: zero for capital O, lowercase L for one for capital I, pipe for
 * either, and the B/8 and S/5 pairs that trip up handwriting and OCR alike.
 * Excluding them costs bits — the entropy below is computed after the cut, so
 * the number reported is the number that survived it. */
const AMBIGUOUS = '0Ol1I|B8S5'

/** Passphrase entropy comes from the list's length, so anything that changes
 * it changes the arithmetic. 1296 is four dice; the vendored list's own test
 * pins the count. */
const WORDLIST_SIZE = EFF_SHORT_WORDLIST.length

/** A v4 UUID is 128 random bits minus the four the version nibble fixes and
 * the two the variant fixes. The remaining 122 is the whole of its strength,
 * and it is not configurable — which is the point of stating it. */
const UUID_BITS = 122

/** Below this, a value is worth a second look before it guards anything: 64
 * bits is roughly where an offline attack against a fast hash stops being
 * theoretical. */
const WEAK_BITS = 64

/** Generous ceilings. Nothing here needs a million characters, and a typo in
 * a text field should come back as an error rather than as a locked-up tab. */
const MAX_LENGTH = 4096
const MAX_WORDS = 512
const MAX_BYTES = 4096

/** `count` bytes from the platform CSPRNG. The single point at which anything
 * in this module becomes random. */
function randomBytes(count: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(count))
}

/**
 * `count` indices uniformly distributed over `[0, size)`.
 *
 * Rejection sampling: a draw is only usable when it falls inside the largest
 * multiple of `size` that fits in the draw's range, so every residue is
 * reachable by exactly the same number of draws. Rejected ones are not reused
 * — the loop asks for more, which terminates with probability 1 and throws
 * away under a third of its bytes at the worst `size` the tool offers.
 *
 * A draw is one byte while the alphabet fits in one, two once it does not: the
 * wordlist's 1296 entries do not fit in 256, and `Math.floor(256 / 1296)` is
 * zero, which would reject every byte forever rather than merely bias the
 * result. Bytes come in blocks so a long password is one call into the CSPRNG
 * rather than a hundred.
 */
function randomIndices(count: number, size: number): number[] {
  const width = size <= 256 ? 1 : 2
  const limit = size * Math.floor(256 ** width / size)
  const indices: number[] = []

  while (indices.length < count) {
    const block = randomBytes((count - indices.length + 8) * width)
    for (let at = 0; at + width <= block.length; at += width) {
      let draw = 0
      for (let byte = 0; byte < width; byte += 1) {
        draw = draw * 256 + block[at + byte]
      }
      if (draw >= limit) continue
      indices.push(draw % size)
      if (indices.length === count) break
    }
  }

  return indices
}

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')

/** Standard base64, the same way `base64.ts` does it: bytes to a binary
 * string, then the platform's encoder. */
function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/** `bits` as the page shows it, to one decimal place — enough to tell 101.2
 * from 95.4 without implying the estimate is exact to a thousandth. */
const bitsField = (bits: number): ToolField => ({
  label: 'Entropy',
  value: `${bits.toFixed(1)} bits`,
})

/** The rows every result carries: the bits, and a warning when there are not
 * many of them. Kept off the entropy row itself so that row stays a plain
 * label and value. */
function entropyFields(bits: number): ToolField[] {
  const fields = [bitsField(bits)]
  if (bits < WEAK_BITS) {
    fields.push({
      label: 'Strength',
      value: `under ${WEAK_BITS} bits — thin for anything worth guarding`,
      warn: true,
    })
  }
  return fields
}

const fail = (error: string): ToolResult => ({ ok: false, output: '', error })

/**
 * A count option as a positive integer, or an error describing what was wrong
 * with it. Deliberately strict: `12.5`, `1e3` and `sixteen` are all a person
 * meaning something the tool cannot honour, and silently rounding one of them
 * would produce a password of a length nobody asked for.
 */
function count(
  raw: string | undefined,
  fallback: string,
  label: string,
  max: number,
): number | string {
  const text = (raw ?? fallback).trim()
  if (!/^-?\d+$/.test(text)) {
    return `${label} must be a whole number, not "${text}"`
  }

  const value = Number(text)
  if (value < 1) return `${label} must be at least 1`
  if (value > max) return `${label} must be at most ${max}`
  return value
}

function password(toolOptions: ToolOptions): ToolResult {
  const length = count(toolOptions.length, '16', 'length', MAX_LENGTH)
  if (typeof length === 'string') return fail(length)

  const base = ALPHABETS[toolOptions.chars ?? 'all'] ?? ''
  const alphabet =
    toolOptions.noAmbig === 'yes'
      ? [...base].filter((character) => !AMBIGUOUS.includes(character)).join('')
      : base

  if (alphabet === '') {
    return fail('no characters left to choose from — pick a wider set')
  }

  const chosen = randomIndices(length, alphabet.length)
  const output = chosen.map((index) => alphabet[index]).join('')

  return {
    ok: true,
    output,
    fields: [
      ...entropyFields(Math.log2(alphabet.length) * length),
      { label: 'Alphabet', value: `${alphabet.length} characters` },
      { label: 'Length', value: `${length} characters` },
    ],
  }
}

function passphrase(toolOptions: ToolOptions): ToolResult {
  const words = count(toolOptions.words, '4', 'word count', MAX_WORDS)
  if (typeof words === 'string') return fail(words)

  // An explicitly empty separator is a choice — `correcthorsebattery` is a
  // passphrase people use — so only a missing option falls back to the dash.
  const separator = toolOptions.separator ?? '-'
  const chosen = randomIndices(words, WORDLIST_SIZE)
  const output = chosen
    .map((index) => EFF_SHORT_WORDLIST[index])
    .join(separator)

  return {
    ok: true,
    // Separators are structure, not secret: `words` draws from the list are
    // all the strength there is, however the words are glued together.
    output,
    fields: [
      ...entropyFields(Math.log2(WORDLIST_SIZE) * words),
      { label: 'Wordlist', value: `EFF short, ${WORDLIST_SIZE} words` },
      { label: 'Words', value: `${words}` },
    ],
  }
}

function rawBytes(
  toolOptions: ToolOptions,
  encoding: 'hex' | 'base64',
): ToolResult {
  const size = count(toolOptions.bytes, '16', 'byte count', MAX_BYTES)
  if (typeof size === 'string') return fail(size)

  const bytes = randomBytes(size)

  return {
    ok: true,
    output: encoding === 'hex' ? toHex(bytes) : toBase64(bytes),
    fields: [
      ...entropyFields(8 * size),
      { label: 'Bytes', value: `${size}` },
      {
        label: 'Encoding',
        value: encoding === 'hex' ? 'lowercase hex' : 'base64',
      },
    ],
  }
}

/**
 * A random UUID, version 4, variant 1 — built from bytes here rather than
 * taken from `crypto.randomUUID` so the six fixed bits are visible in the
 * code that the tests check them against, and so the tool behaves the same in
 * a context where `randomUUID` is missing.
 */
function uuid(): ToolResult {
  const bytes = randomBytes(16)
  // Version 4 in the high nibble of byte 6, variant 10xx in the top two bits
  // of byte 8. Everything else stays as drawn.
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80

  const hex = toHex(bytes)
  const output = [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-')

  return {
    ok: true,
    output,
    fields: [
      ...entropyFields(UUID_BITS),
      { label: 'Version', value: '4 (random)' },
      { label: 'Variant', value: '1 (RFC 9562)' },
    ],
  }
}

/**
 * A key in the shape services hand out: a short prefix naming what it is,
 * then random hex. The prefix is a label — it is printed in dashboards and
 * grepped for by secret scanners — so it is joined with an underscore and
 * contributes exactly nothing to the entropy reported.
 */
function apiKey(toolOptions: ToolOptions): ToolResult {
  const size = count(toolOptions.bytes, '16', 'byte count', MAX_BYTES)
  if (typeof size === 'string') return fail(size)

  const prefix = toolOptions.prefix ?? ''
  const random = toHex(randomBytes(size))

  return {
    ok: true,
    output: prefix === '' ? random : `${prefix}_${random}`,
    fields: [
      ...entropyFields(8 * size),
      { label: 'Bytes', value: `${size}` },
      {
        label: 'Prefix',
        value: prefix === '' ? 'none' : `${prefix}_ (adds no entropy)`,
      },
    ],
  }
}

/** Generates on every run. The input is ignored — the trigger is the run
 * itself, not what is in the pane — which is what makes pressing Generate
 * twice give two different secrets. */
function run(_input: string, toolOptions: ToolOptions): ToolResult {
  switch (toolOptions.generator ?? 'password') {
    case 'passphrase':
      return passphrase(toolOptions)
    case 'hex':
      return rawBytes(toolOptions, 'hex')
    case 'base64':
      return rawBytes(toolOptions, 'base64')
    case 'uuid':
      return uuid()
    case 'apikey':
      return apiKey(toolOptions)
    case 'password':
      return password(toolOptions)
    default:
      return fail(`unknown generator "${toolOptions.generator}"`)
  }
}

export const secret = {
  id: 'secret',
  name: 'Secret generator',
  options,
  run,
  generates: true,
} satisfies Tool
