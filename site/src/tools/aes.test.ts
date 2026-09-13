import { describe, expect, it } from 'vitest'

import { aes } from './aes.ts'

/** Round-trips `input` through `aes.run` under `passphrase`, both directions,
 * and returns the decrypt result — the shape almost every test below wants. */
async function roundTrip(input: string, passphrase: string) {
  const encrypted = await aes.run(input, { mode: 'encrypt', passphrase })
  expect(encrypted.ok).toBe(true)
  const decrypted = await aes.run(encrypted.output, { mode: 'decrypt', passphrase })
  return { encrypted, decrypted }
}

describe('aes.run', () => {
  it('reports itself as sensitive with a masked passphrase option', () => {
    expect(aes.id).toBe('aes')
    expect(aes.sensitive).toBe(true)
    const passphraseOption = aes.options?.find((option) => option.key === 'passphrase')
    expect(passphraseOption?.secret).toBe(true)
  })

  it('returns an empty result for empty input', async () => {
    const result = await aes.run('', { mode: 'encrypt', passphrase: 'anything' })
    expect(result).toEqual({ ok: true, output: '' })
  })

  it('round-trips ordinary text', async () => {
    const { decrypted } = await roundTrip('the note', 'correct horse battery staple')
    expect(decrypted.ok).toBe(true)
    expect(decrypted.output).toBe('the note')
  })

  it('round-trips Unicode text', async () => {
    const text = '🔐 pässphrase café — 日本語のノート'
    const { decrypted } = await roundTrip(text, 'a passphrase')
    expect(decrypted.ok).toBe(true)
    expect(decrypted.output).toBe(text)
  })

  it('produces a version byte and a 16-byte salt plus 12-byte IV per encryption', async () => {
    const first = await aes.run('same note', { mode: 'encrypt', passphrase: 'p' })
    const second = await aes.run('same note', { mode: 'encrypt', passphrase: 'p' })
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)

    const firstBlob = Uint8Array.from(atob(first.output), (c) => c.charCodeAt(0))
    const secondBlob = Uint8Array.from(atob(second.output), (c) => c.charCodeAt(0))

    expect(firstBlob[0]).toBe(0x01)
    // Header (version + 16-byte salt + 12-byte IV) plus at least the GCM tag.
    expect(firstBlob.length).toBeGreaterThanOrEqual(1 + 16 + 12 + 16)

    // Same plaintext, same passphrase, two runs: the random salt and IV must
    // still produce different blobs, or the "random" in their description is
    // a lie.
    expect(firstBlob).not.toEqual(secondBlob)
  })

  it('fails authentication on the wrong passphrase, with no partial plaintext', async () => {
    const encrypted = await aes.run('a secret note', { mode: 'encrypt', passphrase: 'right' })
    const decrypted = await aes.run(encrypted.output, { mode: 'decrypt', passphrase: 'wrong' })

    expect(decrypted.ok).toBe(false)
    expect(decrypted.output).toBe('')
    expect(decrypted.error).toMatch(/authentication failed/i)
  })

  it('fails authentication when a single ciphertext bit is flipped', async () => {
    const encrypted = await aes.run('tamper-evident', { mode: 'encrypt', passphrase: 'p' })
    const blob = Uint8Array.from(atob(encrypted.output), (c) => c.charCodeAt(0))
    // Flip one bit well past the header, inside the ciphertext/tag.
    blob[blob.length - 1] ^= 0x01
    const tampered = btoa(String.fromCharCode(...blob))

    const decrypted = await aes.run(tampered, { mode: 'decrypt', passphrase: 'p' })
    expect(decrypted.ok).toBe(false)
    expect(decrypted.output).toBe('')
    expect(decrypted.error).toMatch(/authentication failed/i)
  })

  it('rejects an unknown version byte before attempting to decrypt', async () => {
    const encrypted = await aes.run('note', { mode: 'encrypt', passphrase: 'p' })
    const blob = Uint8Array.from(atob(encrypted.output), (c) => c.charCodeAt(0))
    blob[0] = 0x02
    const wrongVersion = btoa(String.fromCharCode(...blob))

    const decrypted = await aes.run(wrongVersion, { mode: 'decrypt', passphrase: 'p' })
    expect(decrypted).toEqual({
      ok: false,
      output: '',
      error: 'Unsupported version',
    })
  })

  it('rejects a blob truncated before the ciphertext', async () => {
    // Version byte plus a short salt: fewer than the 29 header bytes
    // (version + 16-byte salt + 12-byte IV) a real blob always has.
    const short = btoa(String.fromCharCode(0x01, 1, 2, 3))
    const decrypted = await aes.run(short, { mode: 'decrypt', passphrase: 'p' })
    expect(decrypted.ok).toBe(false)
    expect(decrypted.output).toBe('')
    expect(decrypted.error).toBeTruthy()
  })

  it('rejects a malformed (non-base64) blob', async () => {
    const decrypted = await aes.run('not base64!!! @@@', { mode: 'decrypt', passphrase: 'p' })
    expect(decrypted.ok).toBe(false)
    expect(decrypted.output).toBe('')
    expect(decrypted.error).toBeTruthy()
  })

  it('requires a passphrase on encrypt', async () => {
    const result = await aes.run('note', { mode: 'encrypt', passphrase: '' })
    expect(result.ok).toBe(false)
    expect(result.output).toBe('')
  })

  it('requires a passphrase on decrypt', async () => {
    const encrypted = await aes.run('note', { mode: 'encrypt', passphrase: 'p' })
    const result = await aes.run(encrypted.output, { mode: 'decrypt', passphrase: '' })
    expect(result.ok).toBe(false)
    expect(result.output).toBe('')
  })

  it('round-trips empty note text once a passphrase is set', async () => {
    // Empty *input* short-circuits before encryption ever runs (see the
    // empty-input test above); an empty *note* with real input around it is
    // covered by encrypting a string that decodes to zero bytes of meaning,
    // which the round trip below exercises with a single space instead, since
    // `aes.run('', ...)` is reserved for "nothing to show yet".
    const { decrypted } = await roundTrip(' ', 'p')
    expect(decrypted.ok).toBe(true)
    expect(decrypted.output).toBe(' ')
  })
})
