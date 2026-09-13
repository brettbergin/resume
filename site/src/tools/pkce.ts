/*
 * PKCE (RFC 7636) verifier/challenge pairs, plus the `state` and `nonce`
 * values an OAuth/OIDC redirect carries alongside them. All three exist to
 * be unguessable, so all three are drawn from `crypto.getRandomValues` and
 * nothing else — no `Math.random`, no third-party crypto.
 *
 * Generate mode produces a fresh verifier, its S256 challenge, a state and a
 * nonce in one run. Verify mode takes a pasted verifier and challenge — the
 * two halves of a PKCE exchange a reader is checking, not producing — and
 * reports whether the challenge is what the verifier derives.
 */

import type { Tool, ToolOption, ToolOptions, ToolResult } from './types.ts'

/** RFC 3986's unreserved characters: the widest alphabet RFC 7636 allows a
 * `code_verifier` to use, so the generator can draw the longest verifier the
 * spec permits without ever producing a character it would have to escape. */
const UNRESERVED =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'

const MIN_VERIFIER_LENGTH = 43
const MAX_VERIFIER_LENGTH = 128

/**
 * A `code_verifier` of `length` characters (default 96, the midpoint of
 * RFC 7636's 43-to-128 range) drawn from the unreserved set.
 *
 * Rejection sampling rather than `byte % 66`: the unreserved alphabet has 66
 * characters, and 256 is not a multiple of 66, so a plain modulo would hand
 * every residue three draws out of the low 198 values plus a fourth from the
 * 58 left over — a small but real bias in a value whose whole job is to be
 * unpredictable. Bytes at or above 198 (the largest multiple of 66 under
 * 256) are discarded and redrawn instead, so every character keeps the same
 * 3-in-256 odds.
 *
 * `length` outside [43, 128] is a caller asking for something RFC 7636 does
 * not allow as a verifier, so it throws rather than silently clamping to a
 * value the caller did not ask for.
 */
export function generateVerifier(length = 96): string {
  if (!Number.isInteger(length) || length < MIN_VERIFIER_LENGTH || length > MAX_VERIFIER_LENGTH) {
    throw new RangeError(
      `code_verifier length must be an integer between ${MIN_VERIFIER_LENGTH} and ${MAX_VERIFIER_LENGTH}, not ${length}`,
    )
  }

  const alphabetSize = UNRESERVED.length
  const limit = alphabetSize * Math.floor(256 / alphabetSize)
  const characters: string[] = []

  while (characters.length < length) {
    const draws = crypto.getRandomValues(
      new Uint8Array(length - characters.length),
    )
    for (const draw of draws) {
      if (draw >= limit) continue
      characters.push(UNRESERVED[draw % alphabetSize])
      if (characters.length === length) break
    }
  }

  return characters.join('')
}

/** Bytes to base64url (RFC 4648 §5): the standard alphabet with `+`/`/`
 * remapped to `-`/`_` and the `=` padding stripped, since neither a PKCE
 * challenge nor an OAuth `state`/`nonce` is ever padded. */
function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

/**
 * The S256 `code_challenge` for a `code_verifier`: SHA-256 of its UTF-8
 * bytes, base64url-encoded. Computed with `crypto.subtle` alone, so the
 * derivation is exactly what RFC 7636 §4.2 specifies and nothing a
 * third-party library might do differently.
 */
export async function deriveChallenge(verifier: string): Promise<string> {
  const bytes = new TextEncoder().encode(verifier)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return toBase64Url(new Uint8Array(digest))
}

/** `byteLength` random bytes, base64url-encoded. `state` and `nonce` share
 * this implementation: both are opaque, server-echoed, cryptographically
 * random strings with no format requirement beyond that. */
function randomToken(byteLength: number): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(byteLength)))
}

/** An OAuth `state` value: `byteLength` random bytes (default 32, giving 256
 * bits), base64url-encoded. Guards the authorization redirect against CSRF —
 * the client checks it comes back unchanged. */
export function generateState(byteLength = 32): string {
  return randomToken(byteLength)
}

/** An OIDC `nonce` value. Same construction as `generateState` — random
 * bytes, base64url-encoded — because a nonce has the same requirement: the
 * client mints it, the token echoes it, and only unpredictability matters. */
export function generateNonce(byteLength = 32): string {
  return randomToken(byteLength)
}

const options = [
  {
    key: 'mode',
    label: 'Mode',
    kind: 'button-group',
    default: 'generate',
    choices: [
      { value: 'generate', label: 'Generate' },
      { value: 'verify', label: 'Verify' },
    ],
  },
  {
    key: 'verifier',
    label: 'code_verifier',
    kind: 'text',
    default: '',
    placeholder: 'Paste code_verifier…',
  },
  {
    key: 'challenge',
    label: 'code_challenge',
    kind: 'text',
    default: '',
    placeholder: 'Paste S256 challenge…',
  },
] as const satisfies readonly ToolOption[]

/** A pasted verifier is the one shape magic paste can recognise here — a
 * challenge or a state/nonce is equally plausible as a dozen other base64url
 * tokens on the page, but the 43-to-128 length band together with the
 * unreserved alphabet is RFC 7636's own definition of a verifier, so scoring
 * it at a middling confidence lets a more specific tool still win. */
function detect(input: string): number {
  const trimmed = input.trim()
  if (
    trimmed.length >= MIN_VERIFIER_LENGTH &&
    trimmed.length <= MAX_VERIFIER_LENGTH &&
    /^[A-Za-z0-9\-._~]+$/.test(trimmed)
  ) {
    return 0.6
  }
  return 0
}

async function generate(): Promise<ToolResult> {
  const verifier = generateVerifier()
  const challenge = await deriveChallenge(verifier)
  const state = generateState()
  const nonce = generateNonce()

  return {
    ok: true,
    output: `verifier: ${verifier}\nchallenge: ${challenge}\nstate: ${state}\nnonce: ${nonce}`,
    fields: [
      { label: 'code_verifier', value: verifier, copy: true },
      { label: 'code_challenge (S256)', value: challenge, copy: true },
      { label: 'state', value: state, copy: true },
      { label: 'nonce', value: nonce, copy: true },
    ],
  }
}

async function verify(toolOptions: ToolOptions): Promise<ToolResult> {
  const verifier = toolOptions.verifier ?? ''
  const challenge = toolOptions.challenge ?? ''

  if (verifier === '' || challenge === '') {
    return {
      ok: false,
      output: '',
      error: 'Paste a code_verifier and code_challenge to verify.',
    }
  }

  const derived = await deriveChallenge(verifier)
  const match = derived === challenge

  return {
    ok: match,
    output: match
      ? '✓ Verifier matches challenge'
      : '✗ Verifier does not match challenge',
    fields: [
      { label: 'code_verifier', value: verifier },
      { label: 'expected challenge', value: challenge },
      { label: 'derived challenge', value: derived },
      {
        label: 'match',
        value: match ? '✓ valid' : '✗ mismatch',
        warn: !match,
      },
    ],
  }
}

async function run(_input: string, toolOptions: ToolOptions): Promise<ToolResult> {
  try {
    return toolOptions.mode === 'verify' ? await verify(toolOptions) : await generate()
  } catch (error) {
    return {
      ok: false,
      output: '',
      error: error instanceof Error ? error.message : 'PKCE generation failed',
    }
  }
}

export const pkce = {
  id: 'pkce',
  name: 'pkce',
  options,
  detect,
  run,
  generates: true,
} satisfies Tool
