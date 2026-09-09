/*
 * A minimal DER reader, vendored.
 *
 * Vendored rather than imported because the certificate tool needs to walk a
 * few well-known structures — a Certificate, a CertificationRequest, an
 * SPKI public key — and every ASN.1 library that does that in general is
 * orders of magnitude larger than the walking. The page ships no
 * dependencies, so the subset the tools actually use lives here instead.
 *
 * What it covers: DER, the distinguished encoding, as X.509 uses it. Tags in
 * both low- and high-tag-number form, definite lengths in short and long
 * form, recursion into anything marked constructed, and value decoders for
 * the handful of types a certificate puts in front of a reader — INTEGER,
 * OBJECT IDENTIFIER, BIT STRING, UTCTime, GeneralizedTime and the text
 * strings that carry a distinguished name.
 *
 * What it deliberately does not cover:
 *
 * - **BER.** Indefinite lengths, constructed strings assembled from
 *   fragments and non-minimal length encodings are all legal BER and all
 *   rejected here. An indefinite-length header throws rather than being
 *   tolerated: guessing where a value ends is exactly how a parser reads
 *   past its buffer.
 * - **Schema validation.** Nothing here knows what a Certificate looks
 *   like. `parseDer` returns the tree that is in the bytes, and the caller
 *   navigates it; a node in an unexpected place is the caller's problem to
 *   report, not this module's to reinterpret.
 * - **Canonical-form checks.** A non-minimal INTEGER or a SET whose members
 *   are misordered decodes to its value rather than an error. The tools read
 *   certificates other systems produced; refusing one over an encoding nit
 *   would hide the fields the reader came to see.
 *
 * Every failure is an `Asn1Error` with a message naming the offset, so the
 * cert tool can render it inline. Self-contained by design — no imports,
 * browser or otherwise — and it only ever reads: no buffer that goes in is
 * modified, and `contents` is a view into it rather than a copy.
 */

/** A malformed input. Typed so a caller can tell a parse failure from a bug
 * in its own navigation, and always carries a message. */
export class Asn1Error extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'Asn1Error'
  }
}

/** The two tag-number bits of the identifier octet, as their names. */
export type Asn1TagClass = 'universal' | 'application' | 'context' | 'private'

/** One TLV. `header` is the identifier and length octets, `length` the
 * content octets, so `header + length` is the node's total encoded size and
 * `contents` is a view of exactly the value. `children` is present only for
 * constructed nodes. */
export interface Asn1Node {
  tagClass: Asn1TagClass
  tagNumber: number
  constructed: boolean
  header: number
  length: number
  contents: Uint8Array
  children?: Asn1Node[]
}

/** Universal tag numbers this module decodes by name. */
export const TAG = {
  integer: 2,
  bitString: 3,
  octetString: 4,
  null: 5,
  oid: 6,
  utf8String: 12,
  sequence: 16,
  set: 17,
  numericString: 18,
  printableString: 19,
  t61String: 20,
  ia5String: 22,
  utcTime: 23,
  generalizedTime: 24,
  visibleString: 26,
} as const

const TAG_CLASSES: readonly Asn1TagClass[] = [
  'universal',
  'application',
  'context',
  'private',
]

/** Nesting past this is a malformed input rather than a structure any
 * certificate contains — a guard so a crafted file cannot exhaust the stack
 * on the way to an out-of-memory rather than an error message. */
const MAX_DEPTH = 32

/** The identifier octets. The low five bits being all ones means the tag
 * number continues in base-128 bytes; a certificate never needs that, but a
 * reader that stops there mis-parses everything after it. */
function readTag(
  bytes: Uint8Array,
  at: number,
): { tagClass: Asn1TagClass; tagNumber: number; constructed: boolean; size: number } {
  const identifier = bytes[at]
  const tagClass = TAG_CLASSES[identifier >> 6]
  const constructed = (identifier & 0x20) !== 0
  const low = identifier & 0x1f

  if (low !== 0x1f) {
    return { tagClass, tagNumber: low, constructed, size: 1 }
  }

  let tagNumber = 0
  let size = 1
  for (;;) {
    if (at + size >= bytes.length) {
      throw new Asn1Error(`truncated multi-byte tag at offset ${at}`)
    }
    const byte = bytes[at + size]
    size += 1
    // Bounded so the accumulator stays an exact integer; anything this large
    // is not a tag number, it is a corrupt file.
    if (tagNumber > 0xffffff) {
      throw new Asn1Error(`tag number too large at offset ${at}`)
    }
    tagNumber = (tagNumber << 7) | (byte & 0x7f)
    if ((byte & 0x80) === 0) break
  }
  return { tagClass, tagNumber, constructed, size }
}

/** The length octets. Short form is the byte itself; long form is a count of
 * following big-endian bytes. `0x80` is BER's indefinite length and `0xff` is
 * reserved — both are refused rather than guessed at. */
function readLength(
  bytes: Uint8Array,
  at: number,
): { length: number; size: number } {
  if (at >= bytes.length) {
    throw new Asn1Error(`truncated length at offset ${at}`)
  }
  const first = bytes[at]

  if (first < 0x80) return { length: first, size: 1 }
  if (first === 0x80) {
    throw new Asn1Error(
      `indefinite-length header at offset ${at}: BER, not supported`,
    )
  }
  if (first === 0xff) {
    throw new Asn1Error(`reserved length byte 0xff at offset ${at}`)
  }

  const count = first & 0x7f
  if (count > 6) {
    // Six bytes is already past any buffer a browser will hold, and it keeps
    // the accumulator inside Number's exact-integer range.
    throw new Asn1Error(`length of ${count} bytes at offset ${at} is too large`)
  }
  if (at + 1 + count > bytes.length) {
    throw new Asn1Error(`truncated long-form length at offset ${at}`)
  }

  let length = 0
  for (let index = 0; index < count; index += 1) {
    length = length * 256 + bytes[at + 1 + index]
  }
  return { length, size: 1 + count }
}

/** One node starting at `at`, plus every node inside it when it is
 * constructed. Returns the node and its total encoded size so the caller can
 * step to the next sibling. */
function parseNode(
  bytes: Uint8Array,
  at: number,
  depth: number,
): { node: Asn1Node; size: number } {
  if (depth > MAX_DEPTH) {
    throw new Asn1Error(`nesting deeper than ${MAX_DEPTH} at offset ${at}`)
  }
  if (at >= bytes.length) {
    throw new Asn1Error(`expected a tag at offset ${at}, past end of input`)
  }

  const tag = readTag(bytes, at)
  const { length, size: lengthSize } = readLength(bytes, at + tag.size)
  const header = tag.size + lengthSize
  const start = at + header

  if (start + length > bytes.length) {
    throw new Asn1Error(
      `declared length ${length} at offset ${at} runs ${start + length - bytes.length} bytes past end of input`,
    )
  }

  const contents = bytes.subarray(start, start + length)
  const node: Asn1Node = {
    tagClass: tag.tagClass,
    tagNumber: tag.tagNumber,
    constructed: tag.constructed,
    header,
    length,
    contents,
  }

  if (tag.constructed) {
    node.children = parseChildren(contents, depth + 1)
  }

  return { node, size: header + length }
}

/** Every node in a constructed value's contents. The contents must divide
 * exactly into nodes: a remainder means the length was wrong, which is worth
 * an error rather than a silently dropped tail. */
function parseChildren(contents: Uint8Array, depth: number): Asn1Node[] {
  const children: Asn1Node[] = []
  let offset = 0
  while (offset < contents.length) {
    const { node, size } = parseNode(contents, offset, depth)
    // Every node is at least a tag and a length byte, so `size` is never
    // zero and the loop always advances.
    children.push(node)
    offset += size
  }
  return children
}

/**
 * The single DER node in `bytes`, with its subtree.
 *
 * Strict about trailing bytes: a certificate, a CSR and an SPKI key are each
 * exactly one top-level SEQUENCE, so anything after it means the caller
 * handed over a concatenation or a truncated buffer, and both are better
 * reported than half-parsed. A PEM file with several blocks is split by the
 * caller before it gets here.
 */
export function parseDer(bytes: Uint8Array): Asn1Node {
  if (bytes.length === 0) throw new Asn1Error('empty input: no DER to parse')

  const { node, size } = parseNode(bytes, 0, 0)
  if (size !== bytes.length) {
    throw new Asn1Error(
      `${bytes.length - size} trailing bytes after the top-level node`,
    )
  }
  return node
}

/**
 * The node at `path`, each element an index into the children of the node
 * before it, or `undefined` when the path does not exist.
 *
 * Indexes rather than tags because that is how the structures being read are
 * specified — a Certificate's validity is `[0, 4]`, its SANs are inside a
 * particular extension — and because `undefined` for a missing optional
 * field lets the cert tool render "absent" without a try/catch around every
 * lookup.
 */
export function findFirst(
  node: Asn1Node,
  path: readonly number[],
): Asn1Node | undefined {
  let current: Asn1Node | undefined = node
  for (const index of path) {
    current = current?.children?.[index]
    if (current === undefined) return undefined
  }
  return current
}

/**
 * An OBJECT IDENTIFIER's content bytes as dotted decimal.
 *
 * The first byte packs two arcs, `40 * first + second`, which works only
 * because the first arc is 0, 1 or 2; under arc 2 the second arc is
 * unbounded, so it is whatever is left after subtracting 80 rather than
 * something modulo 40. Later arcs are base-128 with a continuation bit, and
 * they are accumulated as `bigint`: the arcs in a Microsoft or a UUID-derived
 * OID comfortably exceed 2**53.
 */
export function oidToString(contents: Uint8Array): string {
  if (contents.length === 0) throw new Asn1Error('empty OBJECT IDENTIFIER')

  const arcs: string[] = []
  let value = 0n
  let started = false

  for (let index = 0; index < contents.length; index += 1) {
    const byte = contents[index]
    value = (value << 7n) | BigInt(byte & 0x7f)
    if ((byte & 0x80) !== 0) continue

    if (!started) {
      // The two arcs packed into the first subidentifier.
      const first = value < 40n ? 0n : value < 80n ? 1n : 2n
      arcs.push(String(first), String(value - first * 40n))
      started = true
    } else {
      arcs.push(String(value))
    }
    value = 0n
  }

  if ((contents[contents.length - 1] & 0x80) !== 0) {
    throw new Asn1Error('OBJECT IDENTIFIER ends mid-subidentifier')
  }
  return arcs.join('.')
}

/**
 * An INTEGER's content bytes as a `bigint`, two's complement and signed.
 *
 * `bigint` because the values that matter are RSA moduli and serial numbers:
 * a 2048-bit modulus and a 20-byte serial are both routine, and both lose
 * digits as a `number`. Negative encodings are handled even though nothing in
 * a certificate should use one, because a serial number with a high bit set
 * and no leading zero is a real, common encoding bug and reading it as a huge
 * positive number would be worse than reading it as negative.
 */
export function readInteger(contents: Uint8Array): bigint {
  if (contents.length === 0) throw new Asn1Error('empty INTEGER')

  let value = 0n
  for (const byte of contents) value = (value << 8n) | BigInt(byte)

  if ((contents[0] & 0x80) !== 0) {
    // Two's complement: subtract 2**bits to put the sign back.
    value -= 1n << BigInt(contents.length * 8)
  }
  return value
}

/** A BIT STRING's content bytes: the leading octet counts the unused bits in
 * the final byte, and the rest is the value. Returned as-is rather than
 * shifted — the callers either hand the bytes to a hash or re-parse them as
 * DER, and both want them exactly as encoded. */
export function readBitString(contents: Uint8Array): {
  unusedBits: number
  bytes: Uint8Array
} {
  if (contents.length === 0) {
    throw new Asn1Error('empty BIT STRING: missing the unused-bits octet')
  }
  const unusedBits = contents[0]
  if (unusedBits > 7) {
    throw new Asn1Error(`BIT STRING declares ${unusedBits} unused bits`)
  }
  if (unusedBits > 0 && contents.length === 1) {
    throw new Asn1Error(
      `BIT STRING declares ${unusedBits} unused bits but carries no bytes`,
    )
  }
  return { unusedBits, bytes: contents.subarray(1) }
}

const UTC_TIME =
  /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?(Z|[+-]\d{4})$/
const GENERALIZED_TIME =
  /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?(?:[.,](\d{1,3})\d*)?(Z|[+-]\d{4})$/

/** A `Z`, `+hhmm` or `-hhmm` suffix as milliseconds to subtract from the
 * wall-clock reading to get UTC. */
function zoneOffsetMs(zone: string): number {
  if (zone === 'Z') return 0
  const sign = zone.startsWith('-') ? -1 : 1
  const hours = Number(zone.slice(1, 3))
  const minutes = Number(zone.slice(3, 5))
  if (hours > 23 || minutes > 59) {
    throw new Asn1Error(`invalid time zone offset ${zone}`)
  }
  return sign * (hours * 60 + minutes) * 60_000
}

/** The instant described by the parts, with the components checked against
 * what `Date.UTC` made of them so that an impossible date — 31 February, a
 * month of 13 — is an error instead of quietly rolling into the next one. */
function toInstant(
  parts: {
    year: number
    month: number
    day: number
    hour: number
    minute: number
    second: number
    millisecond: number
  },
  zone: string,
  raw: string,
): Date {
  const { year, month, day, hour, minute, second, millisecond } = parts
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59 ||
    // 60 is a leap second, which X.690 permits and which no browser Date
    // represents; it lands on the next minute, which is close enough.
    second > 60
  ) {
    throw new Asn1Error(`time ${raw} has an out-of-range component`)
  }

  const utc = Date.UTC(year, month - 1, day, hour, minute, second, millisecond)
  const rolled = new Date(utc)
  if (rolled.getUTCMonth() !== month - 1 || rolled.getUTCDate() !== day) {
    throw new Asn1Error(`time ${raw} is not a real date`)
  }
  return new Date(utc - zoneOffsetMs(zone))
}

/**
 * A UTCTime or GeneralizedTime node as a `Date`.
 *
 * Both types are accepted from one function because both appear in the same
 * field: X.509 says a validity date before 2050 is a UTCTime and one from
 * 2050 on is a GeneralizedTime, so any code reading `notAfter` has to handle
 * either. UTCTime's two-digit year pivots at 50 per RFC 5280 §4.1.2.5.1 —
 * `49` is 2049 and `50` is 1950 — which is the one piece of this that a
 * reader cannot infer from the bytes.
 *
 * Seconds are optional in UTCTime and offsets other than `Z` are legal in
 * older certificates, so both are handled even though DER requires `Z` and
 * full seconds.
 */
export function readTime(node: Asn1Node): Date {
  const raw = new TextDecoder('utf-8', { fatal: false }).decode(node.contents)

  if (node.tagNumber === TAG.utcTime) {
    const match = UTC_TIME.exec(raw)
    if (match === null) throw new Asn1Error(`malformed UTCTime ${raw}`)
    const twoDigitYear = Number(match[1])
    return toInstant(
      {
        year: twoDigitYear >= 50 ? 1900 + twoDigitYear : 2000 + twoDigitYear,
        month: Number(match[2]),
        day: Number(match[3]),
        hour: Number(match[4]),
        minute: Number(match[5]),
        second: Number(match[6] ?? '0'),
        millisecond: 0,
      },
      match[7],
      raw,
    )
  }

  if (node.tagNumber === TAG.generalizedTime) {
    const match = GENERALIZED_TIME.exec(raw)
    if (match === null) throw new Asn1Error(`malformed GeneralizedTime ${raw}`)
    return toInstant(
      {
        year: Number(match[1]),
        month: Number(match[2]),
        day: Number(match[3]),
        hour: Number(match[4]),
        minute: Number(match[5]),
        second: Number(match[6] ?? '0'),
        millisecond: Number((match[7] ?? '').padEnd(3, '0')),
      },
      match[8],
      raw,
    )
  }

  throw new Asn1Error(`tag ${node.tagNumber} is not a time type`)
}

/** T61String's bytes, mapped as Latin-1. T61 is a shifting character set
 * nobody should still be emitting, and the certificates that do use it use it
 * for accented names in the Latin-1 range; decoding the rest of T61 properly
 * would be more code than the whole walker. */
const decodeLatin1 = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => String.fromCharCode(byte)).join('')

/**
 * A text node's value.
 *
 * The four types a distinguished name actually carries. PrintableString and
 * IA5String are ASCII subsets, so UTF-8 decoding covers them exactly; a
 * PrintableString containing a byte it should not is still rendered rather
 * than refused, since the point is to show the reader what the certificate
 * claims. NumericString and VisibleString come along for free, being ASCII
 * subsets too.
 */
export function readString(node: Asn1Node): string {
  switch (node.tagNumber) {
    case TAG.utf8String:
    case TAG.printableString:
    case TAG.ia5String:
    case TAG.numericString:
    case TAG.visibleString:
      return new TextDecoder('utf-8', { fatal: false }).decode(node.contents)
    case TAG.t61String:
      return decodeLatin1(node.contents)
    default:
      throw new Asn1Error(`tag ${node.tagNumber} is not a supported string type`)
  }
}
