import { describe, expect, it } from 'vitest'

import {
  Asn1Error,
  findFirst,
  oidToString,
  parseDer,
  readBitString,
  readInteger,
  readString,
  readTime,
} from './asn1.ts'

/*
 * Every input here is written out as the bytes it is, one array literal per
 * case, rather than assembled by an encoder. A vendored parser tested against
 * its own encoder proves only that the two agree, and the encodings that
 * break a DER reader — a length that lies about its size, a two-digit year on
 * the wrong side of the pivot, a subidentifier that spans two bytes — are
 * exactly the ones an encoder would never produce. Written by hand, each
 * array can be checked against X.690 by eye.
 *
 * The one exception is the long-form length case, whose payload is 300 filler
 * bytes: the header is literal, the padding is generated, since three hundred
 * hand-written zeroes prove nothing the loop does not.
 */

const der = (...bytes: number[]): Uint8Array => Uint8Array.from(bytes)

describe('parseDer structure', () => {
  it('reads a primitive INTEGER', () => {
    const node = parseDer(der(0x02, 0x01, 0x05))

    expect(node.tagClass).toBe('universal')
    expect(node.tagNumber).toBe(2)
    expect(node.constructed).toBe(false)
    expect(node.header).toBe(2)
    expect(node.length).toBe(1)
    expect(Array.from(node.contents)).toEqual([0x05])
    expect(node.children).toBeUndefined()
  })

  it('recurses into a nested SEQUENCE', () => {
    // SEQUENCE { SEQUENCE { INTEGER 1 }, INTEGER 65537 }
    const node = parseDer(
      der(
        0x30, 0x0a,
        0x30, 0x03, 0x02, 0x01, 0x01,
        0x02, 0x03, 0x01, 0x00, 0x01,
      ),
    )

    expect(node.constructed).toBe(true)
    expect(node.children).toHaveLength(2)

    const [inner, integer] = node.children ?? []
    expect(inner.tagNumber).toBe(16)
    expect(inner.children).toHaveLength(1)
    expect(readInteger(inner.children?.[0].contents ?? der())).toBe(1n)
    expect(readInteger(integer.contents)).toBe(65537n)
  })

  it('recurses into a SET', () => {
    // SET { SEQUENCE { OID 2.5.4.3, PrintableString "ca" } } — one RDN, the
    // shape a distinguished name is made of.
    const node = parseDer(
      der(
        0x31, 0x0b,
        0x30, 0x09,
        0x06, 0x03, 0x55, 0x04, 0x03,
        0x13, 0x02, 0x63, 0x61,
      ),
    )

    expect(node.tagNumber).toBe(17)
    const attribute = findFirst(node, [0])
    expect(oidToString(findFirst(attribute!, [0])?.contents ?? der())).toBe(
      '2.5.4.3',
    )
    expect(readString(findFirst(attribute!, [1])!)).toBe('ca')
  })

  it('recurses into a context-specific constructed tag', () => {
    // [0] { INTEGER 2 } — a certificate's explicit version field.
    const node = parseDer(der(0xa0, 0x03, 0x02, 0x01, 0x02))

    expect(node.tagClass).toBe('context')
    expect(node.tagNumber).toBe(0)
    expect(node.constructed).toBe(true)
    expect(readInteger(findFirst(node, [0])?.contents ?? der())).toBe(2n)
  })

  it('does not recurse into a primitive whose contents look like DER', () => {
    // OCTET STRING wrapping an INTEGER, which is how an extension carries its
    // value: the bytes are DER, but the node is primitive and the caller
    // decides whether to re-parse them.
    const node = parseDer(der(0x04, 0x03, 0x02, 0x01, 0x07))

    expect(node.children).toBeUndefined()
    expect(readInteger(parseDer(node.contents).contents)).toBe(7n)
  })

  it('reads a high-tag-number identifier', () => {
    // Context-specific, constructed, tag number 128: 0xbf then 0x81 0x00.
    const node = parseDer(der(0xbf, 0x81, 0x00, 0x03, 0x02, 0x01, 0x07))

    expect(node.tagClass).toBe('context')
    expect(node.tagNumber).toBe(128)
    expect(node.header).toBe(4)
    expect(readInteger(findFirst(node, [0])?.contents ?? der())).toBe(7n)
  })
})

describe('parseDer lengths', () => {
  it('reads a single-byte long-form length', () => {
    // 0x81 0x80: 128 content bytes, the first size the short form cannot hold.
    const contents = Array.from({ length: 128 }, (_unused, index) => index)
    const node = parseDer(der(0x04, 0x81, 0x80, ...contents))

    expect(node.header).toBe(3)
    expect(node.length).toBe(128)
    expect(node.contents[127]).toBe(127)
  })

  it('reads a multi-byte long-form length', () => {
    // 0x82 0x01 0x2c: 300 content bytes, inside a SEQUENCE so the length has
    // to be right for the child walk to line up too.
    const payload = Array.from({ length: 300 }, () => 0xab)
    const node = parseDer(
      der(0x30, 0x82, 0x01, 0x30, 0x04, 0x82, 0x01, 0x2c, ...payload),
    )

    expect(node.length).toBe(0x130)
    const child = findFirst(node, [0])
    expect(child?.header).toBe(4)
    expect(child?.length).toBe(300)
    expect(child?.contents).toHaveLength(300)
  })
})

describe('parseDer rejects malformed input', () => {
  const cases: readonly [name: string, bytes: Uint8Array, match: RegExp][] = [
    ['an empty buffer', der(), /empty input/],
    [
      'a truncated value',
      der(0x30, 0x03, 0x02, 0x01),
      /past end of input/,
    ],
    ['a length longer than the buffer', der(0x04, 0x05, 0x01), /past end of input/],
    [
      'an indefinite-length header',
      der(0x30, 0x80, 0x02, 0x01, 0x01, 0x00, 0x00),
      /indefinite-length/,
    ],
    ['the reserved length byte 0xff', der(0x04, 0xff, 0x01), /reserved length/],
    ['a truncated long-form length', der(0x04, 0x82, 0x01), /truncated long-form/],
    ['a missing length octet', der(0x04), /truncated length/],
    ['an eight-byte length', der(0x04, 0x88, 0, 0, 0, 0, 0, 0, 0, 1), /too large/],
    ['a truncated multi-byte tag', der(0xbf, 0x81), /truncated multi-byte tag/],
    ['trailing bytes after the top-level node', der(0x05, 0x00, 0x00), /trailing bytes/],
    [
      'a child that overruns its parent',
      // SEQUENCE of 4 bytes holding a 3-byte INTEGER and a stray tag.
      der(0x30, 0x04, 0x02, 0x01, 0x01, 0x05),
      /truncated length/,
    ],
  ]

  it.each(cases)('throws on %s', (_name, bytes, match) => {
    expect(() => parseDer(bytes)).toThrow(Asn1Error)
    expect(() => parseDer(bytes)).toThrow(match)
  })

  it('refuses nesting deeper than its limit instead of exhausting the stack', () => {
    // The one input not written out literally: 40 nested [0] wrappers, built
    // outward from an INTEGER — enough to pass the limit, and small enough
    // that every length stays in short form. A parser without a depth guard
    // either recurses until the stack goes or, worse, loops.
    let bytes = der(0x02, 0x01, 0x01)
    for (let depth = 0; depth < 40; depth += 1) {
      bytes = der(0xa0, bytes.length, ...bytes)
    }

    expect(() => parseDer(bytes)).toThrow(Asn1Error)
    expect(() => parseDer(bytes)).toThrow(/nesting deeper/)
  })
})

describe('oidToString', () => {
  it('reads sha256WithRSAEncryption', () => {
    expect(oidToString(der(0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0b))).toBe(
      '1.2.840.113549.1.1.11',
    )
  })

  it.each([
    // 311 is 0x82 0x37: a subidentifier spanning two bytes mid-OID.
    [
      'a multi-byte subidentifier',
      der(0x2b, 0x06, 0x01, 0x04, 0x01, 0x82, 0x37, 0x15, 0x14),
      '1.3.6.1.4.1.311.21.20',
    ],
    // Arc 2's second subidentifier is not bounded by 40, so 100 encodes as
    // 80 + 100 = 180, itself a two-byte subidentifier. X.690's own example.
    ['an unbounded arc under joint-iso-itu-t', der(0x81, 0x34, 0x03), '2.100.3'],
    ['ed25519', der(0x2b, 0x65, 0x70), '1.3.101.112'],
    ['prime256v1', der(0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07), '1.2.840.10045.3.1.7'],
    // domainComponent, the deepest OID a certificate subject routinely
    // carries and the one case with a first arc of 0.
    [
      'a first arc of 0',
      der(0x09, 0x92, 0x26, 0x89, 0x93, 0xf2, 0x2c, 0x64, 0x01, 0x19),
      '0.9.2342.19200300.100.1.25',
    ],
    ['subjectAltName', der(0x55, 0x1d, 0x11), '2.5.29.17'],
  ])('reads %s', (_name, contents, expected) => {
    expect(oidToString(contents)).toBe(expected)
  })

  it('throws on an empty or unterminated OID', () => {
    expect(() => oidToString(der())).toThrow(/empty OBJECT IDENTIFIER/)
    expect(() => oidToString(der(0x2a, 0x86))).toThrow(/mid-subidentifier/)
  })
})

describe('readInteger', () => {
  it.each([
    ['zero', der(0x00), 0n],
    ['a small positive', der(0x05), 5n],
    ['a positive needing a leading zero', der(0x00, 0xff), 255n],
    ['65537', der(0x01, 0x00, 0x01), 65537n],
    ['-1', der(0xff), -1n],
    ['-128', der(0x80), -128n],
  ])('reads %s', (_name, contents, expected) => {
    expect(readInteger(contents)).toBe(expected)
  })

  it('reads a serial number past 2**53 without losing digits', () => {
    // A 16-byte serial, the size a public CA issues, as a Number would round.
    const contents = der(
      0x0d, 0xe0, 0xd1, 0x9e, 0x7d, 0x51, 0x4f, 0x2c,
      0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88,
    )
    expect(readInteger(contents)).toBe(
      0x0de0d19e7d514f2c1122334455667788n,
    )
  })

  it('throws on an empty INTEGER', () => {
    expect(() => readInteger(der())).toThrow(Asn1Error)
  })
})

describe('readBitString', () => {
  it('separates the unused-bit count from the bytes', () => {
    const { unusedBits, bytes } = readBitString(parseDer(der(0x03, 0x02, 0x05, 0xa0)).contents)

    expect(unusedBits).toBe(5)
    expect(Array.from(bytes)).toEqual([0xa0])
  })

  it('reads a whole-byte bit string, as a signature is', () => {
    const { unusedBits, bytes } = readBitString(
      parseDer(der(0x03, 0x04, 0x00, 0xde, 0xad, 0xbe)).contents,
    )

    expect(unusedBits).toBe(0)
    expect(Array.from(bytes)).toEqual([0xde, 0xad, 0xbe])
  })

  it('throws on a malformed bit string', () => {
    expect(() => readBitString(der())).toThrow(/missing the unused-bits octet/)
    expect(() => readBitString(der(0x08, 0xff))).toThrow(/8 unused bits/)
    expect(() => readBitString(der(0x03))).toThrow(/carries no bytes/)
  })
})

describe('readTime', () => {
  const time = (...bytes: number[]): Date => readTime(parseDer(der(...bytes)))

  /** `UTCTime "490101000000Z"` — the tag, the length, then the digits. */
  it('applies the 2050 pivot below the boundary', () => {
    expect(
      time(
        0x17, 0x0d,
        0x34, 0x39, 0x30, 0x31, 0x30, 0x31, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x5a,
      ).toISOString(),
    ).toBe('2049-01-01T00:00:00.000Z')
  })

  /** `UTCTime "500101000000Z"` — 50 is 1950, not 2050. */
  it('applies the 2050 pivot on and above the boundary', () => {
    expect(
      time(
        0x17, 0x0d,
        0x35, 0x30, 0x30, 0x31, 0x30, 0x31, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x5a,
      ).toISOString(),
    ).toBe('1950-01-01T00:00:00.000Z')
  })

  /** `UTCTime "250909123456Z"`, a routine notBefore. */
  it('reads a UTCTime to the second', () => {
    expect(
      time(
        0x17, 0x0d,
        0x32, 0x35, 0x30, 0x39, 0x30, 0x39, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x5a,
      ).toISOString(),
    ).toBe('2025-09-09T12:34:56.000Z')
  })

  /** `UTCTime "9912312359+0100"` — no seconds, and an offset instead of Z,
   * both of which older certificates contain. */
  it('reads a UTCTime with no seconds and a zone offset', () => {
    expect(
      time(
        0x17, 0x0f,
        0x39, 0x39, 0x31, 0x32, 0x33, 0x31, 0x32, 0x33, 0x35, 0x39,
        0x2b, 0x30, 0x31, 0x30, 0x30,
      ).toISOString(),
    ).toBe('1999-12-31T22:59:00.000Z')
  })

  /** `GeneralizedTime "20500101000000Z"` — the encoding X.509 switches to at
   * exactly the year UTCTime becomes ambiguous. */
  it('reads a GeneralizedTime', () => {
    expect(
      time(
        0x18, 0x0f,
        0x32, 0x30, 0x35, 0x30, 0x30, 0x31, 0x30, 0x31,
        0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x5a,
      ).toISOString(),
    ).toBe('2050-01-01T00:00:00.000Z')
  })

  /** `GeneralizedTime "20250909123456.500Z"`. */
  it('reads a GeneralizedTime with fractional seconds', () => {
    expect(
      time(
        0x18, 0x13,
        0x32, 0x30, 0x32, 0x35, 0x30, 0x39, 0x30, 0x39,
        0x31, 0x32, 0x33, 0x34, 0x35, 0x36,
        0x2e, 0x35, 0x30, 0x30, 0x5a,
      ).toISOString(),
    ).toBe('2025-09-09T12:34:56.500Z')
  })

  /** `GeneralizedTime "19991231235959-0500"`. */
  it('reads a GeneralizedTime with a negative offset', () => {
    expect(
      time(
        0x18, 0x13,
        0x31, 0x39, 0x39, 0x39, 0x31, 0x32, 0x33, 0x31,
        0x32, 0x33, 0x35, 0x39, 0x35, 0x39,
        0x2d, 0x30, 0x35, 0x30, 0x30,
      ).toISOString(),
    ).toBe('2000-01-01T04:59:59.000Z')
  })

  it('throws on a malformed or impossible time', () => {
    // UTCTime "25099123456Z": a digit short.
    expect(() =>
      time(
        0x17, 0x0c,
        0x32, 0x35, 0x30, 0x39, 0x39, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x5a,
      ),
    ).toThrow(/malformed UTCTime/)

    // UTCTime "250231000000Z": 31 February, which must not roll into March.
    expect(() =>
      time(
        0x17, 0x0d,
        0x32, 0x35, 0x30, 0x32, 0x33, 0x31, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x5a,
      ),
    ).toThrow(/not a real date/)

    // UTCTime "251301000000Z": month 13.
    expect(() =>
      time(
        0x17, 0x0d,
        0x32, 0x35, 0x31, 0x33, 0x30, 0x31, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x5a,
      ),
    ).toThrow(/out-of-range component/)

    // GeneralizedTime "2025090912345": too short for the pattern.
    expect(() =>
      time(
        0x18, 0x0d,
        0x32, 0x30, 0x32, 0x35, 0x30, 0x39, 0x30, 0x39, 0x31, 0x32, 0x33, 0x34, 0x35,
      ),
    ).toThrow(/malformed GeneralizedTime/)
  })

  it('throws when the node is not a time type', () => {
    expect(() => time(0x02, 0x01, 0x01)).toThrow(/not a time type/)
  })
})

describe('readString', () => {
  const text = (...bytes: number[]): string => readString(parseDer(der(...bytes)))

  it('reads a PrintableString', () => {
    // PrintableString "Brett"
    expect(text(0x13, 0x05, 0x42, 0x72, 0x65, 0x74, 0x74)).toBe('Brett')
  })

  it('reads a UTF8String, multi-byte code points included', () => {
    // UTF8String "café" — the é is two bytes.
    expect(text(0x0c, 0x05, 0x63, 0x61, 0x66, 0xc3, 0xa9)).toBe('café')
  })

  it('reads an IA5String, as an email or a DNS SAN is', () => {
    // IA5String "a@b.co"
    expect(text(0x16, 0x06, 0x61, 0x40, 0x62, 0x2e, 0x63, 0x6f)).toBe('a@b.co')
  })

  it('reads a T61String as Latin-1', () => {
    // T61String with a high byte: decoded as Latin-1, not dropped.
    expect(text(0x14, 0x03, 0x61, 0xe9, 0x62)).toBe('aéb')
  })

  it('throws on a type it does not decode', () => {
    // OCTET STRING: bytes, not text, and guessing would be worse than failing.
    expect(() => text(0x04, 0x02, 0x00, 0x01)).toThrow(/not a supported string type/)
  })
})

describe('findFirst', () => {
  // SEQUENCE { SEQUENCE { OID 2.5.29.17, BOOLEAN-free }, INTEGER 9 }
  const tree = parseDer(
    der(
      0x30, 0x0c,
      0x30, 0x05, 0x06, 0x03, 0x55, 0x1d, 0x11,
      0x02, 0x03, 0x01, 0x00, 0x01,
    ),
  )

  it('walks an index path to a nested node', () => {
    expect(oidToString(findFirst(tree, [0, 0])?.contents ?? der())).toBe('2.5.29.17')
    expect(findFirst(tree, [1])?.tagNumber).toBe(2)
  })

  it('returns the node itself for an empty path', () => {
    expect(findFirst(tree, [])).toBe(tree)
  })

  it('returns undefined for a path that does not exist', () => {
    // Past the end, and through a primitive that has no children at all —
    // the two ways an optional field turns out to be absent.
    expect(findFirst(tree, [2])).toBeUndefined()
    expect(findFirst(tree, [1, 0])).toBeUndefined()
    expect(findFirst(tree, [0, 0, 0])).toBeUndefined()
  })
})
