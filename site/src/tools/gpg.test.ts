import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { gpg } from './gpg.ts'
import type { ToolField, ToolResult } from './types.ts'
import { crc24 } from './vendor/pgp-dearmor.ts'

/*
 * The expectations here come from GnuPG, not from this tool.
 *
 * `test/fixtures/gpg-v4.asc` is a throwaway ed25519 key exported with
 * `gpg --armor --export`, and `gpg-v4.fingerprint.txt` is what
 * `gpg --fingerprint` said about it — the 40-hex fingerprint on the first
 * line, the 16-hex key ID on the second. Both were written once, by GnuPG,
 * and the generating commands are recorded in `README.md` beside the other
 * fixtures. A fingerprint tool checked against its own output would prove
 * nothing at all: agreeing with `gpg` is the only property it has.
 *
 * The packet-header cases are the exception, and are built here rather than
 * exported from anywhere. Real GnuPG only ever writes one of the two header
 * formats for a public-key packet, so the other one cannot be fixtured from a
 * keyring — it has to be assembled. Both wrap the *same* body, so the
 * assertion is that the two headers reach the same fingerprint, which is the
 * thing that would break if either length encoding were read wrong.
 *
 * `Buffer` and `node:fs` are test-side conveniences. Nothing in `src/tools/`
 * may use them — the page runs in a browser — which is why the armor helper
 * below lives in the test and not next to the tool.
 */

const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), '../../test/fixtures')

const fixture = (name: string): string =>
  readFileSync(resolve(fixtures, name), 'utf8')

const v4Key = fixture('gpg-v4.asc')
const v5Key = fixture('gpg-v5.asc')
const v6Key = fixture('gpg-v6.asc')

/** `gpg --fingerprint`'s two lines for the v4 fixture. */
const [expectedFingerprint, expectedKeyId] = fixture('gpg-v4.fingerprint.txt')
  .trim()
  .split('\n')

/** The default the compare field carries, and the only option this tool has.
 * Passed explicitly everywhere so no test depends on the pane's defaulting. */
const compare = (value: string) => ({ compare: value })

const NO_OPTIONS = compare('')

const field = (result: ToolResult, label: string): ToolField | undefined =>
  result.fields?.find((row) => row.label === label)

const value = (result: ToolResult, label: string): string | undefined =>
  field(result, label)?.value

/** Bytes back into an armored public key block, checksum and all — the
 * inverse of what the tool does first, so a hand-built packet stream can be
 * fed in through the same front door a paste comes through. */
function armor(bytes: Uint8Array): string {
  const crc = crc24(bytes)
  const checksum = Buffer.from([
    (crc >> 16) & 0xff,
    (crc >> 8) & 0xff,
    crc & 0xff,
  ]).toString('base64')
  const body = Buffer.from(bytes).toString('base64').replace(/(.{64})/g, '$1\n')
  return [
    '-----BEGIN PGP PUBLIC KEY BLOCK-----',
    '',
    body,
    `=${checksum}`,
    '-----END PGP PUBLIC KEY BLOCK-----',
    '',
  ].join('\n')
}

/*
 * A v4 public-key packet body: version 4, a creation time of 2021-01-01T00:00:00Z
 * (0x5FEE6600), algorithm 22 (EdDSA), then the curve OID and a point. The key
 * material is filler — the fingerprint is a hash of the whole body, so what
 * matters is only that both header formats hash the same bytes.
 */
const KEY_BODY = Uint8Array.from([
  0x04, 0x5f, 0xee, 0x66, 0x00, 0x16, 0x09, 0x2b, 0x06, 0x01, 0x04, 0x01, 0xda,
  0x47, 0x0f, 0x01, 0x01, 0x07, 0x40, ...Array.from({ length: 32 }, (_unused, index) => index),
])

/** Old format, 0b10_0110_00: tag 6 in bits 5..2, length type 0 for a
 * one-octet length. What GnuPG writes for a public-key packet. */
const oldFormat = armor(
  Uint8Array.from([0b10_0110_00, KEY_BODY.length, ...KEY_BODY]),
)

/** New format, 0b11_000110: tag 6 in the low six bits, then a one-octet
 * length because the body is under 192 bytes. */
const newFormat = armor(
  Uint8Array.from([0b11_000110, KEY_BODY.length, ...KEY_BODY]),
)

describe('gpg', () => {
  it('returns nothing for empty input', async () => {
    await expect(gpg.run('', NO_OPTIONS)).resolves.toEqual({
      ok: true,
      output: '',
    })
    await expect(gpg.run('   \n  ', NO_OPTIONS)).resolves.toEqual({
      ok: true,
      output: '',
    })
  })

  it('refuses input past the fragment size limit', async () => {
    const result = await gpg.run('a'.repeat(4097), NO_OPTIONS)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('4096')
  })

  it('rejects armor whose CRC-24 does not match its body', async () => {
    // One character of the `=bMIX` checksum line, changed. The body is
    // untouched, so nothing but the checksum can be what fails.
    const corrupted = v4Key.replace('=bMIX', '=bMIY')
    expect(corrupted).not.toBe(v4Key)

    const result = await gpg.run(corrupted, NO_OPTIONS)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('CRC-24')
  })

  it('computes the fingerprint gpg --fingerprint printed for the fixture', async () => {
    const result = await gpg.run(v4Key, NO_OPTIONS)
    expect(result.ok).toBe(true)
    expect(value(result, 'Fingerprint')?.replaceAll(' ', '')).toBe(
      expectedFingerprint,
    )
  })

  it('derives the key id from the low 64 bits of the fingerprint', async () => {
    const result = await gpg.run(v4Key, NO_OPTIONS)
    expect(value(result, 'Key ID')).toBe(`0x${expectedKeyId}`)
    expect(expectedKeyId).toBe(expectedFingerprint.slice(-16))
  })

  it('names the key algorithm', async () => {
    const result = await gpg.run(v4Key, NO_OPTIONS)
    expect(value(result, 'Algorithm')).toBe('EdDSA (Ed25519)')
  })

  it('reports the creation time as an ISO-8601 instant', async () => {
    const created = value(await gpg.run(v4Key, NO_OPTIONS), 'Created') ?? ''
    expect(created).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
    expect(Number.isNaN(Date.parse(created))).toBe(false)
  })

  it('lists the user ids attached to the key', async () => {
    const result = await gpg.run(v4Key, NO_OPTIONS)
    const uids = result.fields?.filter((row) => row.label === 'User ID') ?? []
    expect(uids.length).toBeGreaterThanOrEqual(1)
    expect(uids[0].value).toBe('Test User <test@example.com>')
  })

  it('reads an old-format packet header', async () => {
    const result = await gpg.run(oldFormat, NO_OPTIONS)
    expect(result.ok).toBe(true)
    expect(value(result, 'Algorithm')).toBe('EdDSA (Ed25519)')
    expect(value(result, 'Created')).toBe('2021-01-01T00:00:00Z')
  })

  it('reads a new-format packet header', async () => {
    const result = await gpg.run(newFormat, NO_OPTIONS)
    expect(result.ok).toBe(true)
    expect(value(result, 'Created')).toBe('2021-01-01T00:00:00Z')
  })

  it('reaches the same fingerprint through either header format', async () => {
    const [older, newer] = await Promise.all([
      gpg.run(oldFormat, NO_OPTIONS),
      gpg.run(newFormat, NO_OPTIONS),
    ])
    expect(value(older, 'Fingerprint')).toBe(value(newer, 'Fingerprint'))
    expect(value(older, 'Fingerprint')).toMatch(/^[0-9A-F]{4}( [0-9A-F]{4}){9}$/)
  })

  it('refuses a v5 key rather than computing a v4 fingerprint for it', async () => {
    const result = await gpg.run(v5Key, NO_OPTIONS)
    expect(result.ok).toBe(false)
    expect(result.error).toBe('unsupported version: v5')
    expect(result.fields).toBeUndefined()
  })

  it('refuses a v6 key rather than computing a v4 fingerprint for it', async () => {
    const result = await gpg.run(v6Key, NO_OPTIONS)
    expect(result.ok).toBe(false)
    expect(result.error).toBe('unsupported version: v6')
  })

  it('fails without throwing on input that is not armor at all', async () => {
    for (const input of [
      '{"not":"a key"}',
      '-----BEGIN PGP PUBLIC KEY BLOCK-----\nnot base64 at all!!\n=bMIX\n-----END PGP PUBLIC KEY BLOCK-----',
      '-----BEGIN PGP PUBLIC KEY BLOCK-----\n\nmDME\n',
    ]) {
      const result = await gpg.run(input, NO_OPTIONS)
      expect(result.ok).toBe(false)
      expect(result.error).toBeTruthy()
    }
  })

  it('fails on a packet whose body is shorter than its header claims', async () => {
    // Old-format tag 6, one-octet length of 100, and three bytes of body.
    const truncated = armor(Uint8Array.from([0b10_0110_00, 100, 0x04, 0x00, 0x00]))
    const result = await gpg.run(truncated, NO_OPTIONS)
    expect(result.ok).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('fails on a stream-only partial length rather than guessing the body', async () => {
    // New-format tag 6 with a first length octet of 224: a partial body,
    // which an exported key never carries.
    const partial = armor(Uint8Array.from([0b11_000110, 224, 0x04, 0x00]))
    const result = await gpg.run(partial, NO_OPTIONS)
    expect(result.ok).toBe(false)
  })

  it('says so when the input carries no public-key packet', async () => {
    // A lone User ID packet: well-formed, and not a key.
    const uidOnly = armor(
      Uint8Array.from([0b11_001101, 4, 0x74, 0x65, 0x73, 0x74]),
    )
    const result = await gpg.run(uidOnly, NO_OPTIONS)
    expect(result.ok).toBe(false)
    expect(result.error).toBe('no public-key packet found')
  })

  it('matches a compared fingerprint written the way gpg prints one', async () => {
    const blocked = (expectedFingerprint.match(/.{4}/g) ?? []).join(' ')
    const result = await gpg.run(v4Key, compare(blocked))
    expect(field(result, 'Matches')).toEqual({
      label: 'Matches',
      value: 'yes',
      warn: false,
    })
  })

  it('matches regardless of spacing, colons or case', async () => {
    const colons = (expectedFingerprint.match(/../g) ?? [])
      .join(':')
      .toLowerCase()
    const result = await gpg.run(v4Key, compare(colons))
    expect(value(result, 'Matches')).toBe('yes')
  })

  it('warns when the compared fingerprint is a different key', async () => {
    const result = await gpg.run(v4Key, compare('AABBCCDD'.repeat(5)))
    expect(field(result, 'Matches')).toEqual({
      label: 'Matches',
      value: 'no',
      warn: true,
    })
  })

  it('leaves the comparison out when nothing is being compared against', async () => {
    const result = await gpg.run(v4Key, NO_OPTIONS)
    expect(field(result, 'Matches')).toBeUndefined()
    expect(await gpg.run(v4Key, {})).toMatchObject({ ok: true })
    expect(field(await gpg.run(v4Key, {}), 'Matches')).toBeUndefined()
  })

  it('prefills the comparison with the contact fingerprint', async () => {
    const option = gpg.options.find((entry) => entry.key === 'compare')
    expect(option?.default).toMatch(/^[0-9A-F]{4}( [0-9A-F]{4}){9}$/)
    // Public by construction, so it belongs in a shared link.
    expect(option?.secret).toBeUndefined()
  })

  it('renders the fields as aligned text', async () => {
    const result = await gpg.run(v4Key, NO_OPTIONS)
    expect(result.output).toContain(
      `Fingerprint  ${value(result, 'Fingerprint')}`,
    )
    expect(result.output.split('\n')).toHaveLength(result.fields?.length ?? 0)
  })

  it('detects an armored public key block and nothing else', () => {
    expect(
      gpg.detect('-----BEGIN PGP PUBLIC KEY BLOCK-----\nmDMEaqJBMxYJ\n'),
    ).toBeGreaterThanOrEqual(0.9)
    expect(gpg.detect(`  \n${v4Key}`)).toBeGreaterThanOrEqual(0.9)
    expect(gpg.detect('{"alg":"HS256","typ":"JWT"}')).toBe(0)
    expect(gpg.detect('-----BEGIN CERTIFICATE-----')).toBe(0)
  })
})
