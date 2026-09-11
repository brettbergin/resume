/*
 * Base32 (RFC 4648 §6), vendored.
 *
 * Vendored for the same reason as the other modules in this directory: no
 * npm dependency is worth taking for a decoder this small, and the TOTP tool
 * needs one to turn a base32 secret — typed by hand or embedded in an
 * `otpauth://` URI — into the raw key bytes RFC 6238 signs.
 *
 * Self-contained by design — no imports. Accepts upper or lower case and
 * either padded or unpadded input, since both show up in the wild depending
 * on which authenticator app or provisioning tool produced the secret.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/** Character -> 5-bit value, built once rather than searched per character. */
const VALUES = new Map<string, number>(
  Array.from(ALPHABET, (char, index) => [char, index]),
)

/**
 * Decodes a base32 string into its raw bytes.
 *
 * Padding (`=`) is optional and, when present, only accepted at the end of
 * the string — it is stripped before decoding, since it carries no bits of
 * its own. Whitespace is not accepted: callers that allow a user to paste a
 * secret with spaces or dashes are expected to strip those themselves, since
 * what counts as ignorable separator punctuation is a caller's decision.
 *
 * Throws on characters outside the RFC 4648 alphabet (case-insensitive) and
 * on padding that appears before the end of the string.
 */
export function decodeBase32(input: string): Uint8Array {
  const upper = input.toUpperCase()
  const padStart = upper.indexOf('=')
  const body = padStart === -1 ? upper : upper.slice(0, padStart)
  const padding = padStart === -1 ? '' : upper.slice(padStart)

  if (/[^=]/.test(padding)) {
    throw new Error('base32: padding character appears before the end of the input')
  }

  const bytes: number[] = []
  let buffer = 0
  let bits = 0

  for (const char of body) {
    const value = VALUES.get(char)
    if (value === undefined) {
      throw new Error(`base32: invalid character ${JSON.stringify(char)}`)
    }

    buffer = (buffer << 5) | value
    bits += 5

    if (bits >= 8) {
      bits -= 8
      bytes.push((buffer >> bits) & 0xff)
    }
  }

  // Whatever is left over must be padding bits, not data: base32 packs five
  // bits per character into eight-bit bytes, so a trailing group of fewer
  // than five bits is only valid if every one of those bits is zero.
  if (bits > 0 && (buffer & ((1 << bits) - 1)) !== 0) {
    throw new Error('base32: non-zero padding bits in final character')
  }

  return Uint8Array.from(bytes)
}
