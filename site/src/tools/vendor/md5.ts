/*
 * MD5 (RFC 1321), vendored.
 *
 * Vendored rather than imported for one reason: Web Crypto deliberately does
 * not implement MD5, and this page has no dependencies to spend on a hash
 * everyone agrees is broken. But broken is not the same as gone — an SSH key
 * fingerprint printed by older OpenSSH, a certificate thumbprint in a vendor
 * console, a checksum next to a download link are all still MD5, and matching
 * one against a value on screen is exactly the job the hash and cert tools do.
 * So the algorithm is here, in about a hundred lines, next to the tools that
 * need it: never to prove anything is authentic, only to reproduce a digest
 * someone else already printed.
 *
 * Self-contained by design — no imports, browser or otherwise. Operates on
 * bytes, so callers decide how text became bytes, and returns lowercase hex,
 * which is how every tool on the page renders a digest.
 */

/** Per-round left-rotation amounts, four rounds of sixteen (RFC 1321 §3.4). */
const SHIFTS = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5,
  9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11,
  16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10,
  15, 21,
]

/** The sine-derived round constants, `floor(abs(sin(i + 1)) * 2**32)`. The
 * spec prints them as a table; generating them is the same numbers and makes
 * a transcription typo impossible. */
const CONSTANTS = Uint32Array.from({ length: 64 }, (_unused, index) =>
  Math.floor(Math.abs(Math.sin(index + 1)) * 2 ** 32),
)

const rotateLeft = (value: number, shift: number): number =>
  ((value << shift) | (value >>> (32 - shift))) >>> 0

/** One 32-bit word as little-endian hex, the byte order MD5 digests print in. */
function wordToHex(word: number): string {
  let hex = ''
  for (let byte = 0; byte < 4; byte += 1) {
    hex += ((word >>> (byte * 8)) & 0xff).toString(16).padStart(2, '0')
  }
  return hex
}

/**
 * The padded message: the input, a single `0x80` byte, zeroes up to eight
 * short of a block boundary, then the bit length as a little-endian 64-bit
 * count. `bitLength >>> 0` takes the low word by ToUint32's own modulo, so
 * inputs above 512 MB still record their length correctly.
 */
function pad(bytes: Uint8Array): DataView {
  const blocks = ((bytes.length + 8) >> 6) + 1
  const padded = new Uint8Array(blocks * 64)
  padded.set(bytes)
  padded[bytes.length] = 0x80

  const view = new DataView(padded.buffer)
  const bitLength = bytes.length * 8
  view.setUint32(padded.length - 8, bitLength >>> 0, true)
  view.setUint32(padded.length - 4, Math.floor(bitLength / 2 ** 32), true)
  return view
}

/** The MD5 digest of `bytes`, as 32 lowercase hex digits. */
export function md5(bytes: Uint8Array): string {
  const view = pad(bytes)

  let h0 = 0x67452301
  let h1 = 0xefcdab89
  let h2 = 0x98badcfe
  let h3 = 0x10325476

  const block = new Uint32Array(16)
  for (let offset = 0; offset < view.byteLength; offset += 64) {
    for (let word = 0; word < 16; word += 1) {
      block[word] = view.getUint32(offset + word * 4, true)
    }

    let a = h0
    let b = h1
    let c = h2
    let d = h3

    for (let step = 0; step < 64; step += 1) {
      let mixed: number
      let wordIndex: number
      if (step < 16) {
        mixed = (b & c) | (~b & d)
        wordIndex = step
      } else if (step < 32) {
        mixed = (d & b) | (~d & c)
        wordIndex = (5 * step + 1) % 16
      } else if (step < 48) {
        mixed = b ^ c ^ d
        wordIndex = (3 * step + 5) % 16
      } else {
        mixed = c ^ (b | ~d)
        wordIndex = (7 * step) % 16
      }

      // Summed as floats and folded back to 32 bits: the four addends can
      // exceed 2**31, which `+` handles exactly at these magnitudes and `|0`
      // would not.
      const sum = (a + mixed + CONSTANTS[step] + block[wordIndex]) >>> 0
      a = d
      d = c
      c = b
      b = (b + rotateLeft(sum, SHIFTS[step])) >>> 0
    }

    h0 = (h0 + a) >>> 0
    h1 = (h1 + b) >>> 0
    h2 = (h2 + c) >>> 0
    h3 = (h3 + d) >>> 0
  }

  return wordToHex(h0) + wordToHex(h1) + wordToHex(h2) + wordToHex(h3)
}
