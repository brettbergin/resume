import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { hotp, totp } from './totp.ts'
import { decodeBase32 } from './vendor/base32.ts'

/** `decodeBase32` typed as a plain `Uint8Array`; `hotp` wants one backed by
 * an `ArrayBuffer` specifically (see the `Bytes` alias in totp.ts), so tests
 * that feed a decoded secret back into `hotp` copy it through
 * `Uint8Array.from` the same way `totp.run` does. */
const decodeSecret = (secret: string) => Uint8Array.from(decodeBase32(secret))

/*
 * RFC 6238 Appendix B publishes the standard's own worked examples: three
 * fixed ASCII secrets (one per hash, each sized to that hash's block length)
 * and a table of (time, algorithm) -> 8-digit code. Pinning against those
 * rather than against this implementation's own output is what proves the
 * HMAC, the counter encoding and the RFC 4226 truncation are right, not just
 * self-consistent.
 *
 * The seeds are ASCII byte strings, not base32, so these vectors call
 * `hotp` directly with the raw bytes — `run`'s base32 decoding is exercised
 * separately, below, against a secret that is actually base32.
 */
const ascii = new TextEncoder()

const SEED_SHA1 = '1234567890'.repeat(2)
const SEED_SHA256 = `${'1234567890'.repeat(3)}12`
const SEED_SHA512 = `${'1234567890'.repeat(6)}1234`

/** [unix seconds, expected 8-digit code], one table per hash — RFC 6238
 * Appendix B, period 30. */
const VECTORS_SHA1: readonly [number, string][] = [
  [59, '94287082'],
  [1111111109, '07081804'],
  [1111111111, '14050471'],
  [1234567890, '89005924'],
  [2000000000, '69279037'],
]
const VECTORS_SHA256: readonly [number, string][] = [
  [59, '46119246'],
  [1111111109, '68084774'],
  [1111111111, '67062674'],
  [1234567890, '91819424'],
  [2000000000, '90698825'],
]
const VECTORS_SHA512: readonly [number, string][] = [
  [59, '90693936'],
  [1111111109, '25091201'],
  [1111111111, '99943326'],
  [1234567890, '93441116'],
  [2000000000, '38618901'],
]

const counterAt = (unixSeconds: number): number => Math.floor(unixSeconds / 30)

describe('hotp against RFC 6238 Appendix B, 8 digits', () => {
  it.each(VECTORS_SHA1)('SHA1 at t=%i', async (time, expected) => {
    const code = await hotp(ascii.encode(SEED_SHA1), counterAt(time), 'SHA-1', 8)
    expect(code).toBe(expected)
  })

  it.each(VECTORS_SHA256)('SHA256 at t=%i', async (time, expected) => {
    const code = await hotp(
      ascii.encode(SEED_SHA256),
      counterAt(time),
      'SHA-256',
      8,
    )
    expect(code).toBe(expected)
  })

  it.each(VECTORS_SHA512)('SHA512 at t=%i', async (time, expected) => {
    const code = await hotp(
      ascii.encode(SEED_SHA512),
      counterAt(time),
      'SHA-512',
      8,
    )
    expect(code).toBe(expected)
  })
})

describe('hotp digit truncation', () => {
  it('produces the low 6 digits of the same vector at 6 digits', async () => {
    // RFC 4226 truncation is `binary mod 10^digits`, and 10^6 divides 10^8,
    // so a 6-digit code is the same computation carried one step further —
    // the low 6 digits of the 8-digit code above, not a different value.
    for (const [time, expected8] of VECTORS_SHA1) {
      const code = await hotp(ascii.encode(SEED_SHA1), counterAt(time), 'SHA-1', 6)
      expect(code).toBe(expected8.slice(-6))
    }
  })

  it('zero-pads a short code out to the requested digit count', async () => {
    const code = await hotp(ascii.encode(SEED_SHA1), counterAt(59), 'SHA-1', 8)
    expect(code).toHaveLength(8)
  })
})

describe('totp.run', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('reports itself as sensitive and live', () => {
    expect(totp.id).toBe('totp')
    expect(totp.sensitive).toBe(true)
    expect(totp.live).toBe(true)
  })

  it('returns an empty result for empty input', async () => {
    const result = await totp.run('', {})
    expect(result).toEqual({ ok: true, output: '' })
  })

  it('accepts a bare base32 secret and matches the direct HMAC computation', async () => {
    const secret = 'JBSWY3DPEHPK3PXP'
    vi.setSystemTime(1111111111 * 1000)

    const result = await totp.run(secret, {})
    expect(result.ok).toBe(true)

    const expected = await hotp(
      decodeSecret(secret),
      counterAt(1111111111),
      'SHA-1',
      6,
    )
    expect(result.output).toBe(expected)
    expect(result.fields).toContainEqual({
      label: 'Current code',
      value: expected,
    })
  })

  it('accepts an otpauth URI with explicit algorithm, digits and period', async () => {
    const secret = 'JBSWY3DPEHPK3PXP'
    vi.setSystemTime(1234567890 * 1000)

    const uri = `otpauth://totp/Example:alice@example.com?secret=${secret}&algorithm=SHA256&digits=8&period=30&issuer=Example`
    const result = await totp.run(uri, {})
    expect(result.ok).toBe(true)

    const expected = await hotp(
      decodeSecret(secret),
      counterAt(1234567890),
      'SHA-256',
      8,
    )
    expect(result.output).toBe(expected)
    expect(result.fields).toContainEqual({ label: 'Digits', value: '8' })
    expect(result.fields).toContainEqual({ label: 'Algorithm', value: 'SHA256' })
  })

  it('accepts an otpauth URI with no optional parameters, defaulting SHA1/6/30', async () => {
    const secret = 'JBSWY3DPEHPK3PXP'
    vi.setSystemTime(59 * 1000)

    const uri = `otpauth://totp/Example:alice@example.com?secret=${secret}`
    const result = await totp.run(uri, {})
    expect(result.ok).toBe(true)

    const expected = await hotp(decodeSecret(secret), counterAt(59), 'SHA-1', 6)
    expect(result.output).toBe(expected)
    expect(result.fields).toContainEqual({ label: 'Algorithm', value: 'SHA1' })
    expect(result.fields).toContainEqual({ label: 'Digits', value: '6' })
  })

  it('computes the next code as counter + 1', async () => {
    const secret = 'JBSWY3DPEHPK3PXP'
    vi.setSystemTime(1111111109 * 1000)

    const result = await totp.run(secret, {})
    const currentCounter = counterAt(1111111109)
    const expectedNext = await hotp(
      decodeSecret(secret),
      currentCounter + 1,
      'SHA-1',
      6,
    )
    expect(result.fields).toContainEqual({
      label: 'Next code',
      value: expectedNext,
    })
  })

  it('changes code exactly at the 30-second window boundary', async () => {
    const secret = 'JBSWY3DPEHPK3PXP'
    const windowStartSeconds = counterAt(1111111111) * 30

    vi.setSystemTime(windowStartSeconds * 1000 + 30 * 1000 - 1)
    const beforeBoundary = await totp.run(secret, {})
    const codeAtCounter = await hotp(
      decodeSecret(secret),
      windowStartSeconds / 30,
      'SHA-1',
      6,
    )
    expect(beforeBoundary.output).toBe(codeAtCounter)

    vi.setSystemTime(windowStartSeconds * 1000 + 30 * 1000)
    const afterBoundary = await totp.run(secret, {})
    const codeAtNextCounter = await hotp(
      decodeSecret(secret),
      windowStartSeconds / 30 + 1,
      'SHA-1',
      6,
    )
    expect(afterBoundary.output).toBe(codeAtNextCounter)
    expect(afterBoundary.output).not.toBe(beforeBoundary.output)
  })

  it('reports seconds remaining within the current window', async () => {
    const secret = 'JBSWY3DPEHPK3PXP'
    const windowStart = counterAt(1000) * 30
    vi.setSystemTime(windowStart * 1000 + 5 * 1000)

    const result = await totp.run(secret, {})
    expect(result.fields).toContainEqual({
      label: 'Seconds remaining',
      value: '25',
    })
  })

  it('reports progress as the fraction of the window remaining', async () => {
    const secret = 'JBSWY3DPEHPK3PXP'
    const windowStart = counterAt(1000) * 30

    vi.setSystemTime(windowStart * 1000)
    expect((await totp.run(secret, {})).progress).toEqual({ fraction: 1 })

    vi.setSystemTime(windowStart * 1000 + 5 * 1000)
    expect((await totp.run(secret, {})).progress).toEqual({
      fraction: 25 / 30,
    })

    vi.setSystemTime(windowStart * 1000 + 29 * 1000)
    expect((await totp.run(secret, {})).progress).toEqual({
      fraction: 1 / 30,
    })
  })

  it('rejects an empty-after-trim input the same as empty input', async () => {
    const result = await totp.run('   ', {})
    expect(result).toEqual({ ok: true, output: '' })
  })

  it('rejects invalid base32 characters', async () => {
    const result = await totp.run('not-valid-base32!!!', {})
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/invalid character/)
  })

  it('rejects an otpauth URI missing secret=', async () => {
    const result = await totp.run('otpauth://totp/Example:alice@example.com', {})
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/secret/)
  })

  it('rejects an unsupported algorithm', async () => {
    const result = await totp.run(
      'otpauth://totp/Example?secret=JBSWY3DPEHPK3PXP&algorithm=MD5',
      {},
    )
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/algorithm/)
  })

  it('rejects an unsupported digit count', async () => {
    const result = await totp.run(
      'otpauth://totp/Example?secret=JBSWY3DPEHPK3PXP&digits=7',
      {},
    )
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/digit/)
  })

  it('accepts algorithm values case-insensitively', async () => {
    const secret = 'JBSWY3DPEHPK3PXP'
    vi.setSystemTime(59 * 1000)
    const result = await totp.run(
      `otpauth://totp/Example?secret=${secret}&algorithm=sha256`,
      {},
    )
    expect(result.ok).toBe(true)
    expect(result.fields).toContainEqual({ label: 'Algorithm', value: 'SHA256' })
  })
})

describe('totp.detect', () => {
  it('scores a well-formed otpauth URI highly', () => {
    expect(
      totp.detect?.('otpauth://totp/Example?secret=JBSWY3DPEHPK3PXP') ?? 0,
    ).toBeGreaterThanOrEqual(0.9)
  })

  it('scores a plausible bare base32 secret low', () => {
    expect(totp.detect?.('JBSWY3DPEHPK3PXP') ?? 0).toBeGreaterThan(0)
    expect(totp.detect?.('JBSWY3DPEHPK3PXP') ?? 1).toBeLessThan(0.5)
  })

  it('scores empty input and non-base32 text at zero', () => {
    expect(totp.detect?.('') ?? -1).toBe(0)
    expect(totp.detect?.('not base32 at all!') ?? -1).toBe(0)
  })
})
