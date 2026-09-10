/*
 * The fingerprint of an OpenPGP public key, and whether it is the fingerprint
 * you were told to expect.
 *
 * That second half is the whole reason this is a tool. A fingerprint is only
 * worth anything when it is compared against one that arrived by a different
 * route — a business card, a web page, the `gpgFingerprint` on this site's own
 * contact section — and comparing forty hex digits by eye is exactly the task
 * a person does badly and a machine does perfectly. So the compare field is
 * prefilled with the site's own fingerprint: paste the key someone handed you
 * claiming to be this one, and the tool says yes or no instead of leaving you
 * to check ten blocks of four characters.
 *
 * What is computed is RFC 4880 §12.2's v4 fingerprint: SHA-1 over `0x99`, the
 * two-byte length of the public-key packet body, and the body itself. SHA-1 is
 * not a choice made here — it is what the format specifies, and a v4
 * fingerprint computed any other way would not match what `gpg --fingerprint`
 * prints, which is the only thing it is ever compared against. Nothing here
 * verifies a signature or trusts a key; agreeing with GnuPG on a hash is the
 * entire claim.
 *
 * v5 (RFC 4880bis) and v6 (RFC 9580) keys hash differently — SHA-256, a
 * four-byte length, a different prefix — so they are refused by name rather
 * than run through the v4 path. A tool that answered "this key's fingerprint
 * is <20 bytes of SHA-1>" for a v6 key would be handing the reader a value
 * that matches nothing and looks authoritative, which is worse than saying it
 * cannot help.
 *
 * The armor envelope and its CRC-24 are `vendor/pgp-dearmor.ts`; the packet
 * walk below is RFC 4880 §4.2, both header formats, and stops at the first
 * public-key packet. The rest of a key export — subkeys, self-signatures, the
 * web of trust — is deliberately not parsed: none of it changes the primary
 * key's fingerprint, which is the question being asked.
 *
 * Nothing leaves the browser and nothing throws: a truncated paste, a body
 * that is not packets at all and a private key block all come back as
 * `ok: false` with a message the pane renders inline.
 */

import { contact } from '../data/resume.ts'
import { MAX_HASH_INPUT_BYTES, exceedsHashLimit } from './fragment.ts'
import type { Tool, ToolField, ToolOption, ToolOptions, ToolResult } from './types.ts'
import { dearmor } from './vendor/pgp-dearmor.ts'

/** Public-key packet, RFC 4880 §5.5.1.1. The primary key is the first one in
 * a transferable public key; a subkey is tag 14 and is not it. */
const TAG_PUBLIC_KEY = 6

/** User ID packet, §5.11 — the `Name <email>` string, as raw UTF-8. */
const TAG_USER_ID = 13

/** Public-key algorithms, RFC 4880 §9.1 plus the Ed25519 assignment RFC 8032
 * and every current GnuPG use, spelled the way `gpg --list-keys` spells them
 * so a row can be read against its output. */
const ALGORITHMS: Record<number, string> = {
  1: 'RSA (Encrypt or Sign)',
  2: 'RSA Encrypt-Only',
  3: 'RSA Sign-Only',
  16: 'Elgamal Encrypt-Only',
  17: 'DSA',
  18: 'ECDH',
  19: 'ECDSA',
  22: 'EdDSA (Ed25519)',
}

const options: readonly ToolOption[] = [
  {
    key: 'compare',
    label: 'Compare fingerprint',
    kind: 'text',
    /* The site's own fingerprint, so the common case — "is this really the
     * key from the contact section?" — needs no typing at all. */
    default: contact.gpgFingerprint,
    placeholder: 'Expected fingerprint',
    /* Not secret, deliberately. A fingerprint is public by construction: it
     * is published precisely so it can be repeated, and marking it secret
     * would strip it from shared links, which is the one place a reader most
     * wants it to survive. */
  },
]

/** One packet off the wire: what it is, and its body with the header removed.
 * The body is a view into the dearmored bytes, not a copy — nothing here
 * mutates it, and the fingerprint prefix is built in its own buffer. */
interface Packet {
  tag: number
  body: Uint8Array
}

/** A malformed input rather than a bug in the walk below. The message goes
 * straight into the result's `error`, so it is written as a sentence. */
class GpgError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GpgError'
  }
}

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()

/** Hex in blocks of four, the way GnuPG prints a fingerprint and the way the
 * contact section on this site writes one — which is what makes the compare
 * field's default paste back in cleanly. */
const blocked = (hex: string): string => (hex.match(/.{1,4}/g) ?? []).join(' ')

/** The comparison form: spaces and the colons some tools separate with are
 * presentation, and case is not part of a hex string's value. Two
 * fingerprints that differ only in those are the same fingerprint. */
const normalise = (text: string): string =>
  text.replaceAll(' ', '').replaceAll(':', '').toUpperCase()

/** A big-endian integer of `count` bytes at `at`. Multiplication rather than
 * shifting for the four-byte case: `<< 24` is signed in JavaScript, and a
 * length with its top bit set would come out negative. */
function readUint(bytes: Uint8Array, at: number, count: number): number {
  if (at + count > bytes.length) {
    throw new GpgError('malformed packet header')
  }
  let value = 0
  for (let index = 0; index < count; index += 1) {
    value = value * 256 + bytes[at + index]
  }
  return value
}

/**
 * Every packet in a dearmored block, in order (RFC 4880 §4.2).
 *
 * Both header formats, because both are in the field: GnuPG writes new-format
 * headers for most things but old-format ones for public-key and User ID
 * packets, and other implementations differ. The tag is in a different place
 * in each and the length is encoded in four different ways between them, which
 * is the whole of the difficulty.
 *
 * Partial and indeterminate lengths are refused rather than guessed at. Both
 * mean "the body runs to somewhere this header does not say", which is legal
 * in a stream and does not occur in an exported key; treating one as "the
 * rest of the input" would fingerprint bytes that are not the packet.
 */
function parsePackets(bytes: Uint8Array): Packet[] {
  const packets: Packet[] = []
  let at = 0

  while (at < bytes.length) {
    const header = bytes[at]
    at += 1

    // Bit 7 is always set on a packet tag; anything else means the walk has
    // fallen out of step with the stream.
    if ((header & 0x80) === 0) throw new GpgError('malformed packet header')

    let tag: number
    let length: number

    if ((header & 0x40) === 0) {
      // Old format: 0b10TTTTLL — four tag bits, then a length *type* saying
      // how many bytes the length itself occupies.
      tag = (header >> 2) & 0x0f
      const lengthType = header & 0x03
      if (lengthType === 3) {
        throw new GpgError(
          'indeterminate-length packet — this tool reads exported keys, not streams',
        )
      }
      length = readUint(bytes, at, 1 << lengthType)
      at += 1 << lengthType
    } else {
      // New format: 0b11TTTTTT — six tag bits, and a length whose own size is
      // read off its first octet (§4.2.2).
      tag = header & 0x3f
      const first = readUint(bytes, at, 1)
      at += 1
      if (first < 192) {
        length = first
      } else if (first < 224) {
        length = (first - 192) * 256 + readUint(bytes, at, 1) + 192
        at += 1
      } else if (first === 255) {
        length = readUint(bytes, at, 4)
        at += 4
      } else {
        throw new GpgError(
          'partial-length packet — this tool reads exported keys, not streams',
        )
      }
    }

    if (at + length > bytes.length) {
      throw new GpgError('packet body runs past the end of the input')
    }
    packets.push({ tag, body: bytes.subarray(at, at + length) })
    at += length
  }

  return packets
}

/** The v4 fingerprint of a public-key packet: SHA-1 over `0x99`, the body's
 * two-byte length and the body (§12.2). The prefix is what makes a
 * fingerprint a fingerprint rather than a hash of some bytes — it is the same
 * data a self-signature hashes, which is why the two agree. */
async function fingerprintV4(body: Uint8Array): Promise<string> {
  if (body.length > 0xffff) {
    throw new GpgError('public-key packet is too large to fingerprint')
  }
  const prefixed = new Uint8Array(3 + body.length)
  prefixed[0] = 0x99
  prefixed[1] = (body.length >> 8) & 0xff
  prefixed[2] = body.length & 0xff
  prefixed.set(body, 3)
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-1', prefixed)))
}

/** The `<pre>` view: the same rows the table shows, label-aligned so the
 * fingerprint and the one it is compared against sit under each other. */
function asText(fields: ToolField[]): string {
  const width = Math.max(...fields.map((field) => field.label.length))
  return fields
    .map((field) => `${field.label.padEnd(width)}  ${field.value}`)
    .join('\n')
}

async function run(
  input: string,
  toolOptions: ToolOptions,
): Promise<ToolResult> {
  if (input.trim() === '') return { ok: true, output: '' }

  /* The same ceiling the fragment uses. A key export is under a kilobyte and
   * a keyring dump is megabytes, so the limit separates the thing this tool
   * reads from the thing it was never going to. */
  if (exceedsHashLimit(input)) {
    return {
      ok: false,
      output: '',
      error: `input exceeds ${MAX_HASH_INPUT_BYTES}-byte limit`,
    }
  }

  const { data, crcOk } = dearmor(input)
  if (!crcOk) {
    return {
      ok: false,
      output: '',
      error: 'CRC-24 checksum mismatch — corrupt or truncated armor',
    }
  }

  try {
    const packets = parsePackets(data)
    const key = packets.find((packet) => packet.tag === TAG_PUBLIC_KEY)
    if (key === undefined) {
      return { ok: false, output: '', error: 'no public-key packet found' }
    }

    // §5.5.2: the version byte is the first thing in every public-key packet,
    // and everything after it depends on which version it says.
    if (key.body.length === 0) {
      throw new GpgError('public-key packet is empty')
    }
    const version = key.body[0]
    if (version !== 4) {
      return { ok: false, output: '', error: `unsupported version: v${version}` }
    }
    if (key.body.length < 6) {
      throw new GpgError('public-key packet ends before its algorithm byte')
    }

    // Four bytes of creation time as a Unix timestamp, then the algorithm.
    const created = new Date(readUint(key.body, 1, 4) * 1000)
    const algorithm = key.body[5]
    const fingerprint = await fingerprintV4(key.body)

    const fields: ToolField[] = [
      { label: 'Fingerprint', value: blocked(fingerprint) },
      // The key ID is the fingerprint's low 64 bits (§12.2) — the short form
      // that appears in signatures and on keyservers, written `0x…` the way
      // `gpg --keyid-format long` writes it.
      { label: 'Key ID', value: `0x${fingerprint.slice(-16)}` },
      {
        label: 'Algorithm',
        value: ALGORITHMS[algorithm] ?? `unknown (${algorithm})`,
      },
      { label: 'Created', value: created.toISOString().replace(/\.\d{3}Z$/, 'Z') },
    ]

    const utf8 = new TextDecoder('utf-8', { fatal: false })
    for (const packet of packets) {
      if (packet.tag !== TAG_USER_ID) continue
      fields.push({ label: 'User ID', value: utf8.decode(packet.body) })
    }

    const expected = toolOptions.compare ?? ''
    if (expected.trim() !== '') {
      const matches = normalise(expected) === fingerprint
      fields.push({
        label: 'Matches',
        value: matches ? 'yes' : 'no',
        warn: !matches,
      })
    }

    return { ok: true, output: asText(fields), fields }
  } catch (error) {
    return {
      ok: false,
      output: '',
      error:
        error instanceof GpgError ? error.message : 'could not read the key',
    }
  }
}

/** The armor header names the format outright, so this is as certain as
 * detection gets — the same score `cert` claims for a PEM marker, since the
 * two markers are equally unambiguous and never both present. */
function detect(input: string): number {
  return input.trimStart().startsWith('-----BEGIN PGP PUBLIC KEY BLOCK-----')
    ? 0.95
    : 0
}

export const gpg = {
  id: 'gpg',
  name: 'gpg',
  options,
  detect,
  run,
} satisfies Tool
