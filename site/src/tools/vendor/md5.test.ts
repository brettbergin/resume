import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { md5 } from './md5.ts'

/*
 * The RFC 1321 A.5 suite, verbatim, is the whole point of a vendored hash:
 * these seven digests are published, so they pin the implementation to the
 * standard rather than to itself.
 *
 * The suite's longest case is 80 bytes, which already crosses a block
 * boundary, but it crosses only one. Padding is where hand-written MD5 goes
 * wrong — the length field lands in a block of its own when the message ends
 * within eight bytes of the boundary — so the block-boundary cases are checked
 * against Node's own `createHash('md5')`, an independent implementation that
 * happens to be sitting in the test runner. It is a reference here and nowhere
 * else: nothing in `src/tools/` can use it, since the page runs in a browser.
 */

const utf8 = new TextEncoder()

const digest = (text: string): string => md5(utf8.encode(text))

/** RFC 1321, appendix A.5. */
const RFC_1321_SUITE: readonly [input: string, digest: string][] = [
  ['', 'd41d8cd98f00b204e9800998ecf8427e'],
  ['a', '0cc175b9c0f1b6a831c399e269772661'],
  ['abc', '900150983cd24fb0d6963f7d28e17f72'],
  ['message digest', 'f96b697d7cb7938d525a2f31aaf161d0'],
  ['abcdefghijklmnopqrstuvwxyz', 'c3fcd3d76192e4007dfb496cca67e13b'],
  [
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
    'd174ab98d277d9f5a5611c2c9f419d9f',
  ],
  [
    '1234567890'.repeat(8),
    '57edf4a22be3c955ac49da2e2107b67a',
  ],
]

describe('md5 against the RFC 1321 test suite', () => {
  it.each(RFC_1321_SUITE)('digests %j', (input, expected) => {
    expect(digest(input)).toBe(expected)
  })

  it('digests the 80-byte case, which spans two blocks', () => {
    const input = '1234567890'.repeat(8)
    expect(utf8.encode(input).length).toBeGreaterThan(64)
    expect(digest(input)).toBe('57edf4a22be3c955ac49da2e2107b67a')
  })
})

describe('md5 padding across block boundaries', () => {
  // 55/56 and 119/120 are where the eight-byte length field stops fitting in
  // the final block and forces another one; 64 and 128 are exact multiples.
  const lengths = [0, 1, 54, 55, 56, 57, 63, 64, 65, 118, 119, 120, 127, 128, 1000]

  it.each(lengths)('agrees with a reference implementation at %i bytes', (length) => {
    const bytes = Uint8Array.from({ length }, (_unused, index) => (index * 7 + 13) % 256)
    const reference = createHash('md5').update(bytes).digest('hex')
    expect(md5(bytes)).toBe(reference)
  })
})

describe('md5 output shape', () => {
  it('is always 32 lowercase hex digits', () => {
    for (const [input] of RFC_1321_SUITE) {
      expect(digest(input)).toMatch(/^[0-9a-f]{32}$/)
    }
  })

  it('digests bytes, not text, so it handles data that is not UTF-8', () => {
    const bytes = Uint8Array.from([0x00, 0xff, 0x80, 0xfe, 0x01])
    expect(md5(bytes)).toBe(createHash('md5').update(bytes).digest('hex'))
  })

  it('reads a view into a larger buffer, not the whole buffer', () => {
    // A `Uint8Array` handed over by a caller may be a window onto something
    // bigger — `subarray` returns one — and hashing the backing buffer instead
    // of the view would be a silent wrong answer.
    const backing = Uint8Array.from([9, 9, 0x61, 0x62, 0x63, 9])
    expect(md5(backing.subarray(2, 5))).toBe('900150983cd24fb0d6963f7d28e17f72')
  })
})
