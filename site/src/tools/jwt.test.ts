import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { jwt } from './jwt.ts'
import type { ToolField, ToolResult } from './types.ts'

/*
 * Two things are being pinned here, and they need different kinds of vector.
 *
 * The decode half is checked against RFC 7515's own Appendix A.1 example —
 * its token *and* its published key — so the tool is anchored to the standard
 * rather than to whatever it emitted the first time it ran. A JWT tool whose
 * expectations were recorded from its own output would prove nothing: the
 * entire use of it is agreeing with the gateway on the other side.
 *
 * The signature half cannot be pinned that way for RSA and EC, because there
 * is no published key pair worth hard-coding into a repository. Those tokens
 * are signed inside the test with a freshly generated pair, which checks the
 * property that actually matters — that verification agrees with a real
 * signer, and disagrees the moment the input or the key changes.
 *
 * The clock is moved rather than mocked away: `Date.now()` is the only input
 * the countdown and the `exp`/`nbf` warnings have, so the tests set it.
 */

const utf8 = new TextEncoder()

const options = (extra: Record<string, string> = {}) => ({
  secret: '',
  key: '',
  ...extra,
})

const run = (input: string, extra: Record<string, string> = {}) =>
  jwt.run(input, options(extra))

/** Bytes to the unpadded base64url every JOSE segment is written in. */
const b64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')

const encodeJson = (value: unknown): string =>
  b64url(utf8.encode(JSON.stringify(value)))

/** A token nobody signed — enough for every claim and header assertion, which
 * never look at the third segment. */
const unsigned = (
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
): string => `${encodeJson(header)}.${encodeJson(payload)}.c2ln`

/** A real HS256 token over a text secret, signed by Web Crypto rather than by
 * the code under test. */
async function signHmac(
  payload: Record<string, unknown>,
  secret: string,
): Promise<string> {
  const signingInput = `${encodeJson({ alg: 'HS256', typ: 'JWT' })}.${encodeJson(payload)}`
  const key = await crypto.subtle.importKey(
    'raw',
    utf8.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    utf8.encode(signingInput),
  )
  return `${signingInput}.${b64url(new Uint8Array(signature))}`
}

/** A real asymmetric token, plus its public key in both of the forms the key
 * field accepts: the JWK an OIDC discovery document hands out, and the PEM
 * SPKI `openssl` prints. */
async function signAsymmetric(
  alg: 'RS256' | 'ES256',
  payload: Record<string, unknown>,
): Promise<{ token: string; jwk: string; pem: string }> {
  const parameters: RsaHashedKeyGenParams | EcKeyGenParams =
    alg === 'RS256'
      ? {
          name: 'RSASSA-PKCS1-v1_5',
          modulusLength: 2048,
          publicExponent: new Uint8Array([1, 0, 1]),
          hash: 'SHA-256',
        }
      : { name: 'ECDSA', namedCurve: 'P-256' }

  const pair = await crypto.subtle.generateKey(parameters, true, [
    'sign',
    'verify',
  ])
  const signingInput = `${encodeJson({ alg, typ: 'JWT' })}.${encodeJson(payload)}`
  const signature = await crypto.subtle.sign(
    alg === 'RS256'
      ? 'RSASSA-PKCS1-v1_5'
      : { name: 'ECDSA', hash: 'SHA-256' },
    pair.privateKey,
    utf8.encode(signingInput),
  )

  const der = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey))
  const body = btoa(String.fromCharCode(...der)).replace(/(.{64})/g, '$1\n')
  return {
    token: `${signingInput}.${b64url(new Uint8Array(signature))}`,
    jwk: JSON.stringify(await crypto.subtle.exportKey('jwk', pair.publicKey)),
    pem: `-----BEGIN PUBLIC KEY-----\n${body}\n-----END PUBLIC KEY-----\n`,
  }
}

/** The row for a claim or a named field. Claims carry their spelled-out name
 * in the label (`exp (expires)`), so a lookup matches either form. */
function row(result: ToolResult, name: string): ToolField | undefined {
  return (result.fields ?? []).find(
    (field) => field.label === name || field.label.startsWith(`${name} (`),
  )
}

const valueOf = (result: ToolResult, name: string): string | undefined =>
  row(result, name)?.value

/* RFC 7515, Appendix A.1: the HS256 example token and the `oct` JWK it was
 * signed with. Reproduced exactly, carriage returns in the header and all. */
const RFC_7515_A1 = {
  token:
    'eyJ0eXAiOiJKV1QiLA0KICJhbGciOiJIUzI1NiJ9' +
    '.eyJpc3MiOiJqb2UiLA0KICJleHAiOjEzMDA4MTkzODAsDQogImh0dHA6Ly9leGFtcGxlLmNvbS9pc19yb290Ijp0cnVlfQ' +
    '.dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
  jwk: JSON.stringify({
    kty: 'oct',
    k: 'AyM1SysPpbyDfgZld3umj1qzKObwVMkoqQ-EstJQLr_T-1qS0gZH75aKtMN3Yj0iPS4hcgUuTwjAzZr1Z9CAow',
  }),
}

/** A fixed instant to hang the time claims off: 2024-01-01T00:00:00Z. */
const NOW = Date.UTC(2024, 0, 1)
const SECONDS = Math.floor(NOW / 1000)

describe('the jwt tool', () => {
  it('is registered as a live tool so the pane ticks its countdown', () => {
    expect(jwt.id).toBe('jwt')
    expect(jwt.live).toBe(true)
  })

  it('keeps both key fields out of the fragment', () => {
    // The pane drops `secret` options when it builds a share link, so this
    // flag is the only thing standing between an HMAC secret and a URL.
    for (const option of jwt.options) expect(option.secret).toBe(true)
    expect(jwt.options.map((option) => option.key)).toEqual(['secret', 'key'])
  })

  it('shows nothing for an untouched pane', async () => {
    expect(await run('')).toEqual({ ok: true, output: '' })
    expect(await run('   ')).toEqual({ ok: true, output: '' })
  })
})

describe('decoding', () => {
  it('pretty-prints the header and payload of the RFC 7515 example', async () => {
    const result = await run(RFC_7515_A1.token)

    expect(result.ok).toBe(true)
    expect(result.output).toContain('"typ": "JWT"')
    expect(result.output).toContain('"alg": "HS256"')
    expect(result.output).toContain('"iss": "joe"')
    expect(result.output).toContain('"exp": 1300819380')
  })

  it('rows every header parameter and every claim', async () => {
    const result = await run(RFC_7515_A1.token)

    expect(valueOf(result, 'Header alg')).toBe('HS256')
    expect(valueOf(result, 'Header typ')).toBe('JWT')
    expect(valueOf(result, 'iss')).toBe('joe')
    expect(valueOf(result, 'http://example.com/is_root')).toBe('true')
  })

  it('shows a time claim as both the raw number and an ISO 8601 UTC string', async () => {
    const result = await run(RFC_7515_A1.token)

    expect(valueOf(result, 'exp')).toBe('1300819380 — 2011-03-22T18:43:00.000Z')
  })

  it('renders object and array claims on one line', async () => {
    const result = await run(
      unsigned({ alg: 'HS256' }, { aud: ['a', 'b'], ctx: { tier: 1 } }),
    )

    expect(valueOf(result, 'aud')).toBe('["a","b"]')
    expect(valueOf(result, 'ctx')).toBe('{"tier":1}')
  })

  it('keeps a non-JSON payload readable instead of failing the token', async () => {
    const token = `${encodeJson({ alg: 'HS256', cty: 'text/plain' })}.${b64url(utf8.encode('plain text'))}.c2ln`
    const result = await run(token)

    expect(result.ok).toBe(true)
    expect(result.output).toContain('plain text')
    expect(row(result, 'Payload')?.warn).toBe(true)
  })
})

describe('claim warnings', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('warns on alg: none', async () => {
    const result = await run(
      unsigned({ alg: 'none', typ: 'JWT' }, { exp: SECONDS + 60 }),
    )

    expect(row(result, 'Header alg')?.warn).toBe(true)
    expect(valueOf(result, 'Header alg')).toBe('none')
  })

  it('warns on a header with no alg at all', async () => {
    const result = await run(unsigned({ typ: 'JWT' }, { exp: SECONDS + 60 }))

    expect(row(result, 'Header alg')?.warn).toBe(true)
    expect(valueOf(result, 'Header alg')).toContain('missing')
  })

  it('warns on an exp that has already passed', async () => {
    const result = await run(unsigned({ alg: 'HS256' }, { exp: SECONDS - 1 }))

    expect(row(result, 'exp')?.warn).toBe(true)
    expect(valueOf(result, 'Time to expiry')).toBe('expired 1s ago')
    expect(row(result, 'Time to expiry')?.warn).toBe(true)
  })

  it('warns on an nbf that has not arrived', async () => {
    const result = await run(
      unsigned({ alg: 'HS256' }, { nbf: SECONDS + 3600, exp: SECONDS + 7200 }),
    )

    expect(row(result, 'nbf')?.warn).toBe(true)
    // A valid, future-dated token is not otherwise flagged.
    expect(row(result, 'exp')?.warn).toBeUndefined()
  })

  it('warns on a token with no exp', async () => {
    const result = await run(unsigned({ alg: 'HS256' }, { sub: 'nobody' }))

    expect(row(result, 'exp')?.warn).toBe(true)
    expect(valueOf(result, 'exp')).toContain('does not expire')
    expect(row(result, 'Time to expiry')).toBeUndefined()
  })

  it('leaves a healthy token unflagged', async () => {
    const result = await run(
      unsigned({ alg: 'HS256', typ: 'JWT' }, { iat: SECONDS, exp: SECONDS + 60 }),
    )

    expect((result.fields ?? []).filter((field) => field.warn === true)).toEqual(
      [],
    )
  })
})

describe('the countdown to exp', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('is recomputed from the clock on every run', async () => {
    const token = unsigned({ alg: 'HS256' }, { exp: SECONDS + 3600 })

    expect(valueOf(await run(token), 'Time to expiry')).toBe('in 1h 00m 00s')

    vi.advanceTimersByTime(1000)
    expect(valueOf(await run(token), 'Time to expiry')).toBe('in 59m 59s')

    vi.advanceTimersByTime(3599 * 1000)
    expect(valueOf(await run(token), 'Time to expiry')).toBe('expired 0s ago')
  })
})

describe('signature verification', () => {
  it('reads "not checked" when no key material is given', async () => {
    const result = await run(RFC_7515_A1.token)

    expect(valueOf(result, 'Signature')).toBe('not checked')
    expect(row(result, 'Signature')?.warn).toBeUndefined()
  })

  it('verifies the RFC 7515 A.1 example with its published key', async () => {
    const result = await run(RFC_7515_A1.token, { key: RFC_7515_A1.jwk })

    expect(valueOf(result, 'Signature')).toBe('valid')
  })

  it('verifies an HS256 token against the secret it was signed with', async () => {
    const token = await signHmac({ sub: 'alice' }, 'correct horse battery')
    const result = await run(token, { secret: 'correct horse battery' })

    expect(valueOf(result, 'Signature')).toBe('valid')
    expect(row(result, 'Signature')?.warn).toBeUndefined()
  })

  it('rejects it after one character of the secret changes', async () => {
    const token = await signHmac({ sub: 'alice' }, 'correct horse battery')
    const result = await run(token, { secret: 'correct horse batterx' })

    expect(valueOf(result, 'Signature')).toBe('invalid')
    expect(row(result, 'Signature')?.warn).toBe(true)
  })

  it('rejects a payload edited after signing', async () => {
    const token = await signHmac({ sub: 'alice' }, 'shared')
    const [header, , signature] = token.split('.')
    const forged = `${header}.${encodeJson({ sub: 'root' })}.${signature}`

    expect(valueOf(await run(forged, { secret: 'shared' }), 'Signature')).toBe(
      'invalid',
    )
  })

  it.each(['ES256', 'RS256'] as const)(
    'verifies a %s token from a JWK and from a PEM SPKI',
    async (alg) => {
      const { token, jwk, pem } = await signAsymmetric(alg, { sub: 'service' })

      expect(valueOf(await run(token, { key: jwk }), 'Signature')).toBe('valid')
      expect(valueOf(await run(token, { key: pem }), 'Signature')).toBe('valid')
    },
  )

  it('rejects a token signed by a different key pair', async () => {
    const { token } = await signAsymmetric('ES256', { sub: 'service' })
    const other = await signAsymmetric('ES256', { sub: 'service' })

    expect(valueOf(await run(token, { key: other.jwk }), 'Signature')).toBe(
      'invalid',
    )
  })

  it('says so for an algorithm it cannot verify, rather than throwing', async () => {
    const token = unsigned({ alg: 'PS256' }, { sub: 'x' })
    const result = await run(token, { secret: 'anything' })

    expect(valueOf(result, 'Signature')).toContain('unsupported algorithm PS256')
    expect(row(result, 'Signature')?.warn).toBe(true)
  })

  it('says so for alg: none, which no key can verify', async () => {
    const result = await run(unsigned({ alg: 'none' }, { sub: 'x' }), {
      secret: 'anything',
    })

    expect(valueOf(result, 'Signature')).toContain('unsupported algorithm none')
  })

  it('explains a key it cannot read instead of failing the decode', async () => {
    const { token } = await signAsymmetric('ES256', { sub: 'service' })

    const badPem = await run(token, { key: '-----BEGIN PUBLIC KEY-----\nnope' })
    expect(valueOf(badPem, 'Signature')).toContain('not checked')
    expect(badPem.ok).toBe(true)

    const badJwk = await run(token, { key: '{"kty":' })
    expect(valueOf(badJwk, 'Signature')).toContain('does not parse')

    const noKey = await run(token, { secret: 'a text secret' })
    expect(valueOf(noKey, 'Signature')).toContain('public key')
  })

  it('names a PEM that is not a public key', async () => {
    const { token } = await signAsymmetric('ES256', { sub: 'service' })
    const certish =
      '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----'
    const result = await run(token, { key: certish })

    expect(valueOf(result, 'Signature')).toContain('PUBLIC KEY')
  })
})

describe('malformed input', () => {
  it.each([
    ['one segment', 'notatoken'],
    ['two segments', 'eyJhbGciOiJIUzI1NiJ9.eyJhIjoxfQ'],
    ['four segments', 'a.b.c.d'],
  ])('reports %s without throwing', async (_name, token) => {
    const result = await run(token)

    expect(result.ok).toBe(false)
    expect(result.error).toContain('three dot-separated segments')
  })

  it('recognises a JWE by its five segments', async () => {
    const result = await run('a.b.c.d.e')

    expect(result.ok).toBe(false)
    expect(result.error).toContain('JWE')
  })

  it.each([
    ['a header that is not base64url', '!!!!.eyJhIjoxfQ.sig'],
    ['a header that is not JSON', `${b64url(utf8.encode('hello'))}.eyJhIjoxfQ.c2ln`],
    ['a header that is JSON but not an object', `${encodeJson([1, 2])}.eyJhIjoxfQ.c2ln`],
  ])('reports %s', async (_name, token) => {
    const result = await run(token)

    expect(result.ok).toBe(false)
    expect(result.error).toContain('header')
  })

  it('survives a signature segment that is not base64url', async () => {
    const token = `${encodeJson({ alg: 'HS256' })}.${encodeJson({ sub: 'a' })}.!!!`
    const result = await run(token, { secret: 'k' })

    expect(result.ok).toBe(true)
    expect(valueOf(result, 'Signature')).toContain('not a base64url signature')
  })
})

describe('detect', () => {
  it('claims a token far above what base64 can score', async () => {
    const token = await signHmac({ sub: 'alice' }, 'k')

    expect(jwt.detect(token)).toBeGreaterThan(0.9)
    expect(jwt.detect(`  ${token}  `)).toBeGreaterThan(0.9)
    // `alg: none` leaves the signature segment empty, and it is still a token.
    expect(
      jwt.detect(`${encodeJson({ alg: 'none' })}.${encodeJson({ a: 1 })}.`),
    ).toBeGreaterThan(0.9)
  })

  it('claims nothing else', () => {
    expect(jwt.detect('')).toBe(0)
    expect(jwt.detect('aGVsbG8gd29ybGQ=')).toBe(0)
    expect(jwt.detect('a.b.c')).toBe(0)
    expect(jwt.detect('192.168.0.1')).toBe(0)
    expect(jwt.detect('1700000000')).toBe(0)
    // Three decodable segments, but the first is JSON with no JOSE parameter.
    expect(
      jwt.detect(`${encodeJson({ hello: 'world' })}.${encodeJson({ a: 1 })}.c2ln`),
    ).toBe(0)
  })
})
