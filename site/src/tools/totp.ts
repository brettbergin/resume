/*
 * TOTP (RFC 6238): the current code for a 2FA secret, and the next one, so a
 * reader mid-window can see what to type without waiting for the ring to
 * turn over.
 *
 * Input is either a bare base32 secret — what an authenticator app's manual
 * entry screen shows — or a full `otpauth://totp/...` provisioning URI, the
 * thing a QR code actually encodes. Both name the same handful of parameters
 * (`secret`, `algorithm`, `digits`, `period`), so one parser reads either
 * shape into the same record and the rest of the tool never cares which one
 * arrived.
 *
 * RFC 4226's dynamic truncation, run over `crypto.subtle.sign('HMAC', ...)`,
 * is the whole algorithm: no npm authenticator library, no reimplemented
 * HMAC. The counter is `floor(unixTime / period)`, encoded as a big-endian
 * 8-byte value — RFC 6238 is HOTP (RFC 4226) with the counter derived from
 * the clock instead of incremented by use.
 *
 * `sensitive: true` (see `Tool.sensitive` in types.ts) rather than marking the
 * input `secret` some other way: a TOTP secret is the *entire* input, not one
 * option among several, so the tool opts out of the fragment altogether
 * instead of asking the fragment layer to know which field is dangerous.
 *
 * `live: true` is what redraws the countdown and rolls the current code into
 * the next one as a window boundary passes, the same mechanism the JWT tool
 * uses for its expiry countdown: the pane re-runs a live tool once a second,
 * so this module stays a pure function of (input, options, clock).
 */

import type { Tool, ToolField, ToolOptions, ToolResult } from './types.ts'
import { decodeBase32 } from './vendor/base32.ts'

/* Web Crypto takes a `BufferSource`, which excludes an array backed by a
 * `SharedArrayBuffer`; naming the backing buffer (as jwt.ts does for the same
 * reason) keeps that check at the two helpers that build byte arrays rather
 * than at every call into `crypto.subtle`. */
type Bytes = Uint8Array<ArrayBuffer>

/** The three hash algorithms RFC 6238 Appendix B exercises, and Web Crypto
 * supports directly for HMAC. Keyed by the `otpauth://` `algorithm=` value,
 * uppercased, so parsing and lookup share one representation. */
const ALGORITHMS: Record<string, string> = {
  SHA1: 'SHA-1',
  SHA256: 'SHA-256',
  SHA512: 'SHA-512',
}

/** The digit counts Google Authenticator's provisioning format and RFC 6238
 * Appendix B between them actually use. Anything else is rejected rather than
 * truncated or padded to one of these, since a wrong digit count is a code an
 * authenticator app will never produce. */
const DIGIT_LENGTHS = new Set([6, 8])

const DEFAULT_ALGORITHM = 'SHA1'
const DEFAULT_DIGITS = 6
const DEFAULT_PERIOD = 30

/** The parsed shape both input forms reduce to. `secret` is still base32
 * text at this point — decoding happens once, in `run`, so a parse error and
 * a decode error are reported through the same path. */
interface ParsedInput {
  secret: string
  algorithm: string
  digits: number
  period: number
}

/** True for a string of only the RFC 4648 base32 alphabet — the cheap check
 * `detect` needs, not the exact grammar `decodeBase32` enforces (padding
 * placement, zero trailing bits), which is more than a confidence score
 * should have to get right. */
function looksLikeBase32(text: string): boolean {
  return /^[A-Z2-7]+=*$/.test(text)
}

/** `otpauth://totp/...` into its four parameters, or `null` for anything that
 * is not that scheme — the caller then tries the input as a bare secret
 * instead of failing outright. Unlike `parseTotpUri`, this never throws: it
 * is also `detect`'s way of recognising a provisioning URI. */
function parseOtpauthUri(text: string): URL | null {
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return null
  }
  if (url.protocol !== 'otpauth:' || url.hostname !== 'totp') return null
  return url
}

/** A provisioning URI's query parameters into `ParsedInput`, or a thrown
 * `Error` naming what is wrong — a missing secret or an algorithm the tool
 * does not implement — for `run` to turn into `{ ok: false }`. */
function parseUri(url: URL): ParsedInput {
  const params = url.searchParams
  const secret = params.get('secret')
  if (secret === null || secret === '') {
    throw new Error('the otpauth URI has no secret= parameter')
  }

  const algorithmParam = (params.get('algorithm') ?? DEFAULT_ALGORITHM).toUpperCase()
  if (!(algorithmParam in ALGORITHMS)) {
    throw new Error(
      `unsupported algorithm ${algorithmParam} — this tool implements SHA1, SHA256 and SHA512`,
    )
  }

  const digitsParam = params.get('digits')
  const digits = digitsParam === null ? DEFAULT_DIGITS : Number(digitsParam)
  if (!DIGIT_LENGTHS.has(digits)) {
    throw new Error(`unsupported digit count ${digitsParam ?? ''} — this tool produces 6 or 8`)
  }

  const periodParam = params.get('period')
  const period = periodParam === null ? DEFAULT_PERIOD : Number(periodParam)
  if (!Number.isFinite(period) || period <= 0) {
    throw new Error(`invalid period ${periodParam ?? ''}`)
  }

  return { secret, algorithm: algorithmParam, digits, period }
}

/** The tool's whole input parse: an `otpauth://totp/...` URI first, and a
 * bare base32 secret otherwise. Throws an `Error` whose message becomes the
 * result's `error` — every failure here is something the reader typed, never
 * a bug. */
function parseInput(input: string): ParsedInput {
  const trimmed = input.trim()
  if (trimmed === '') throw new Error('enter a base32 secret or an otpauth:// URI')

  const uri = parseOtpauthUri(trimmed)
  if (uri !== null) return parseUri(uri)

  return {
    secret: trimmed,
    algorithm: DEFAULT_ALGORITHM,
    digits: DEFAULT_DIGITS,
    period: DEFAULT_PERIOD,
  }
}

/** The RFC 6238 counter as a big-endian 8-byte value — HOTP's counter is
 * 64-bit, and `crypto.subtle.sign` wants the exact bytes to HMAC, not a
 * `number`. `counter` fits in a `number` until year 292277026596, so a
 * `BigInt` split is the only part that needs 64 bits. */
function counterBytes(counter: number): Bytes {
  const bytes = new Uint8Array(8)
  let value = BigInt(counter)
  for (let index = 7; index >= 0; index -= 1) {
    bytes[index] = Number(value & 0xffn)
    value >>= 8n
  }
  return bytes
}

/** RFC 4226 §5.3 dynamic truncation: the low nibble of the last MAC byte picks
 * a 4-byte offset, the top bit of that 4-byte word is dropped to keep the
 * result a positive 31-bit integer, and the code is that value mod
 * `10^digits`, zero-padded back out to `digits` characters. */
function truncate(mac: Bytes, digits: number): string {
  const offset = mac[mac.length - 1] & 0x0f
  const binary =
    ((mac[offset] & 0x7f) << 24) |
    ((mac[offset + 1] & 0xff) << 16) |
    ((mac[offset + 2] & 0xff) << 8) |
    (mac[offset + 3] & 0xff)
  const code = binary % 10 ** digits
  return String(code).padStart(digits, '0')
}

/** One HOTP code (RFC 4226) for `secretBytes` at `counter`, under `algorithm`
 * (a Web Crypto hash name, already validated). Exported for the unit tests,
 * which HMAC the RFC 6238 Appendix B seeds directly — those seeds are raw
 * ASCII bytes, not base32, so they bypass `decodeBase32` on the way in. */
export async function hotp(
  secretBytes: Bytes,
  counter: number,
  algorithm: string,
  digits: number,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    secretBytes,
    { name: 'HMAC', hash: algorithm },
    false,
    ['sign'],
  )
  const mac = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, counterBytes(counter)),
  )
  return truncate(mac, digits)
}

/** The RFC 6238 counter for `period`, as of `Date.now()` — floor, never
 * round, since the code is only valid until the clock actually crosses into
 * the next window. */
function currentCounter(period: number): number {
  return Math.floor(Date.now() / 1000 / period)
}

async function run(input: string, _options: ToolOptions): Promise<ToolResult> {
  if (input.trim() === '') return { ok: true, output: '' }

  let parsed: ParsedInput
  try {
    parsed = parseInput(input)
  } catch (error) {
    return {
      ok: false,
      output: '',
      error: error instanceof Error ? error.message : String(error),
    }
  }

  let secretBytes: Bytes
  try {
    // `decodeBase32` returns a plain `Uint8Array`; `Uint8Array.from` copies it
    // into one backed by a fresh `ArrayBuffer`, which is what makes it a
    // `Bytes` the `crypto.subtle` calls below will accept.
    secretBytes = Uint8Array.from(decodeBase32(parsed.secret))
  } catch (error) {
    return {
      ok: false,
      output: '',
      error: error instanceof Error ? error.message : String(error),
    }
  }
  if (secretBytes.length === 0) {
    return { ok: false, output: '', error: 'the secret decodes to zero bytes' }
  }

  const algorithm = ALGORITHMS[parsed.algorithm]
  const counter = currentCounter(parsed.period)
  const elapsed = Date.now() / 1000 - counter * parsed.period
  const secondsRemaining = Math.ceil(parsed.period - elapsed)

  const [current, next] = await Promise.all([
    hotp(secretBytes, counter, algorithm, parsed.digits),
    hotp(secretBytes, counter + 1, algorithm, parsed.digits),
  ])

  const fields: ToolField[] = [
    { label: 'Current code', value: current },
    { label: 'Next code', value: next },
    { label: 'Seconds remaining', value: String(secondsRemaining) },
    { label: 'Algorithm', value: parsed.algorithm },
    { label: 'Digits', value: String(parsed.digits) },
  ]

  // The ring the header comment promises "turns over": full at the window's
  // start, empty the instant `secondsRemaining` would reach zero.
  const progress = { fraction: secondsRemaining / parsed.period }

  return { ok: true, output: current, fields, progress }
}

/** High confidence (0.9) for a well-formed `otpauth://totp/...` URI with a
 * `secret=` — nothing else on the page produces that scheme. Low confidence
 * (0.2) for a plausible bare base32 secret: the alphabet is shared with hex
 * and base64, so it never outranks either of those on its own. */
function detect(input: string): number {
  const trimmed = input.trim()
  if (trimmed === '') return 0

  const uri = parseOtpauthUri(trimmed)
  if (uri !== null && (uri.searchParams.get('secret') ?? '') !== '') return 0.9

  const upper = trimmed.toUpperCase()
  return looksLikeBase32(upper) && upper.length >= 8 ? 0.2 : 0
}

export const totp = {
  id: 'totp',
  name: 'TOTP',
  detect,
  run,
  live: true,
  sensitive: true,
} satisfies Tool
