import { describe, expect, it } from 'vitest'

import {
  deriveChallenge,
  generateNonce,
  generateState,
  generateVerifier,
  pkce,
} from './pkce.ts'
import type { ToolField, ToolResult } from './types.ts'

const run = (input: string, options: Record<string, string> = {}) =>
  pkce.run(input, options)

function rowsOf(result: ToolResult): Record<string, string> {
  return Object.fromEntries(
    (result.fields ?? []).map((field: ToolField) => [field.label, field.value]),
  )
}

const UNRESERVED = /^[A-Za-z0-9\-._~]+$/

/** RFC 7636 appendix B: the one published verifier/challenge pair, so the
 * derivation is pinned to the spec rather than to whatever this module
 * happens to emit. */
const RFC_7636_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
const RFC_7636_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'

describe('generateVerifier', () => {
  it('defaults to a 96-character verifier', () => {
    expect(generateVerifier()).toHaveLength(96)
  })

  it.each([43, 64, 128])('produces exactly %i characters', (length) => {
    expect(generateVerifier(length)).toHaveLength(length)
  })

  it.each([undefined, 43, 128])(
    'draws only from the unreserved character set (length %s)',
    (length) => {
      for (let sample = 0; sample < 20; sample += 1) {
        expect(generateVerifier(length)).toMatch(UNRESERVED)
      }
    },
  )

  it('gives a different verifier every call', () => {
    const values = new Set(Array.from({ length: 20 }, () => generateVerifier()))
    expect(values.size).toBe(20)
  })

  it('rejects a length below the RFC 7636 floor', () => {
    expect(() => generateVerifier(42)).toThrow(RangeError)
  })

  it('rejects a length above the RFC 7636 ceiling', () => {
    expect(() => generateVerifier(129)).toThrow(RangeError)
  })

  it('accepts the boundary lengths', () => {
    expect(generateVerifier(43)).toHaveLength(43)
    expect(generateVerifier(128)).toHaveLength(128)
  })
})

describe('deriveChallenge', () => {
  it('reproduces the RFC 7636 appendix B test vector', async () => {
    expect(await deriveChallenge(RFC_7636_VERIFIER)).toBe(RFC_7636_CHALLENGE)
  })

  it('never emits +, / or = — the base64url alphabet only', async () => {
    const challenge = await deriveChallenge(generateVerifier())
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('is deterministic for the same verifier', async () => {
    const verifier = generateVerifier()
    expect(await deriveChallenge(verifier)).toBe(await deriveChallenge(verifier))
  })
})

describe('generateState and generateNonce', () => {
  it('default to a 43-character base64url token (32 bytes)', () => {
    expect(generateState()).toHaveLength(43)
    expect(generateNonce()).toHaveLength(43)
  })

  it.each([16, 32, 64])('scales length with byteLength %i', (byteLength) => {
    const expected = Math.ceil((byteLength * 4) / 3)
    expect(generateState(byteLength)).toHaveLength(expected)
    expect(generateNonce(byteLength)).toHaveLength(expected)
  })

  it('never pads or uses the standard base64 alphabet', () => {
    expect(generateState()).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(generateNonce()).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('gives a different value every call', () => {
    const states = new Set(Array.from({ length: 20 }, () => generateState()))
    const nonces = new Set(Array.from({ length: 20 }, () => generateNonce()))
    expect(states.size).toBe(20)
    expect(nonces.size).toBe(20)
  })
})

describe('pkce tool metadata', () => {
  it('identifies itself as the pkce generator', () => {
    expect(pkce.id).toBe('pkce')
    expect(pkce.generates).toBe(true)
  })
})

describe('generate mode', () => {
  it('returns a verifier, challenge, state and nonce, each copyable', async () => {
    const result = await run('', { mode: 'generate' })
    expect(result.ok).toBe(true)

    const rows = rowsOf(result)
    expect(rows['code_verifier']).toMatch(UNRESERVED)
    expect(rows['code_challenge (S256)']).toBe(
      await deriveChallenge(rows['code_verifier']),
    )
    expect(rows['state']).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(rows['nonce']).toMatch(/^[A-Za-z0-9_-]+$/)

    for (const field of result.fields ?? []) {
      expect(field.copy, `${field.label} should be copyable`).toBe(true)
    }
  })

  it('is the default mode when none is given', async () => {
    const result = await run('', {})
    expect(result.ok).toBe(true)
    expect(rowsOf(result)['code_verifier']).toMatch(UNRESERVED)
  })
})

describe('verify mode', () => {
  it('matches the RFC 7636 verifier/challenge pair', async () => {
    const result = await run('', {
      mode: 'verify',
      verifier: RFC_7636_VERIFIER,
      challenge: RFC_7636_CHALLENGE,
    })

    expect(result.ok).toBe(true)
    expect(result.output).toContain('matches')
    const rows = rowsOf(result)
    expect(rows['match']).toContain('valid')
  })

  it('flags a mismatched pair with a warning row', async () => {
    const result = await run('', {
      mode: 'verify',
      verifier: RFC_7636_VERIFIER,
      challenge: 'not-the-right-challenge',
    })

    expect(result.ok).toBe(false)
    expect(result.output).toContain('does not match')

    const warnField = (result.fields ?? []).find((field) => field.label === 'match')
    expect(warnField?.warn).toBe(true)
    expect(warnField?.value).toContain('mismatch')
  })

  it('errors when the verifier is missing', async () => {
    const result = await run('', { mode: 'verify', challenge: RFC_7636_CHALLENGE })
    expect(result.ok).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('errors when the challenge is missing', async () => {
    const result = await run('', { mode: 'verify', verifier: RFC_7636_VERIFIER })
    expect(result.ok).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('errors when both verifier and challenge are empty', async () => {
    const result = await run('', { mode: 'verify', verifier: '', challenge: '' })
    expect(result.ok).toBe(false)
    expect(result.error).toBeTruthy()
  })
})

describe('detect', () => {
  it('scores a plausible verifier-shaped string above zero', () => {
    expect(pkce.detect?.(RFC_7636_VERIFIER)).toBeGreaterThan(0)
  })

  it('scores too-short input at zero', () => {
    expect(pkce.detect?.('short')).toBe(0)
  })

  it('scores input with characters outside the unreserved set at zero', () => {
    expect(pkce.detect?.('a'.repeat(50) + '!!!')).toBe(0)
  })

  it('scores input longer than 128 characters at zero', () => {
    expect(pkce.detect?.('a'.repeat(129))).toBe(0)
  })
})
