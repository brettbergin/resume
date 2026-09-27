import { describe, expect, it } from 'vitest'

import { DETECTION_THRESHOLD } from './magic.ts'
import {
  deriveChallenge,
  generateNonce,
  generateState,
  generateVerifier,
  pkce,
} from './pkce.ts'
import { findTool } from './registry.ts'
import type { ToolField, ToolOption, ToolResult } from './types.ts'

const run = (input: string, options: Record<string, string> = {}) =>
  pkce.run(input, options)

function rowsOf(result: ToolResult): Record<string, string> {
  return Object.fromEntries(
    (result.fields ?? []).map((field: ToolField) => [field.label, field.value]),
  )
}

const UNRESERVED = /^[A-Za-z0-9\-._~]+$/

/** The tool's options are declared `as const`, so each entry narrows to its
 * own literal shape and only the ones that set `secret` carry the key. The
 * widening to `ToolOption` is what lets these assertions ask any option about
 * a flag it may or may not declare. */
const optionNamed = (key: string): ToolOption | undefined =>
  (pkce.options as readonly ToolOption[] | undefined)?.find(
    (option) => option.key === key,
  )

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

  it('declares the verifier as a secret so it never reaches the URL fragment', () => {
    // A `code_verifier` is the one half of the pair that never leaves the
    // client except in the token exchange, so it must not ride along in a
    // shared or screenshotted address bar.
    expect(optionNamed('verifier')).toMatchObject({
      kind: 'text',
      default: '',
      secret: true,
    })
  })

  it('leaves the public options shareable', () => {
    // The challenge is sent in the clear in the authorization request and the
    // mode is a plain UI setting; marking either secret would break the share
    // link for values that were never private.
    for (const key of ['challenge', 'mode']) {
      expect(optionNamed(key)?.secret).toBeUndefined()
    }
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

  it('claims exactly RFC 7636 length band and nothing either side of it', () => {
    expect(pkce.detect?.('a'.repeat(42))).toBe(0)
    expect(pkce.detect?.('a'.repeat(43))).toBeGreaterThan(0)
    expect(pkce.detect?.('a'.repeat(128))).toBeGreaterThan(0)
    expect(pkce.detect?.('a'.repeat(129))).toBe(0)
  })

  it('scores empty and whitespace-only input at zero', () => {
    expect(pkce.detect?.('')).toBe(0)
    expect(pkce.detect?.('   \n  ')).toBe(0)
  })

  it('scores input with whitespace inside it at zero', () => {
    // Trimming the ends is a courtesy to a paste; a space in the middle means
    // this is prose or two values, not one `code_verifier`.
    expect(pkce.detect?.(`${'a'.repeat(30)} ${'b'.repeat(30)}`)).toBe(0)
  })

  it('leaves other tools their own formats', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVP'
    expect(pkce.detect?.(jwt)).toBe(0)
    expect(pkce.detect?.('-----BEGIN CERTIFICATE-----')).toBe(0)
    expect(pkce.detect?.('%E2%9C%93%20checked%20and%20percent-encoded%20text')).toBe(0)
    expect(pkce.detect?.('10.0.0.0/8')).toBe(0)
    expect(pkce.detect?.('1700000000')).toBe(0)
  })

  it('never scores high enough for magic paste to run it', () => {
    // Generate mode ignores its input, so a magic dispatch to this tool would
    // answer a paste with four freshly minted values that have nothing to do
    // with it. Sitting at the threshold rather than above it is what keeps the
    // detector to a named guess — `magic.ts` compares strictly.
    for (const sample of [
      RFC_7636_VERIFIER,
      generateVerifier(),
      generateVerifier(43),
      generateVerifier(128),
    ]) {
      expect(pkce.detect?.(sample)).toBeLessThanOrEqual(DETECTION_THRESHOLD)
    }
  })

  it('is never what magic paste dispatches a pasted verifier to', async () => {
    const magic = findTool('magic')
    const result = await magic?.run(RFC_7636_VERIFIER, {})
    expect(result?.detected?.toolId).not.toBe('pkce')
  })
})
