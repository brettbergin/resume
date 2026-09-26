import { deflateRawSync } from 'node:zlib'

import { describe, expect, it } from 'vitest'

import {
  DEFAULT_MAX_OUTPUT_BYTES,
  InflateLimitError,
  inflateRaw,
} from './inflate.ts'

/*
 * Every compressed vector here comes out of Node's zlib, which is the same
 * zlib an identity provider's SAML library used to build the redirect URL in
 * the first place. That is the point: a decompressor tested against streams
 * this repository also produced would only prove it agrees with itself,
 * whereas the details that break an inflater — a dynamic code table, a
 * run-length-coded table description, an overlapping back-reference — are
 * chosen by the encoder, not by the test.
 *
 * `node:zlib` is a reference here and nowhere else: nothing in `src/tools/`
 * can use it, since the page runs in a browser. It is the pattern
 * `pgp-dearmor.test.ts` uses `node:crypto` for.
 *
 * Bytes are compared as plain arrays (`Array.from(...)`), not as `Uint8Array`
 * instances, for the realm reason `base32.test.ts` documents: Node's buffers
 * and this module's arrays come from different realms under jsdom, and
 * `toEqual` on the typed arrays reports a spurious mismatch.
 */

const utf8 = new TextEncoder()

const deflate = (bytes: Uint8Array, level?: number): Uint8Array =>
  Uint8Array.from(
    level === undefined ? deflateRawSync(bytes) : deflateRawSync(bytes, { level }),
  )

/**
 * The `BTYPE` field of the first block header: bits 1-2 of the first byte,
 * since DEFLATE packs bits low-to-high. Asserted on the vectors below so that
 * "this case covers dynamic Huffman" is a checked claim rather than a belief
 * about what zlib felt like doing — a future zlib that changes its mind about
 * a heuristic should fail the coverage claim loudly, not quietly stop
 * exercising a branch.
 */
const firstBlockType = (compressed: Uint8Array): number =>
  (compressed[0] >> 1) & 0b11

const STORED = 0
const FIXED = 1
const DYNAMIC = 2

/** A SAML AuthnRequest of the shape the HTTP-Redirect binding carries: this
 * module's entire reason for existing, and long and repetitive enough that
 * zlib builds a dynamic code table for it. */
const AUTHN_REQUEST =
  '<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" ' +
  'xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ' +
  'ID="_8e1f2c4a6b9d0e3f5a7c" Version="2.0" ' +
  'IssueInstant="2024-03-14T09:26:53Z" Destination="https://idp.example.invalid/sso" ' +
  'ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" ' +
  'AssertionConsumerServiceURL="https://sp.example.invalid/acs">' +
  '<saml:Issuer>https://sp.example.invalid/metadata</saml:Issuer>' +
  '<samlp:NameIDPolicy Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress" ' +
  'AllowCreate="true"/></samlp:AuthnRequest>'

/** Pseudo-random but deterministic bytes: incompressible enough that zlib
 * gives up and stores them, which is how the stored-block path gets exercised
 * without hand-assembling a header. */
const noise = (length: number): Uint8Array =>
  Uint8Array.from({ length }, (_unused, index) => (index * 2654435761) % 251)

describe('inflateRaw round trips zlib-produced streams', () => {
  const cases: readonly [name: string, plaintext: Uint8Array][] = [
    ['empty input', new Uint8Array()],
    ['a single byte', utf8.encode('a')],
    ['a short string', utf8.encode('hello')],
    [
      'a sentence with no repeats to exploit',
      utf8.encode('The quick brown fox jumps over the lazy dog.'),
    ],
    ['every byte value', Uint8Array.from({ length: 256 }, (_unused, i) => i)],
    ['a SAML AuthnRequest', utf8.encode(AUTHN_REQUEST)],
    ['a highly repetitive payload', utf8.encode('saml'.repeat(20_000))],
    ['a single repeated byte, forcing distance 1', new Uint8Array(5000).fill(0x41)],
    ['incompressible noise', noise(200_000)],
  ]

  it.each(cases)('recovers %s', (_name, plaintext) => {
    expect(Array.from(inflateRaw(deflate(plaintext)))).toEqual(
      Array.from(plaintext),
    )
  })

  it.each(cases)('recovers %s compressed at level 1', (_name, plaintext) => {
    expect(Array.from(inflateRaw(deflate(plaintext, 1)))).toEqual(
      Array.from(plaintext),
    )
  })

  it.each(cases)('recovers %s compressed at level 9', (_name, plaintext) => {
    expect(Array.from(inflateRaw(deflate(plaintext, 9)))).toEqual(
      Array.from(plaintext),
    )
  })
})

describe('inflateRaw covers every block type RFC 1951 defines', () => {
  it('decodes stored blocks', () => {
    const plaintext = utf8.encode('stored blocks carry their bytes verbatim')
    const compressed = deflate(plaintext, 0)

    expect(firstBlockType(compressed)).toBe(STORED)
    expect(Array.from(inflateRaw(compressed))).toEqual(Array.from(plaintext))
  })

  it('decodes a run of stored blocks past the 65535-byte block limit', () => {
    // Level 0 stores everything, and a stored block's length field is 16 bits
    // wide, so 200 KB is four blocks: the only vector here that proves the
    // loop moves on to the next block header rather than stopping at the
    // first.
    const plaintext = noise(200_000)
    const compressed = deflate(plaintext, 0)

    expect(firstBlockType(compressed)).toBe(STORED)
    expect(Array.from(inflateRaw(compressed))).toEqual(Array.from(plaintext))
  })

  it('decodes fixed-Huffman blocks', () => {
    // Too short to pay for a code table, so zlib uses the fixed codes.
    const plaintext = utf8.encode('abcabcabc')
    const compressed = deflate(plaintext)

    expect(firstBlockType(compressed)).toBe(FIXED)
    expect(Array.from(inflateRaw(compressed))).toEqual(Array.from(plaintext))
  })

  it('decodes dynamic-Huffman blocks', () => {
    const plaintext = utf8.encode(AUTHN_REQUEST)
    const compressed = deflate(plaintext)

    expect(firstBlockType(compressed)).toBe(DYNAMIC)
    expect(Array.from(inflateRaw(compressed))).toEqual(Array.from(plaintext))
  })

  it('decodes a dynamic block whose table description uses long zero runs', () => {
    // An alphabet of two characters leaves almost every literal code unused,
    // which is what drives zlib to emit symbol 18 — "repeat a zero length up
    // to 138 times" — in the code-length header.
    const plaintext = utf8.encode('ab'.repeat(30_000))
    const compressed = deflate(plaintext)

    expect(firstBlockType(compressed)).toBe(DYNAMIC)
    expect(Array.from(inflateRaw(compressed))).toEqual(Array.from(plaintext))
  })
})

describe('inflateRaw handles long back-references', () => {
  it('reproduces an overlapping run written one byte at a time', () => {
    // Distance 1, length 258: the maximum-length back-reference, reading
    // bytes it is itself writing. A block copy would get this wrong.
    const plaintext = utf8.encode(`x${'y'.repeat(4000)}z`)

    expect(Array.from(inflateRaw(deflate(plaintext)))).toEqual(
      Array.from(plaintext),
    )
  })

  it('reproduces a match from near the 32 KB window limit', () => {
    const filler = 'the distance between these two markers is nearly a window '
    const plaintext = utf8.encode(
      `MARKER-SEQUENCE-ALPHA${filler.repeat(600)}MARKER-SEQUENCE-ALPHA`,
    )

    expect(Array.from(inflateRaw(deflate(plaintext)))).toEqual(
      Array.from(plaintext),
    )
  })
})

describe('inflateRaw bounds how much output a stream can ask for', () => {
  /*
   * A decompression bomb: 32 MiB of zeros, which zlib squeezes into a few
   * tens of kilobytes. Compressed by node:zlib rather than assembled here,
   * for the same reason as every other vector in this file — the ratio that
   * makes a bomb a bomb is the encoder's doing, not ours.
   */
  const BOMB_PLAINTEXT_BYTES = 32 * 1024 * 1024
  const bomb = deflate(new Uint8Array(BOMB_PLAINTEXT_BYTES), 9)

  it('refuses a bomb that would blow past the default limit', () => {
    expect(BOMB_PLAINTEXT_BYTES).toBeGreaterThan(DEFAULT_MAX_OUTPUT_BYTES)
    expect(bomb.length).toBeLessThan(BOMB_PLAINTEXT_BYTES / 100)

    expect(() => inflateRaw(bomb)).toThrow(InflateLimitError)
    expect(() => inflateRaw(bomb)).toThrow(
      `inflate: decompressed output exceeds the ${DEFAULT_MAX_OUTPUT_BYTES}-byte limit`,
    )
  })

  it('stops at the byte that crosses the caller limit, not one earlier', () => {
    const compressed = deflate(noise(4096))

    expect(inflateRaw(compressed, { limit: 4096 })).toHaveLength(4096)
    expect(() => inflateRaw(compressed, { limit: 4095 })).toThrow(InflateLimitError)
  })

  it('caps stored blocks, which never go through a Huffman table', () => {
    const compressed = deflate(noise(200_000), 0)

    expect(firstBlockType(compressed)).toBe(STORED)
    expect(() => inflateRaw(compressed, { limit: 1000 })).toThrow(InflateLimitError)
  })

  it('caps an overlapping back-reference, which writes without reading input', () => {
    // Distance 1 for 200 KB: the run the decoder produces from almost no
    // compressed bits at all, and the one a per-symbol check would miss if it
    // only counted symbols rather than bytes.
    const compressed = deflate(utf8.encode('y'.repeat(200_000)))

    expect(() => inflateRaw(compressed, { limit: 5000 })).toThrow(InflateLimitError)
  })

  it('refuses the bomb quickly rather than working through it', () => {
    // Without a cap this same call decodes all 32 MiB — seconds of blocked
    // main thread and a buffer grown by doubling to match. The bound is loose
    // on purpose: it only has to separate "gave up early" from "inflated the
    // whole thing", not measure anything.
    const started = performance.now()
    expect(() => inflateRaw(bomb)).toThrow(InflateLimitError)
    expect(performance.now() - started).toBeLessThan(1000)
  })

  it('still decodes a stream that lands exactly on the limit', () => {
    const plaintext = utf8.encode(AUTHN_REQUEST)

    expect(
      Array.from(inflateRaw(deflate(plaintext), { limit: plaintext.length })),
    ).toEqual(Array.from(plaintext))
  })

  it('rejects a limit that is not a usable size', () => {
    const compressed = deflate(utf8.encode('hello'))

    expect(() => inflateRaw(compressed, { limit: -1 })).toThrow(/non-negative/)
    expect(() => inflateRaw(compressed, { limit: Number.NaN })).toThrow(/non-negative/)
  })
})

describe('inflateRaw rejects input it cannot decode', () => {
  const valid = deflate(utf8.encode(AUTHN_REQUEST))

  it('throws on a stream truncated mid-block', () => {
    expect(() => inflateRaw(valid.subarray(0, valid.length - 5))).toThrow(
      /inflate:/,
    )
  })

  it('throws on a stream truncated to its first byte', () => {
    expect(() => inflateRaw(valid.subarray(0, 1))).toThrow(/inflate:/)
  })

  it('throws on empty input, which has no block header at all', () => {
    expect(() => inflateRaw(new Uint8Array())).toThrow(/end of compressed input/)
  })

  it('throws on a reserved block type', () => {
    // BFINAL=1, BTYPE=3 (reserved), then filler the reader never reaches.
    expect(() => inflateRaw(Uint8Array.from([0b111, 0, 0, 0]))).toThrow(
      /reserved block type/,
    )
  })

  it('throws when a stored block disagrees with its own length complement', () => {
    const compressed = deflate(utf8.encode('stored'), 0)
    const corrupted = Uint8Array.from(compressed)
    corrupted[3] ^= 0xff

    expect(() => inflateRaw(corrupted)).toThrow(/complement/)
  })

  it('throws on a stored block whose bytes were cut short', () => {
    const compressed = deflate(noise(4096), 0)

    expect(() => inflateRaw(compressed.subarray(0, 2048))).toThrow(
      /end of stored block/,
    )
  })

  it('throws on a dynamic header with an inconsistent code table', () => {
    // BFINAL=1, BTYPE=2, then HLIT/HDIST/HCLEN of zero and code lengths that
    // claim four one-bit codes — twice what a binary tree has room for.
    const corrupted = Uint8Array.from(valid)
    corrupted.fill(0x01, 1, 6)

    expect(() => inflateRaw(corrupted)).toThrow(/inflate:/)
  })

  it('throws rather than hanging on arbitrary garbage', () => {
    // Sixteen unrelated byte patterns pushed through the whole decoder. The
    // assertion is that each one ends — in a throw or, where the bits happen
    // to decode, in bytes — instead of spinning on a malformed table.
    for (let seed = 0; seed < 16; seed += 1) {
      const garbage = Uint8Array.from({ length: 64 }, (_unused, index) =>
        ((index + 1) * (seed + 7) * 37) % 256,
      )
      expect(() => {
        try {
          inflateRaw(garbage)
        } catch (error) {
          expect((error as Error).message).toMatch(/^inflate:/)
        }
      }).not.toThrow()
    }
  })
})
