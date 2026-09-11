import { describe, expect, it } from 'vitest'

import { decodeBase32 } from './base32.ts'

/*
 * RFC 4648 §10 publishes the base32 encoding of "f", "fo", "foo", … as the
 * standard's own worked examples, so decoding them back to the original ASCII
 * pins this implementation to the spec rather than to itself.
 *
 * Bytes are compared as plain arrays (`Array.from(...)`), not as `Uint8Array`
 * instances: jsdom's global `TextEncoder` and this module's `Uint8Array.from`
 * come from different realms in this test environment, so `toEqual` on the
 * typed arrays themselves reports a spurious mismatch despite identical
 * contents.
 */
const asciiBytes = (text: string): number[] => Array.from(text, (char) => char.charCodeAt(0))

const RFC_4648_SUITE: readonly [encoded: string, plaintext: string][] = [
  ['', ''],
  ['MY======', 'f'],
  ['MZXQ====', 'fo'],
  ['MZXW6===', 'foo'],
  ['MZXW6YQ=', 'foob'],
  ['MZXW6YTB', 'fooba'],
  ['MZXW6YTBOI======', 'foobar'],
]

describe('decodeBase32 against the RFC 4648 test suite', () => {
  it.each(RFC_4648_SUITE)('decodes %j', (encoded, plaintext) => {
    expect(Array.from(decodeBase32(encoded))).toEqual(asciiBytes(plaintext))
  })

  it.each(RFC_4648_SUITE)('decodes %j lowercase', (encoded, plaintext) => {
    expect(Array.from(decodeBase32(encoded.toLowerCase()))).toEqual(asciiBytes(plaintext))
  })

  it.each(RFC_4648_SUITE)('decodes %j unpadded', (encoded, plaintext) => {
    expect(Array.from(decodeBase32(encoded.replace(/=+$/, '')))).toEqual(asciiBytes(plaintext))
  })
})

describe('decodeBase32 round trips arbitrary byte sequences', () => {
  // A hand-rolled encoder, independent of the implementation under test,
  // so the round trip checks the decoder against a second source rather
  // than against its own inverse.
  function encode(bytes: Uint8Array): string {
    const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
    let bits = 0
    let buffer = 0
    let output = ''
    for (const byte of bytes) {
      buffer = (buffer << 8) | byte
      bits += 8
      while (bits >= 5) {
        bits -= 5
        output += ALPHABET[(buffer >> bits) & 0x1f]
      }
    }
    if (bits > 0) {
      output += ALPHABET[(buffer << (5 - bits)) & 0x1f]
    }
    while (output.length % 8 !== 0) {
      output += '='
    }
    return output
  }

  const cases: readonly Uint8Array[] = [
    Uint8Array.from([]),
    Uint8Array.from([0]),
    Uint8Array.from([0xff]),
    Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]),
    Uint8Array.from({ length: 32 }, (_unused, index) => (index * 31 + 7) % 256),
  ]

  it.each(cases)('round trips %j', (bytes) => {
    expect(Array.from(decodeBase32(encode(bytes)))).toEqual(Array.from(bytes))
  })
})

describe('decodeBase32 error handling', () => {
  it('rejects characters outside the base32 alphabet', () => {
    expect(() => decodeBase32('MZX!')).toThrow(/invalid character/)
  })

  it('rejects digits 0, 1, 8, 9, which are not in the RFC 4648 alphabet', () => {
    expect(() => decodeBase32('MZX0')).toThrow(/invalid character/)
    expect(() => decodeBase32('MZX1')).toThrow(/invalid character/)
    expect(() => decodeBase32('MZX8')).toThrow(/invalid character/)
    expect(() => decodeBase32('MZX9')).toThrow(/invalid character/)
  })

  it('rejects padding that appears before the end of the input', () => {
    expect(() => decodeBase32('MZ=XW6==')).toThrow(/padding/)
  })

  it('rejects non-zero padding bits in the final character', () => {
    // 'MZXW6YQ=' ("foob") is valid because its last data character, Q
    // (10000), has zero low bits. 'MZXW6YR' sets those same low bits to
    // 001, which base32 padding requires to be zero.
    expect(() => decodeBase32('MZXW6YR')).toThrow(/padding bits/)
  })

  it('accepts the empty string as zero bytes', () => {
    expect(Array.from(decodeBase32(''))).toEqual([])
  })
})
