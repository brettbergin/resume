/*
 * OpenPGP ASCII armor, unwrapped: CRC-24 and the armor envelope (RFC 4880 §6).
 *
 * Vendored rather than imported because the only thing the GPG tool needs
 * from an OpenPGP library is the outermost layer — turn the block of base64
 * someone pasted back into the bytes it was, and say whether the checksum
 * line agrees. Every library that does that also brings key generation,
 * every cipher and a session-key parser, which is orders of magnitude more
 * code than the unwrapping and none of it is wanted on a page that ships no
 * dependencies. So the envelope lives here, next to the tool that opens it.
 *
 * What it covers: the armor header line, the optional `Key: value` header
 * lines a producer may emit ahead of the blank separator, the base64 body
 * across however many wrapped lines it arrived in, the `=` checksum line and
 * the matching footer. The label is read from the header and checked against
 * the footer but not otherwise judged: a public key block, a private key
 * block and a signature all arrive through here identically, and which of
 * them the caller is willing to read is the caller's rule to state, not this
 * module's to guess.
 *
 * What it deliberately does not cover:
 *
 * - **The cleartext signature framework** (RFC 4880 §7). A signed message
 *   has two armor sections, dash-escaped text between them and a different
 *   set of rules for both; none of that is a key.
 * - **Armor without a checksum line.** RFC 9580 makes the trailing CRC-24
 *   optional, but this parser requires it, because `crcOk: true` is meant to
 *   mean the checksum was there and matched. A caller that must accept
 *   checksum-less armor needs a third state, not a `true` that stands for
 *   "nothing to check".
 * - **Deciding what a failure was.** Missing markers, a body that is not
 *   base64 and a checksum that does not match all return the same empty
 *   result. The distinction the reader on the page cares about is whether
 *   the paste survived the trip, and a `crcOk: false` says exactly that.
 *
 * The checksum is a transcription check and nothing more: CRC-24 catches the
 * line an email client wrapped or the character a terminal ate, and any
 * party who altered the key on purpose would simply recompute it. Nothing
 * here authenticates anything.
 *
 * Self-contained by design — no imports, browser or otherwise — and it only
 * ever reads: the string that goes in is not modified, and the bytes that
 * come out are freshly allocated. Never throws; a caller that hands over
 * arbitrary pasted text gets a result either way.
 */

/** Raw bytes recovered from an armored block, and whether the trailing
 * CRC-24 checksum line matched them. `crcOk: false` always comes with empty
 * `data`: bytes that failed their own checksum are not worth parsing. */
export interface DearmorResult {
  data: Uint8Array
  crcOk: boolean
}

/** The generator polynomial, x^24 + x^23 + x^18 + ... (RFC 4880 §6.1), with
 * the x^24 bit kept so the shift-and-reduce loop can XOR it out in one go. */
const CRC24_POLYNOMIAL = 0x1864cfb

/** CRC-24's non-zero initial value, which makes leading zero bytes count. */
const CRC24_INIT = 0xb704ce

/**
 * The CRC-24 checksum of `data`, as the low 24 bits of a number — the same
 * value the `=` line of an armored block carries, before it was base64'd.
 *
 * Bitwise rather than table-driven: a 256-entry table would be faster on
 * megabytes and a key is kilobytes, so the loop that can be read against the
 * RFC's own sample code wins.
 */
export function crc24(data: Uint8Array): number {
  let crc = CRC24_INIT
  for (const byte of data) {
    crc ^= byte << 16
    for (let bit = 0; bit < 8; bit += 1) {
      crc <<= 1
      if (crc & 0x1000000) crc ^= CRC24_POLYNOMIAL
    }
  }
  return crc & 0xffffff
}

/** `-----BEGIN PGP SIGNATURE-----` and friends. The label is captured so the
 * footer can be held to the same one; the character class is what RFC 4880
 * §6.2 puts in a label — `PGP MESSAGE, PART 3/14` is the widest of them —
 * and deliberately excludes `-`, so the marker's own dashes cannot be read
 * as part of the label. */
const BEGIN_LINE = /^-----BEGIN PGP ([A-Z0-9 ,/]+)-----$/

const END_LINE = /^-----END PGP ([A-Z0-9 ,/]+)-----$/

/** An armor header, `Version: GnuPG v2` or `Comment: anything at all`. No
 * base64 line can match this, since `:` is not in the alphabet. */
const HEADER_LINE = /^[A-Za-z][A-Za-z0-9-]*:/

/** One wrapped line of the body. Padding, where present, ends the block. */
const BODY_LINE = /^[A-Za-z0-9+/]+={0,2}$/

/** The checksum line: `=` then exactly four base64 digits, three bytes'
 * worth. A body line never starts with `=` — padding only ever follows
 * data — so this is unambiguous. */
const CHECKSUM_LINE = /^=[A-Za-z0-9+/]{4}$/

const BASE64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Reverse lookup by character code, `-1` for anything not a base64 digit.
 * `=` included: padding is handled by trimming it, so a `=` left in the
 * middle of a block decodes to the same rejection as any other stray byte. */
const BASE64_VALUES = (() => {
  const values = new Int8Array(128).fill(-1)
  for (let index = 0; index < BASE64_ALPHABET.length; index += 1) {
    values[BASE64_ALPHABET.charCodeAt(index)] = index
  }
  return values
})()

/** Every failure returns its own empty result rather than a shared one, so
 * no caller can be handed an array another caller already has. */
const failed = (): DearmorResult => ({ data: new Uint8Array(0), crcOk: false })

/**
 * Strict base64 to bytes, or `null` if `text` is not base64. Strict is the
 * point: unlike the base64 tool, which decodes what a log file happened to
 * contain, armor is machine-written and fully padded, so a length that is
 * not a multiple of four means characters went missing in transit — exactly
 * the corruption the checksum exists to report.
 */
function decodeBase64(text: string): Uint8Array | null {
  if (text.length % 4 !== 0) return null

  let padding = 0
  while (padding < 2 && text.charCodeAt(text.length - 1 - padding) === 0x3d) {
    padding += 1
  }

  const digits = text.length - padding
  const bytes = new Uint8Array((text.length / 4) * 3 - padding)

  let buffer = 0
  let bits = 0
  let written = 0
  for (let index = 0; index < digits; index += 1) {
    const code = text.charCodeAt(index)
    const value = code < 128 ? BASE64_VALUES[code] : -1
    if (value < 0) return null
    buffer = (buffer << 6) | value
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes[written] = (buffer >> bits) & 0xff
      written += 1
    }
  }

  return bytes
}

/**
 * The bytes inside an ASCII-armored OpenPGP block.
 *
 * Text before the header line and after the footer is ignored, so a key
 * pasted out of the middle of an email still reads. Everything between them
 * has to be armor: a line that is neither a header, a body line, the
 * checksum nor the footer fails the parse rather than being skipped, since
 * silently dropping a line would change the bytes the caller fingerprints.
 */
export function dearmor(text: string): DearmorResult {
  const lines = text.split(/\r\n|\r|\n/)

  let index = 0
  let label: string | null = null
  for (; index < lines.length && label === null; index += 1) {
    const begin = BEGIN_LINE.exec(lines[index].trim())
    if (begin) label = begin[1]
  }
  if (label === null) return failed()

  // The armor headers, then the blank line separating them from the body.
  // Both are optional in practice — a modern GnuPG export emits no headers
  // at all — so this consumes whatever is there and stops at the first line
  // that could be content.
  while (index < lines.length) {
    const line = lines[index].trim()
    if (line !== '' && !HEADER_LINE.test(line)) break
    index += 1
  }

  const body: string[] = []
  let checksum: string | null = null
  let closed = false
  for (; index < lines.length; index += 1) {
    const line = lines[index].trim()

    // Blank lines are tolerated inside the body: a mail client that rewrapped
    // the paste may have introduced one, and the checksum is what decides
    // whether the surviving characters are still the whole key.
    if (line === '') continue

    const end = END_LINE.exec(line)
    if (end) {
      closed = end[1] === label
      break
    }

    if (checksum === null && CHECKSUM_LINE.test(line)) {
      checksum = line.slice(1)
      continue
    }

    // Nothing but the footer may follow the checksum, and a body line that
    // is not base64 is corruption rather than something to step over.
    if (checksum !== null || !BODY_LINE.test(line)) return failed()
    body.push(line)
  }
  if (!closed || checksum === null) return failed()

  const data = decodeBase64(body.join(''))
  if (data === null) return failed()

  const declared = decodeBase64(checksum)
  if (declared === null || declared.length !== 3) return failed()
  const expected = (declared[0] << 16) | (declared[1] << 8) | declared[2]
  if (expected !== crc24(data)) return failed()

  return { data, crcOk: true }
}
