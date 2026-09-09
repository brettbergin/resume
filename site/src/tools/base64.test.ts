import { describe, expect, it } from 'vitest'

import { base64 } from './base64.ts'

/*
 * The correctness vectors are RFC 4648 §10's, which is the only test data for
 * base64 anyone should be writing by hand. Around them sit the cases a
 * textbook implementation gets wrong and a paste-a-real-token tool has to get
 * right: missing padding, the url-safe alphabet, and bytes that are not text.
 */

/** RFC 4648 §10: the plaintext and its standard-alphabet encoding. */
const RFC_4648_VECTORS: readonly [string, string][] = [
  ['', ''],
  ['f', 'Zg=='],
  ['fo', 'Zm8='],
  ['foo', 'Zm9v'],
  ['foob', 'Zm9vYg=='],
  ['fooba', 'Zm9vYmE='],
  ['foobar', 'Zm9vYmFy'],
]

const encode = (input: string, alphabet = 'standard') =>
  base64.run(input, { mode: 'encode', alphabet })

const decode = (input: string, alphabet = 'standard') =>
  base64.run(input, { mode: 'decode', alphabet })

describe('base64 encoding', () => {
  it.each(RFC_4648_VECTORS)('encodes %o as %o', (plain, encoded) => {
    expect(encode(plain)).toMatchObject({ ok: true, output: encoded })
  })

  it('encodes non-ASCII text as its UTF-8 bytes', () => {
    expect(encode('é')).toMatchObject({ ok: true, output: 'w6k=' })
  })

  it('reports the input size in bytes, not characters', () => {
    expect(encode('é').fields).toContainEqual({
      label: 'Input',
      value: '2 bytes',
    })
  })
})

describe('base64 decoding', () => {
  it.each(RFC_4648_VECTORS)('decodes back to %o', (plain, encoded) => {
    expect(decode(encoded)).toMatchObject({ ok: true, output: plain })
  })

  it('tolerates missing padding', () => {
    expect(decode('Zg').output).toBe('f')
    expect(decode('Zm8').output).toBe('fo')
    expect(decode('Zm9vYmE').output).toBe('fooba')
  })

  it('tolerates the line wrapping a pasted payload carries', () => {
    expect(decode('Zm9v\nYmFy\n').output).toBe('foobar')
  })

  it('reports input that is not base64 at all as an error, not a crash', () => {
    const result = decode('not base64 ***')
    expect(result.ok).toBe(false)
    expect(result.output).toBe('')
    expect(result.error).toMatch(/base64/)
  })
})

describe('the url-safe alphabet', () => {
  // Six characters whose standard encoding uses both `+` and `/`, which is
  // exactly what the url-safe alphabet has to replace.
  const plain = '?????>'

  it('encodes with -_ instead of +/ and drops the padding', () => {
    expect(encode(plain).output).toBe('Pz8/Pz8+')
    expect(encode(plain, 'urlsafe').output).toBe('Pz8_Pz8-')
  })

  it('decodes either alphabet, whichever is selected', () => {
    expect(decode('Pz8_Pz8-', 'urlsafe').output).toBe(plain)
    expect(decode('Pz8_Pz8-').output).toBe(plain)
    expect(decode('Pz8/Pz8+', 'urlsafe').output).toBe(plain)
  })

  it('round-trips bytes that are not valid UTF-8', () => {
    // 0xFB 0xFF encodes to `+/8=` / `-_8`; neither byte can appear in UTF-8.
    const result = decode('-_8', 'urlsafe')
    expect(result.ok).toBe(true)
    expect(result.output).toContain('fb ff')
  })
})

describe('output that is not valid UTF-8', () => {
  const result = decode('-_8')

  it('renders a hex dump instead of replacement characters', () => {
    expect(result.output).toBe(
      '00000000  fb ff                                             |..|',
    )
    expect(result.output).not.toContain('�')
  })

  it('says so in a warning field', () => {
    expect(result.fields).toContainEqual({
      label: 'Encoding',
      value: 'not valid UTF-8 — shown as a hex dump',
      warn: true,
    })
  })
})

describe('base64 detection', () => {
  const detect = (input: string) => base64.detect?.(input) ?? 0

  it('recognises a base64 payload', () => {
    expect(detect('Zm9vYmFy')).toBeGreaterThan(0.5)
  })

  it('never scores above 0.7, so a more specific tool can outrank it', () => {
    for (const input of [
      'Zm9vYmFy',
      'Zg==',
      'aGVsbG8gd29ybGQ=',
      'YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXo=',
      'Pz8_Pz8-',
    ]) {
      expect(detect(input), input).toBeLessThanOrEqual(0.7)
    }
  })

  it('scores a 10-digit epoch as zero', () => {
    expect(detect('1757376000')).toBe(0)
  })

  it('scores digits alone as zero even at a valid length', () => {
    // 16 digits is a microsecond epoch and also a whole number of quartets.
    expect(detect('1757376000000000')).toBe(0)
  })

  it('scores a length that is not a whole number of quartets as zero', () => {
    expect(detect('Zm9vYmF')).toBe(0)
  })

  it.each(['', '   ', 'hello world!', '{"a":1}', '-----BEGIN CERTIFICATE-----'])(
    'scores %o as zero',
    (input) => {
      expect(detect(input)).toBe(0)
    },
  )
})

describe('the base64 tool definition', () => {
  it('defaults to decoding with the standard alphabet', () => {
    const defaults = Object.fromEntries(
      (base64.options ?? []).map((option) => [option.key, option.default]),
    )
    expect(defaults).toEqual({ mode: 'decode', alphabet: 'standard' })
  })

  it('decodes when handed no options at all', () => {
    expect(base64.run('Zm9vYmFy', {})).toMatchObject({ output: 'foobar' })
  })
})
