/*
 * JWTs: what is in one, what is wrong with it, and whether it was actually
 * signed by the key you think signed it.
 *
 * The decode half is the easy half — split on the dots, base64url-decode,
 * JSON-parse — and it is not why the tool exists. What makes a token worth a
 * tool is everything the reader has to check *after* reading it, and which is
 * tedious enough by hand that it gets skipped: whether `exp` has passed,
 * whether `nbf` has not arrived yet, whether the token declares no expiry at
 * all, and whether `alg` says `none`. Those four are the warn rows, because
 * each of them is a token that will behave in a way the payload alone does not
 * suggest.
 *
 * `live: true` is here for one field. `Time to expiry` is computed from
 * `Date.now()` on every run, and the pane re-runs a live tool once a second,
 * so the countdown ticks without this module ever owning a timer — which also
 * means the whole tool stays a pure function of (input, options, clock) and is
 * testable by moving the clock.
 *
 * Verification goes through `crypto.subtle.verify`, never through a
 * reimplementation of HMAC or PKCS#1, and it is genuine verification: the
 * signature is checked against the exact `header.payload` bytes of the input,
 * so a token edited after signing fails here the way it would fail at a
 * gateway. Both key options are `secret: true` — a shared HMAC secret is the
 * one thing on this page that must never end up in a link somebody pastes into
 * chat, and the key field takes private-adjacent material often enough that it
 * gets the same treatment.
 *
 * Nothing throws. A half-pasted token is the normal way to arrive at this
 * tool, so a bad segment count, an undecodable header or a key that will not
 * import all come back as a result the pane can render.
 */

import type {
  Tool,
  ToolField,
  ToolOption,
  ToolOptions,
  ToolResult,
} from './types.ts'

const options: readonly ToolOption[] = [
  {
    key: 'secret',
    label: 'HMAC secret',
    kind: 'text',
    default: '',
    placeholder: 'HS256/384/512 — never written to the URL',
    secret: true,
  },
  {
    key: 'key',
    label: 'Public key (JWK or PEM)',
    kind: 'text',
    default: '',
    placeholder: 'RS*/ES* SPKI or JWK — never written to the URL',
    secret: true,
  },
]

const ascii = new TextEncoder()

/* Web Crypto takes a `BufferSource`, which excludes an array backed by a
 * `SharedArrayBuffer`; naming the backing buffer keeps that check at the
 * helpers rather than at every call site. */
type Bytes = Uint8Array<ArrayBuffer>

/** How each `alg` maps onto Web Crypto. The families differ in more than the
 * hash — an ECDSA key is imported by curve and verified by hash, an RSA key
 * the other way round — so the spec carries the whole shape rather than a
 * hash name the callers would have to reassemble. */
type AlgorithmSpec =
  | { family: 'HMAC'; hash: string }
  | { family: 'RSA'; hash: string }
  | { family: 'EC'; hash: string; namedCurve: string }

/** The algorithms this tool verifies. Deliberately the JOSE algorithms Web
 * Crypto covers directly: anything else (RSA-PSS, EdDSA, the encrypted `dir`
 * family) is reported as unsupported rather than half-checked. */
const ALGORITHMS: Record<string, AlgorithmSpec> = {
  HS256: { family: 'HMAC', hash: 'SHA-256' },
  HS384: { family: 'HMAC', hash: 'SHA-384' },
  HS512: { family: 'HMAC', hash: 'SHA-512' },
  RS256: { family: 'RSA', hash: 'SHA-256' },
  RS384: { family: 'RSA', hash: 'SHA-384' },
  RS512: { family: 'RSA', hash: 'SHA-512' },
  ES256: { family: 'EC', hash: 'SHA-256', namedCurve: 'P-256' },
  ES384: { family: 'EC', hash: 'SHA-384', namedCurve: 'P-384' },
}

/** The claims that are seconds since the epoch, and so are shown as an ISO
 * date beside the number nobody can read at a glance. */
const TIME_CLAIMS = new Set(['exp', 'nbf', 'iat', 'auth_time', 'updated_at'])

/** The registered claim names from RFC 7519 §4.1, spelled out. Three letters
 * of Latin is not a label; `sub (subject)` is. */
const CLAIM_NAMES: Record<string, string> = {
  iss: 'issuer',
  sub: 'subject',
  aud: 'audience',
  exp: 'expires',
  nbf: 'not before',
  iat: 'issued at',
  jti: 'JWT id',
}

/** base64url (RFC 4648 §5, unpadded as JOSE writes it) to bytes, or `null`
 * when the segment is not base64url at all. */
function decodeSegment(segment: string): Bytes | null {
  if (!/^[A-Za-z0-9_-]*$/.test(segment)) return null
  const standard = segment.replaceAll('-', '+').replaceAll('_', '/')
  const padded = standard.padEnd(
    standard.length + ((4 - (standard.length % 4)) % 4),
    '=',
  )
  try {
    return Uint8Array.from(atob(padded), (character) =>
      character.charCodeAt(0),
    )
  } catch {
    return null
  }
}

/** The bytes as UTF-8 text, or `null` when they are not valid UTF-8. JOSE
 * requires UTF-8, so anything else means the segment is not what it claims. */
function decodeText(bytes: Bytes): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

/** A segment as a JSON object, or `null` when it does not decode, is not JSON,
 * or is JSON that is not an object — `"[1,2]"` is valid JSON and an invalid
 * JOSE header. */
function decodeJson(segment: string): Record<string, unknown> | null {
  const bytes = decodeSegment(segment)
  if (bytes === null) return null
  const text = decodeText(bytes)
  if (text === null) return null
  try {
    const value: unknown = JSON.parse(text)
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/** A claim or header parameter as one line of table cell. Objects and arrays
 * are re-serialised compactly: the pretty-printed form is already in the
 * output pane above, and a row is one line. */
function renderValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'object' && value !== null) return JSON.stringify(value)
  return String(value)
}

/** A `NumericDate` (RFC 7519 §2 — seconds since the epoch) as the raw number
 * and the instant it names, or `null` when the value is not one. */
function asInstant(value: unknown): Date | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const date = new Date(value * 1000)
  return Number.isNaN(date.getTime()) ? null : date
}

/** `2d 03h 04m 05s`, down to the second because a countdown that only moved
 * once a minute would not look like one. Units above the largest non-zero one
 * are dropped; seconds are always shown. */
function formatDuration(totalSeconds: number): string {
  const seconds = Math.floor(Math.abs(totalSeconds))
  const parts = [
    { value: Math.floor(seconds / 86400), suffix: 'd' },
    { value: Math.floor(seconds / 3600) % 24, suffix: 'h' },
    { value: Math.floor(seconds / 60) % 60, suffix: 'm' },
    { value: seconds % 60, suffix: 's' },
  ]
  const first = parts.findIndex((part) => part.value !== 0)
  const shown = first === -1 ? parts.slice(3) : parts.slice(first)
  return shown
    .map((part, index) =>
      index === 0
        ? `${part.value}${part.suffix}`
        : `${String(part.value).padStart(2, '0')}${part.suffix}`,
    )
    .join(' ')
}

/** One row per header parameter, with `alg` flagged when it is `none` — an
 * unsigned token that a careless verifier will accept as a signed one. */
function headerFields(header: Record<string, unknown>): ToolField[] {
  const fields = Object.entries(header).map(([name, value]) => ({
    label: `Header ${name}`,
    value: renderValue(value),
    ...(name === 'alg' && value === 'none' ? { warn: true } : {}),
  }))
  if (!('alg' in header)) {
    fields.push({
      label: 'Header alg',
      value: 'missing — the header declares no algorithm',
      warn: true,
    })
  }
  return fields
}

/** One row per claim: the raw value, plus the instant for the time claims,
 * plus the two warn rows a time claim can earn. */
function claimFields(
  payload: Record<string, unknown>,
  now: number,
): ToolField[] {
  return Object.entries(payload).map(([name, value]) => {
    const registered = CLAIM_NAMES[name]
    const label = registered === undefined ? name : `${name} (${registered})`
    const instant = TIME_CLAIMS.has(name) ? asInstant(value) : null
    if (instant === null) return { label, value: renderValue(value) }

    const ms = instant.getTime()
    // An `exp` in the past and an `nbf` in the future are the two ways a token
    // that parses perfectly is nonetheless not usable right now.
    const warn =
      (name === 'exp' && ms <= now) || (name === 'nbf' && ms > now)
    return {
      label,
      value: `${renderValue(value)} — ${instant.toISOString()}`,
      ...(warn ? { warn: true } : {}),
    }
  })
}

/** The countdown, or the warn row for a token that never expires. Recomputed
 * from `now` on every run, which is the whole reason the tool is `live`. */
function expiryFields(
  payload: Record<string, unknown>,
  now: number,
): ToolField[] {
  const instant = asInstant(payload.exp)
  if (instant === null) {
    return [
      {
        label: 'exp (expires)',
        value:
          'exp' in payload
            ? `${renderValue(payload.exp)} — not a NumericDate, so no expiry can be read`
            : 'missing — this token does not expire',
        warn: true,
      },
    ]
  }
  const remaining = (instant.getTime() - now) / 1000
  return [
    {
      label: 'Time to expiry',
      value:
        remaining > 0
          ? `in ${formatDuration(remaining)}`
          : `expired ${formatDuration(remaining)} ago`,
      ...(remaining > 0 ? {} : { warn: true }),
    },
  ]
}

/** A PEM `-----BEGIN PUBLIC KEY-----` block's DER bytes. Only a public key:
 * a certificate or a private key in this field is a mistake worth naming
 * rather than an import error to pass through. */
function pemToDer(text: string): Bytes {
  const match = /-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/.exec(
    text,
  )
  if (match === null) throw new Error('the PEM block is not complete')
  if (match[1] !== 'PUBLIC KEY') {
    throw new Error(
      `expected a PUBLIC KEY block (SPKI), not a ${match[1].toLowerCase()} one`,
    )
  }
  // A PEM body is line-wrapped standard base64; `decodeSegment` speaks the
  // url-safe alphabet, so the two characters that differ are translated
  // rather than a second decoder being written for one caller.
  const der = decodeSegment(
    match[2]
      .replace(/[\s=]/g, '')
      .replaceAll('+', '-')
      .replaceAll('/', '_'),
  )
  if (der === null) throw new Error('the PEM body is not base64')
  return der
}

/** The key text as a JWK, or `null` when it is not JSON at all — which is how
 * the callers tell a JWK from a PEM without guessing at the format name. */
function asJwk(text: string): JsonWebKey | null {
  if (!text.startsWith('{')) return null
  try {
    return JSON.parse(text) as JsonWebKey
  } catch {
    throw new Error('the key looks like JSON but does not parse')
  }
}

/** The verification key for one algorithm from whichever field carries it.
 * Throws with a readable reason; every caller turns that into a row. */
async function importVerifyKey(
  spec: AlgorithmSpec,
  secret: string,
  keyText: string,
): Promise<CryptoKey> {
  if (spec.family === 'HMAC') {
    const parameters = { name: 'HMAC', hash: spec.hash }
    // The secret field wins when it has something in it. The key field still
    // works for HMAC because published test vectors — RFC 7515's own — give
    // the shared key as an `oct` JWK whose bytes are not typable text.
    if (secret !== '') {
      return crypto.subtle.importKey(
        'raw',
        ascii.encode(secret),
        parameters,
        false,
        ['verify'],
      )
    }
    const jwk = asJwk(keyText)
    if (jwk === null) {
      throw new Error(
        'put the shared secret in the secret field, or an oct JWK in the key field',
      )
    }
    return crypto.subtle.importKey('jwk', jwk, parameters, false, ['verify'])
  }

  if (keyText === '') {
    throw new Error('this algorithm needs a public key in the key field')
  }
  const parameters =
    spec.family === 'RSA'
      ? { name: 'RSASSA-PKCS1-v1_5', hash: spec.hash }
      : { name: 'ECDSA', namedCurve: spec.namedCurve }

  const jwk = asJwk(keyText)
  return jwk === null
    ? crypto.subtle.importKey('spki', pemToDer(keyText), parameters, false, [
        'verify',
      ])
    : crypto.subtle.importKey('jwk', jwk, parameters, false, ['verify'])
}

/** The verify parameters, which differ from the import parameters for EC:
 * the curve is a property of the key, the hash a property of the signature. */
function verifyParameters(
  spec: AlgorithmSpec,
): AlgorithmIdentifier | EcdsaParams {
  if (spec.family === 'HMAC') return 'HMAC'
  if (spec.family === 'RSA') return 'RSASSA-PKCS1-v1_5'
  return { name: 'ECDSA', hash: spec.hash }
}

/** The `Signature` row. Every outcome is a row, including every failure: an
 * unsupported algorithm, a key that will not import and a signature segment
 * that is not base64url are all things a reader arrives here holding. */
async function signatureField(
  header: Record<string, unknown>,
  signingInput: string,
  signature: string,
  toolOptions: ToolOptions,
): Promise<ToolField> {
  const label = 'Signature'
  const secret = toolOptions.secret ?? ''
  const keyText = (toolOptions.key ?? '').trim()
  if (secret === '' && keyText === '') return { label, value: 'not checked' }

  const alg = header.alg
  const spec = typeof alg === 'string' ? ALGORITHMS[alg] : undefined
  if (spec === undefined) {
    return {
      label,
      value:
        typeof alg === 'string'
          ? `cannot verify — unsupported algorithm ${alg}`
          : 'cannot verify — the header declares no algorithm',
      warn: true,
    }
  }

  const signatureBytes = decodeSegment(signature)
  if (signatureBytes === null) {
    return { label, value: 'invalid — not a base64url signature', warn: true }
  }

  let key: CryptoKey
  try {
    key = await importVerifyKey(spec, secret, keyText)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return { label, value: `not checked — ${reason}`, warn: true }
  }

  const ok = await crypto.subtle.verify(
    verifyParameters(spec),
    key,
    signatureBytes,
    ascii.encode(signingInput),
  )
  return ok ? { label, value: 'valid' } : { label, value: 'invalid', warn: true }
}

/** The `<pre>` view: both JSON objects, pretty-printed and labelled, in the
 * order they appear in the token. */
function asText(
  header: Record<string, unknown>,
  payload: Record<string, unknown> | string,
): string {
  const body =
    typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2)
  return `header\n${JSON.stringify(header, null, 2)}\n\npayload\n${body}`
}

async function run(
  input: string,
  toolOptions: ToolOptions,
): Promise<ToolResult> {
  const token = input.trim()
  if (token === '') return { ok: true, output: '' }

  const segments = token.split('.')
  if (segments.length !== 3) {
    return {
      ok: false,
      output: '',
      error:
        segments.length === 5
          ? 'this is a JWE (five segments) — an encrypted token cannot be' +
            ' decoded without its key'
          : `a JWT has three dot-separated segments — this has ${segments.length}`,
    }
  }

  const [headerSegment, payloadSegment, signature] = segments
  const header = decodeJson(headerSegment)
  if (header === null) {
    return {
      ok: false,
      output: '',
      error: 'the header segment is not base64url-encoded JSON',
    }
  }

  const payload = decodeJson(payloadSegment)
  // A payload that is not JSON is unusual but legal — a nested JWT, or a
  // non-JSON content type — so it is shown as text with a row saying so,
  // rather than failing a token whose header decoded perfectly well.
  const payloadBytes = payload === null ? decodeSegment(payloadSegment) : null
  const payloadText =
    payloadBytes === null ? null : (decodeText(payloadBytes) ?? '')

  const now = Date.now()
  const fields: ToolField[] = [
    ...headerFields(header),
    ...(payload === null
      ? [
          {
            label: 'Payload',
            value: 'not JSON — shown above as text',
            warn: true,
          },
        ]
      : [...claimFields(payload, now), ...expiryFields(payload, now)]),
    await signatureField(
      header,
      `${headerSegment}.${payloadSegment}`,
      signature,
      toolOptions,
    ),
  ]

  return {
    ok: true,
    output: asText(header, payload ?? (payloadText ?? '(not decodable)')),
    fields,
  }
}

/** Three base64url segments whose header decodes to JOSE-shaped JSON. Scored
 * far above base64's 0.7 ceiling: a token is also a run of base64 strings, and
 * routing it to the base64 tool would be the wrong answer every time. */
function detect(input: string): number {
  const token = input.trim()
  const segments = token.split('.')
  if (segments.length !== 3) return 0
  // The signature may be empty — that is exactly what `alg: none` produces —
  // but the header and payload never are.
  if (segments[0] === '' || segments[1] === '') return 0
  if (!segments.every((segment) => /^[A-Za-z0-9_-]*$/.test(segment))) return 0

  const header = decodeJson(segments[0])
  if (header === null) return 0
  return 'alg' in header || 'typ' in header ? 0.95 : 0
}

export const jwt = {
  id: 'jwt',
  name: 'jwt',
  options,
  detect,
  run,
  // The countdown to `exp` is recomputed from `Date.now()` on every run; this
  // is what makes the pane ask for one a second.
  live: true,
} satisfies Tool
