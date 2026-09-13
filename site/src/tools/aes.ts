/*
 * AES-GCM notes: a passphrase-encrypted note that round-trips through a
 * single base64 blob — something a reader can paste into a text file or a
 * chat message and decrypt later with the same passphrase.
 *
 * Blob layout, version 1 (`0x01`), all fields concatenated before base64:
 *
 *   version (1 byte) | salt (16 bytes) | iv (12 bytes) | ciphertext (n bytes)
 *
 * The version byte is checked before anything else is trusted: a future
 * layout change ships as version `0x02` and this tool refuses to guess at an
 * unknown one rather than misreading its fields. `salt` and `iv` travel in
 * the clear beside the ciphertext — GCM's IV must never repeat under the same
 * key, but it need not be secret, and PBKDF2's salt exists precisely so it can
 * be public — so nothing about the blob depends on either being hidden.
 *
 * Key derivation is PBKDF2-SHA-256 at 600,000 iterations (OWASP's current
 * floor for that hash) over a fresh random 16-byte salt per encryption, so
 * two notes under the same passphrase never derive the same key. Encryption
 * is AES-256-GCM with a fresh random 12-byte IV — the length GCM is defined
 * for and every other implementation expects — so authentication tag and
 * ciphertext come back from `crypto.subtle.encrypt` already concatenated.
 *
 * GCM's authentication tag is what turns a wrong passphrase or a tampered
 * blob into a hard failure: `crypto.subtle.decrypt` rejects rather than
 * returning bytes when the tag does not match, so this tool never has
 * plaintext to hand back on that path — there is no partial result to
 * accidentally return.
 *
 * `sensitive: true` (see `Tool.sensitive` in types.ts): the note and its
 * decryption are the whole point of secrecy here, not one field among
 * several, so the tool opts the entire input and options out of the URL
 * fragment. The passphrase option additionally carries `secret: true` so the
 * pane renders it as a password field and masks it on screen too.
 */

import type { Tool, ToolField, ToolOption, ToolOptions, ToolResult } from './types.ts'

const options: readonly ToolOption[] = [
  {
    key: 'mode',
    label: 'Mode',
    kind: 'button-group',
    default: 'encrypt',
    choices: [
      { value: 'encrypt', label: 'encrypt' },
      { value: 'decrypt', label: 'decrypt' },
    ],
  },
  {
    key: 'passphrase',
    label: 'Passphrase',
    kind: 'text',
    default: '',
    placeholder: 'never written to the URL',
    secret: true,
  },
]

/* Web Crypto takes a `BufferSource`, which excludes an array backed by a
 * `SharedArrayBuffer`; naming the backing buffer (as totp.ts does for the
 * same reason) keeps that check at the helpers that slice a blob apart
 * rather than at every call into `crypto.subtle`. */
type Bytes = Uint8Array<ArrayBuffer>

const utf8 = new TextEncoder()
const utf8Decoder = new TextDecoder('utf-8', { fatal: true })

const VERSION = 0x01
const SALT_LENGTH = 16
const IV_LENGTH = 12
/** Bytes before the ciphertext: version + salt + iv. A blob shorter than
 * this cannot hold a real header, whatever its version byte claims. */
const HEADER_LENGTH = 1 + SALT_LENGTH + IV_LENGTH

const PBKDF2_ITERATIONS = 600_000

const fail = (error: string): ToolResult => ({ ok: false, output: '', error })

/** Bytes to standard base64, the same way `base64.ts` and `secret.ts` do it:
 * a binary string built one character per byte, then the platform encoder. */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/** Standard base64 back to bytes, or `null` when the text is not decodable
 * base64 at all. Whitespace is stripped first — a blob copied out of a note
 * or a chat message routinely picks up line wraps. */
function base64ToBytes(text: string): Bytes | null {
  const compact = text.replace(/\s+/g, '')
  if (compact === '') return new Uint8Array(0)
  try {
    const binary = atob(compact)
    return Uint8Array.from(binary, (character) => character.charCodeAt(0))
  } catch {
    return null
  }
}

/** The PBKDF2-SHA-256 derived AES-256-GCM key for `passphrase` and `salt`.
 * Not extractable, and scoped to the one usage (`encrypt` or `decrypt`) the
 * caller needs — a decrypt path has no business holding a key that could
 * encrypt. */
async function deriveKey(
  passphrase: string,
  salt: Bytes,
  usage: 'encrypt' | 'decrypt',
): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    utf8.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    [usage],
  )
}

async function encrypt(input: string, passphrase: string): Promise<ToolResult> {
  if (passphrase === '') return fail('enter a passphrase')

  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH))
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))
  const key = await deriveKey(passphrase, salt, 'encrypt')
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, utf8.encode(input)),
  )

  const blob = new Uint8Array(HEADER_LENGTH + ciphertext.length)
  blob[0] = VERSION
  blob.set(salt, 1)
  blob.set(iv, 1 + SALT_LENGTH)
  blob.set(ciphertext, HEADER_LENGTH)

  const fields: ToolField[] = [
    { label: 'Blob', value: `${blob.length} bytes (base64 below)` },
    { label: 'KDF', value: `PBKDF2-SHA-256, ${PBKDF2_ITERATIONS.toLocaleString()} iterations` },
    { label: 'Cipher', value: 'AES-256-GCM' },
  ]

  return { ok: true, output: bytesToBase64(blob), fields }
}

async function decrypt(input: string, passphrase: string): Promise<ToolResult> {
  if (passphrase === '') return fail('enter a passphrase')

  const blob = base64ToBytes(input.trim())
  if (blob === null || blob.length === 0) {
    return fail('malformed blob: not valid base64')
  }

  // The version byte is checked before anything else about the blob is
  // trusted — a layout this tool has never shipped is refused outright
  // rather than read as if it matched the current one.
  const version = blob[0]
  if (version !== VERSION) {
    return fail('Unsupported version')
  }

  if (blob.length < HEADER_LENGTH) {
    return fail('malformed blob: truncated before the ciphertext')
  }

  // `slice` on the decoded blob does not carry the `ArrayBuffer`-backed type
  // through; `Uint8Array.from` copies each piece into one that does, the same
  // move `base64ToBytes` and totp.ts's secret decoding make for the same
  // reason.
  const salt = Uint8Array.from(blob.slice(1, 1 + SALT_LENGTH))
  const iv = Uint8Array.from(blob.slice(1 + SALT_LENGTH, HEADER_LENGTH))
  const ciphertext = Uint8Array.from(blob.slice(HEADER_LENGTH))

  const key = await deriveKey(passphrase, salt, 'decrypt')

  let plaintext: ArrayBuffer
  try {
    plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext)
  } catch {
    // AES-GCM rejects rather than returning bytes when the authentication
    // tag does not match — a wrong passphrase and a tampered blob look
    // identical from here, and there is no partial plaintext to hand back.
    return {
      ok: false,
      output: '',
      error: 'Authentication failed — wrong passphrase or corrupted data',
    }
  }

  // The tag authenticates every ciphertext byte, so a successful decrypt's
  // plaintext is exactly what `encrypt` fed to `TextEncoder` — always valid
  // UTF-8 — and this decode cannot itself fail.
  const text = utf8Decoder.decode(plaintext)

  return {
    ok: true,
    output: text,
    fields: [{ label: 'Plaintext', value: `${plaintext.byteLength} bytes` }],
  }
}

async function run(input: string, toolOptions: ToolOptions): Promise<ToolResult> {
  if (input === '') return { ok: true, output: '' }

  const mode = toolOptions.mode === 'decrypt' ? 'decrypt' : 'encrypt'
  const passphrase = toolOptions.passphrase ?? ''

  return mode === 'encrypt' ? encrypt(input, passphrase) : decrypt(input, passphrase)
}

export const aes = {
  id: 'aes',
  name: 'AES-GCM',
  options,
  run,
  sensitive: true,
} satisfies Tool
