/*
 * What is actually in a certificate, a chain or a CSR — and, for a chain,
 * whether it is in the order a server is supposed to send it.
 *
 * The reason this is a tool rather than an `openssl x509 -text` habit is the
 * three questions that get asked about a certificate in an incident: which
 * names does it cover, when does it expire, and is this the certificate the
 * fingerprint in the console refers to. Those are the fields, in that order,
 * with the expiry carrying a `warn` inside thirty days so the answer is
 * visible without arithmetic. Everything else `openssl` prints — the modulus
 * digits, the signature bytes — is noise for that job and is left out.
 *
 * A chain gets one extra row. `chain.pem` files are wrong in the field far
 * more often than certificates are, and almost always in the same way: the
 * blocks are in the wrong order, so each certificate's issuer is not the next
 * block's subject. That check is mechanical and nobody does it by eye, so the
 * tool does it and names the broken link. Every certificate's rows are still
 * reported, prefixed `#1`, `#2`, so a chain's fields stay attributable.
 *
 * DER walking is the vendored `vendor/asn1.ts`, which knows nothing about
 * X.509: the structures are navigated here, by index, exactly as RFC 5280 and
 * RFC 2986 specify them. Fingerprints are `crypto.subtle.digest` over the
 * block's own DER, so the value can be compared against
 * `openssl x509 -fingerprint -sha256` character for character.
 *
 * The `authorized_keys` line is here rather than in its own tool because it is
 * the same question — "is this the key the server has?" — answered by the same
 * two fingerprints, and pasting a public key into a certificate decoder is
 * what a reader does anyway. Its MD5 comes from the vendored implementation,
 * since Web Crypto declines to provide one and older OpenSSH prints nothing
 * else.
 *
 * Nothing here throws. A truncated PEM, a base64 line that lost a character
 * to a chat client, a DER that is not a certificate at all: each comes back as
 * `ok: false` with a message the pane renders inline.
 */

import type { Tool, ToolField, ToolResult } from './types.ts'
import type { Asn1Node } from './vendor/asn1.ts'
import {
  findFirst,
  oidToString,
  parseDer,
  readBitString,
  readString,
  readTime,
  TAG,
} from './vendor/asn1.ts'
import { md5 } from './vendor/md5.ts'

/* Web Crypto takes a `BufferSource`, which excludes an array backed by a
 * `SharedArrayBuffer`; naming the backing buffer keeps that check at the
 * decoder rather than at the digest call. */
type Bytes = Uint8Array<ArrayBuffer>

/** A malformed input, as opposed to a bug in the navigation below. Carries a
 * message that already reads as a sentence, because it goes straight into the
 * result's `error`. */
class CertError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CertError'
  }
}

/** The distinguished-name attributes worth their short name. Anything else
 * renders as its dotted OID, which is more useful than dropping the RDN: a
 * name is being compared against another name, and a component nobody
 * recognises still has to appear. */
const ATTRIBUTE_NAMES: Record<string, string> = {
  '2.5.4.3': 'CN',
  '2.5.4.4': 'SN',
  '2.5.4.5': 'serialNumber',
  '2.5.4.6': 'C',
  '2.5.4.7': 'L',
  '2.5.4.8': 'ST',
  '2.5.4.9': 'STREET',
  '2.5.4.10': 'O',
  '2.5.4.11': 'OU',
  '2.5.4.12': 'title',
  '2.5.4.42': 'GN',
  '1.2.840.113549.1.9.1': 'emailAddress',
  '0.9.2342.19200300.100.1.1': 'UID',
  '0.9.2342.19200300.100.1.25': 'DC',
}

/** Signature algorithms by OID, spelled the way `openssl` spells them so a
 * row can be compared against its output. */
const SIGNATURE_ALGORITHMS: Record<string, string> = {
  '1.2.840.113549.1.1.5': 'sha1WithRSAEncryption',
  '1.2.840.113549.1.1.10': 'rsassaPss',
  '1.2.840.113549.1.1.11': 'sha256WithRSAEncryption',
  '1.2.840.113549.1.1.12': 'sha384WithRSAEncryption',
  '1.2.840.113549.1.1.13': 'sha512WithRSAEncryption',
  '1.2.840.10045.4.3.2': 'ecdsa-with-SHA256',
  '1.2.840.10045.4.3.3': 'ecdsa-with-SHA384',
  '1.2.840.10045.4.3.4': 'ecdsa-with-SHA512',
  '1.3.101.112': 'Ed25519',
  '1.3.101.113': 'Ed448',
}

/** Named curves by OID, under the names the JOSE and Web Crypto worlds use
 * rather than the `prime256v1` spelling only OpenSSL still prints. The bit
 * size is the curve's, since an EC key has no modulus to measure. */
const CURVES: Record<string, { name: string; bits: number }> = {
  '1.2.840.10045.3.1.7': { name: 'P-256', bits: 256 },
  '1.3.132.0.34': { name: 'P-384', bits: 384 },
  '1.3.132.0.35': { name: 'P-521', bits: 521 },
  '1.3.132.0.10': { name: 'secp256k1', bits: 256 },
}

const OID_RSA = '1.2.840.113549.1.1.1'
const OID_EC_PUBLIC_KEY = '1.2.840.10045.2.1'
const OID_ED25519 = '1.3.101.112'
const OID_ED448 = '1.3.101.113'
const OID_DSA = '1.2.840.10040.4.1'
/** The SAN extension, RFC 5280 §4.2.1.6. */
const OID_SUBJECT_ALT_NAME = '2.5.29.17'
/** PKCS#9 `extensionRequest`, how a CSR carries the extensions it is asking
 * for — including the SANs, which is the whole reason to read a CSR. */
const OID_EXTENSION_REQUEST = '1.2.840.113549.1.9.14'

/** BMPString: UTF-16BE, and the one string type `readString` declines. Rare
 * outside certificates a Windows CA issued, and common enough inside them
 * that decoding it beats rendering a name full of NULs. */
const TAG_BMP_STRING = 30

const PEM_BLOCK =
  /-----BEGIN ([A-Z0-9 ]+)-----([\sA-Za-z0-9+/=]*?)-----END \1-----/g

/** The PEM labels this tool decodes. `X509 CERTIFICATE` is the older spelling
 * some tools still emit; `NEW CERTIFICATE REQUEST` is what a Netscape-era
 * lineage of tools writes for a CSR. */
const PEM_LABELS: Record<string, 'certificate' | 'request'> = {
  CERTIFICATE: 'certificate',
  'X509 CERTIFICATE': 'certificate',
  'CERTIFICATE REQUEST': 'request',
  'NEW CERTIFICATE REQUEST': 'request',
}

/** One `authorized_keys` line: the key type, the base64 blob and an optional
 * comment. Leading key options (`command="…",no-pty ssh-rsa AAAA…`) are not
 * matched on purpose — an options field can itself contain spaces and quoted
 * commas, and mis-splitting one would fingerprint the wrong bytes. */
const SSH_LINE =
  /^(ssh-[a-z0-9-]+|ecdsa-sha2-[a-z0-9-]+)[ \t]+([A-Za-z0-9+/]+={0,2})(?:[ \t]+(\S.*))?$/

/** Bit sizes for the SSH key types whose size is in the name rather than in
 * the blob. */
const SSH_CURVE_BITS: Record<string, number> = {
  'ecdsa-sha2-nistp256': 256,
  'ecdsa-sha2-nistp384': 384,
  'ecdsa-sha2-nistp521': 521,
}

const utf16be = new TextDecoder('utf-16be', { fatal: false })

/** An instant as ISO 8601 UTC to the second. The milliseconds a certificate
 * never carries would be three digits of noise in every date row. */
const isoUtc = (date: Date): string =>
  date.toISOString().replace(/\.\d{3}Z$/, 'Z')

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')

/** Colon-separated pairs, as every tool that prints a fingerprint does.
 * Uppercase for a certificate digest, matching `openssl x509 -fingerprint`;
 * lowercase for an SSH one, matching `ssh-keygen -l -E md5`. */
const colonHex = (hex: string): string =>
  (hex.match(/../g) ?? []).join(':')

/** The number of significant bits in a big-endian byte string — an RSA
 * modulus or a DSA prime, both of which carry a leading zero byte when their
 * top bit is set. */
function bitLength(bytes: Uint8Array): number {
  let index = 0
  while (index < bytes.length && bytes[index] === 0) index += 1
  if (index === bytes.length) return 0
  return (bytes.length - index - 1) * 8 + (32 - Math.clz32(bytes[index]))
}

/** An attribute value's text. Tolerant by design: the reader came to see what
 * the certificate claims, so a PrintableString carrying bytes it should not is
 * still rendered rather than refused. */
function readAttributeValue(node: Asn1Node): string {
  if (node.tagNumber === TAG_BMP_STRING) return utf16be.decode(node.contents)
  try {
    return readString(node)
  } catch {
    return new TextDecoder('utf-8', { fatal: false }).decode(node.contents)
  }
}

/**
 * An RDNSequence as `CN=tools.example, O=Tools Fixtures`.
 *
 * In encoded order, which is the order the issuer wrote and the order
 * `openssl` prints, so the string can be compared against its output — and,
 * more importantly, compared against the next certificate's subject to check
 * a chain's order.
 */
function readName(node: Asn1Node): string {
  const parts: string[] = []
  for (const rdn of node.children ?? []) {
    for (const attribute of rdn.children ?? []) {
      const type = attribute.children?.[0]
      const value = attribute.children?.[1]
      if (type === undefined || value === undefined) continue
      const oid = oidToString(type.contents)
      parts.push(
        `${ATTRIBUTE_NAMES[oid] ?? oid}=${readAttributeValue(value)}`,
      )
    }
  }
  return parts.join(', ')
}

/** An IPv4 or IPv6 address from a SAN's raw bytes. IPv6 gets RFC 5952's
 * longest-run `::` compression, because an uncompressed address does not match
 * the form it is being compared against anywhere else. */
function formatIpAddress(bytes: Uint8Array): string {
  if (bytes.length === 4) return Array.from(bytes).join('.')
  if (bytes.length !== 16) return `0x${toHex(bytes)}`

  const groups: number[] = []
  for (let index = 0; index < 16; index += 2) {
    groups.push((bytes[index] << 8) | bytes[index + 1])
  }

  let bestStart = -1
  let bestLength = 0
  let runStart = -1
  for (let index = 0; index <= groups.length; index += 1) {
    if (index < groups.length && groups[index] === 0) {
      if (runStart === -1) runStart = index
      continue
    }
    if (runStart !== -1) {
      const length = index - runStart
      // Only a run of two or more is worth compressing (RFC 5952 §4.2.2).
      if (length > bestLength && length > 1) {
        bestStart = runStart
        bestLength = length
      }
      runStart = -1
    }
  }

  const text = groups.map((group) => group.toString(16))
  if (bestStart === -1) return text.join(':')
  return `${text.slice(0, bestStart).join(':')}::${text.slice(bestStart + bestLength).join(':')}`
}

/**
 * The SANs in a GeneralNames, as `DNS:name` / `IP:address` / `email:address` /
 * `URI:url`.
 *
 * The four forms that name a service, which is what a reader is checking a
 * certificate against. The rest of GeneralName — otherName, directoryName, a
 * registered ID — is reported as its context tag rather than decoded: those
 * appear in smartcard and Kerberos certificates, where they mean something
 * specific to a profile this tool has no business guessing at.
 */
function readSubjectAltNames(node: Asn1Node): string[] {
  const names: string[] = []
  for (const name of node.children ?? []) {
    if (name.tagClass !== 'context') continue
    const text = new TextDecoder('utf-8', { fatal: false }).decode(
      name.contents,
    )
    switch (name.tagNumber) {
      case 1:
        names.push(`email:${text}`)
        break
      case 2:
        names.push(`DNS:${text}`)
        break
      case 6:
        names.push(`URI:${text}`)
        break
      case 7:
        names.push(`IP:${formatIpAddress(name.contents)}`)
        break
      default:
        names.push(`otherName(tag ${name.tagNumber})`)
    }
  }
  return names
}

/** The SANs from a SEQUENCE OF Extension, or an empty list when there is no
 * SAN extension. `extnValue` is an OCTET STRING wrapping its own DER, which is
 * why the value is parsed a second time. */
function sansFromExtensions(extensions: Asn1Node | undefined): string[] {
  for (const extension of extensions?.children ?? []) {
    const parts = extension.children ?? []
    const id = parts[0]
    // `critical` is optional and sits between the id and the value, so the
    // value is the last member rather than a fixed index.
    const value = parts[parts.length - 1]
    if (id === undefined || value === undefined) continue
    if (oidToString(id.contents) !== OID_SUBJECT_ALT_NAME) continue
    return readSubjectAltNames(parseDer(value.contents))
  }
  return []
}

/** A public key's algorithm and size from a SubjectPublicKeyInfo. The size
 * comes from wherever that algorithm keeps it: an RSA modulus is measured, an
 * EC key's curve is looked up, and an Ed25519 key is 256 bits by definition. */
function readPublicKey(spki: Asn1Node): { algorithm: string; bits?: number } {
  const algorithm = spki.children?.[0]
  const keyOid = algorithm?.children?.[0]
  const key = spki.children?.[1]
  if (algorithm === undefined || keyOid === undefined || key === undefined) {
    throw new CertError('subject public key info is not in the expected shape')
  }

  const oid = oidToString(keyOid.contents)
  if (oid === OID_RSA) {
    // RSAPublicKey ::= SEQUENCE { modulus INTEGER, publicExponent INTEGER },
    // itself DER inside the BIT STRING.
    const modulus = findFirst(parseDer(readBitString(key.contents).bytes), [0])
    if (modulus?.tagNumber !== TAG.integer) {
      throw new CertError('RSA public key carries no modulus')
    }
    return { algorithm: 'RSA', bits: bitLength(modulus.contents) }
  }

  if (oid === OID_EC_PUBLIC_KEY) {
    const parameters = algorithm.children?.[1]
    const curve =
      parameters?.tagNumber === TAG.oid
        ? CURVES[oidToString(parameters.contents)]
        : undefined
    return {
      algorithm: curve === undefined ? 'EC' : `EC (${curve.name})`,
      bits: curve?.bits,
    }
  }

  if (oid === OID_ED25519) return { algorithm: 'Ed25519', bits: 256 }
  if (oid === OID_ED448) return { algorithm: 'Ed448', bits: 448 }

  if (oid === OID_DSA) {
    const prime = findFirst(algorithm, [1, 0])
    return {
      algorithm: 'DSA',
      bits: prime === undefined ? undefined : bitLength(prime.contents),
    }
  }

  return { algorithm: oid }
}

const algorithmName = (node: Asn1Node | undefined): string => {
  const oid = node?.children?.[0]
  if (oid === undefined) return 'unknown'
  const dotted = oidToString(oid.contents)
  return SIGNATURE_ALGORITHMS[dotted] ?? dotted
}

/** Everything the rows are built from, for either kind of block. A CSR has no
 * issuer, validity or serial, so those are optional rather than faked. */
interface ParsedBlock {
  kind: 'certificate' | 'request'
  subject: string
  issuer?: string
  sans: string[]
  notBefore?: Date
  notAfter?: Date
  key: { algorithm: string; bits?: number }
  signatureAlgorithm: string
  serial?: string
  der: Bytes
}

/**
 * A Certificate (RFC 5280 §4.1).
 *
 * `version` is `[0] EXPLICIT` and defaults to v1, so it is present in every
 * certificate issued this century and absent from a few old ones; every field
 * after it shifts by one when it is missing, which is what `offset` is for.
 */
function parseCertificate(der: Bytes): ParsedBlock {
  const root = parseDer(der)
  const fields = root.children?.[0]?.children
  if (fields === undefined) {
    throw new CertError('not a certificate: no tbsCertificate sequence')
  }

  const versioned =
    fields[0]?.tagClass === 'context' && fields[0]?.tagNumber === 0
  const offset = versioned ? 1 : 0
  const at = (index: number): Asn1Node | undefined => fields[offset + index]

  const serial = at(0)
  const issuer = at(2)
  const validity = at(3)
  const subject = at(4)
  const spki = at(5)
  if (
    serial === undefined ||
    issuer === undefined ||
    validity === undefined ||
    subject === undefined ||
    spki === undefined
  ) {
    throw new CertError('not a certificate: tbsCertificate is missing fields')
  }

  const notBefore = validity.children?.[0]
  const notAfter = validity.children?.[1]
  if (notBefore === undefined || notAfter === undefined) {
    throw new CertError('certificate validity does not carry two times')
  }

  // Extensions are `[3] EXPLICIT Extensions`, wrapping the SEQUENCE OF that
  // holds them; the [1] and [2] unique identifiers may sit in front.
  const extensions = fields.find(
    (field) => field.tagClass === 'context' && field.tagNumber === 3,
  )?.children?.[0]

  return {
    kind: 'certificate',
    subject: readName(subject),
    issuer: readName(issuer),
    sans: sansFromExtensions(extensions),
    notBefore: readTime(notBefore),
    notAfter: readTime(notAfter),
    key: readPublicKey(spki),
    signatureAlgorithm: algorithmName(root.children?.[1]),
    // Uppercase hex, padded to whole bytes: the form `openssl x509 -serial`
    // prints, so a serial can be matched against a CA's records.
    serial: toHex(serial.contents).replace(/^0+(?=..)/, '').toUpperCase(),
    der,
  }
}

/** A CertificationRequest (RFC 2986 §4). The SANs a CSR is asking for live in
 * a PKCS#9 `extensionRequest` attribute rather than in an extensions field, so
 * they are two levels deeper than a certificate's. */
function parseRequest(der: Bytes): ParsedBlock {
  const root = parseDer(der)
  const info = root.children?.[0]?.children
  if (info === undefined) {
    throw new CertError('not a certificate request: no requestInfo sequence')
  }

  const subject = info[1]
  const spki = info[2]
  if (subject === undefined || spki === undefined) {
    throw new CertError('certificate request is missing its subject or key')
  }

  const attributes = info.find(
    (field) => field.tagClass === 'context' && field.tagNumber === 0,
  )
  let extensions: Asn1Node | undefined
  for (const attribute of attributes?.children ?? []) {
    const type = attribute.children?.[0]
    if (type === undefined) continue
    if (oidToString(type.contents) !== OID_EXTENSION_REQUEST) continue
    extensions = findFirst(attribute, [1, 0])
  }

  return {
    kind: 'request',
    subject: readName(subject),
    sans: sansFromExtensions(extensions),
    key: readPublicKey(spki),
    signatureAlgorithm: algorithmName(root.children?.[1]),
    der,
  }
}

/** Days from `now` to `notAfter`, and the row that says so. Inside thirty days
 * or already past, it warns: that is the number the tool exists to surface. */
function expiryField(label: string, notAfter: Date, now: number): ToolField {
  const days = Math.floor((notAfter.getTime() - now) / 86_400_000)
  if (days < 0) {
    return {
      label,
      value: `expired ${-days} day${days === -1 ? '' : 's'} ago`,
      warn: true,
    }
  }
  return {
    label,
    value: `${days} day${days === 1 ? '' : 's'}`,
    warn: days < 30,
  }
}

/** One block's rows. Prefixed when the input held more than one block, so a
 * chain's fields say which certificate they belong to; unprefixed for a single
 * certificate, where a `#1` on every row is noise. */
async function blockFields(
  block: ParsedBlock,
  index: number,
  total: number,
  now: number,
): Promise<ToolField[]> {
  const prefix = total > 1 ? `#${index + 1} ` : ''
  const row = (label: string, value: string, warn?: boolean): ToolField =>
    warn === undefined
      ? { label: `${prefix}${label}`, value }
      : { label: `${prefix}${label}`, value, warn }

  const fingerprint = colonHex(
    toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', block.der))),
  ).toUpperCase()

  const fields: ToolField[] = [
    row(
      'Type',
      block.kind === 'certificate'
        ? 'X.509 certificate'
        : 'certificate request (CSR)',
    ),
    row('Subject', block.subject === '' ? '(empty)' : block.subject),
  ]

  if (block.issuer !== undefined) {
    fields.push(row('Issuer', block.issuer === '' ? '(empty)' : block.issuer))
  }
  fields.push(row('SANs', block.sans.length === 0 ? 'none' : block.sans.join(', ')))

  if (block.notBefore !== undefined && block.notAfter !== undefined) {
    fields.push(
      row('Not before', isoUtc(block.notBefore)),
      row('Not after', isoUtc(block.notAfter)),
    )
    const expiry = expiryField('Days remaining', block.notAfter, now)
    fields.push(row(expiry.label, expiry.value, expiry.warn))
  }

  fields.push(row('Key algorithm', block.key.algorithm))
  if (block.key.bits !== undefined) {
    fields.push(row('Key size', `${block.key.bits} bits`))
  }
  fields.push(row('Signature algorithm', block.signatureAlgorithm))
  if (block.serial !== undefined) fields.push(row('Serial', block.serial))
  fields.push(row('SHA-256 fingerprint', fingerprint))
  return fields
}

/**
 * The chain-order row: every certificate's issuer against the next one's
 * subject.
 *
 * Names are compared as the strings `readName` built, which is exact-match on
 * the RDNs in encoded order rather than RFC 5280's full name comparison — no
 * case folding, no whitespace normalisation. A CA issues with the bytes it
 * puts in its own subject, so an honest chain matches exactly; the failures
 * this catches are reordered and mismatched blocks, not two spellings of the
 * same name.
 *
 * A CSR in the middle of the input is skipped rather than treated as a link:
 * it is not part of any chain.
 */
function orderField(blocks: ParsedBlock[]): ToolField | undefined {
  const certificates = blocks.filter((block) => block.kind === 'certificate')
  if (certificates.length < 2) return undefined

  const breaks: string[] = []
  for (let index = 0; index < certificates.length - 1; index += 1) {
    const issuer = certificates[index].issuer ?? ''
    const subject = certificates[index + 1].subject
    if (issuer !== subject) {
      breaks.push(
        `#${index + 1} issuer (${issuer}) is not #${index + 2} subject (${subject})`,
      )
    }
  }

  if (breaks.length === 0) {
    return {
      label: 'Chain order',
      value: `correct — each of the ${certificates.length} certificates is issued by the next`,
    }
  }
  return {
    label: 'Chain order',
    value: `broken: ${breaks.join('; ')}`,
    warn: true,
  }
}

/** A base64 body to bytes, with the whitespace PEM wraps it in removed. */
function decodeBase64(body: string, label: string): Bytes {
  const compact = body.replaceAll(/\s+/g, '')
  try {
    return Uint8Array.from(atob(compact), (character) =>
      character.charCodeAt(0),
    )
  } catch {
    throw new CertError(`the ${label} block's base64 does not decode`)
  }
}

/** Every PEM block in the input, in order. A block whose label this tool does
 * not read is an error rather than a skip: silently ignoring the private key
 * somebody pasted, and reporting on nothing, is worse than saying so. */
function parseBlocks(input: string): ParsedBlock[] {
  const blocks: ParsedBlock[] = []
  for (const match of input.matchAll(PEM_BLOCK)) {
    const label = match[1]
    const kind = PEM_LABELS[label]
    if (kind === undefined) {
      throw new CertError(
        `unsupported PEM block: ${label} — this tool reads CERTIFICATE and CERTIFICATE REQUEST`,
      )
    }
    const der = decodeBase64(match[2], label)
    blocks.push(
      kind === 'certificate' ? parseCertificate(der) : parseRequest(der),
    )
  }
  return blocks
}

/** One length-prefixed field of an SSH wire-format blob (RFC 4251 §5). */
function readSshString(
  bytes: Uint8Array,
  at: number,
): { value: Uint8Array; next: number } {
  if (at + 4 > bytes.length) {
    throw new CertError('the SSH key blob ends mid-field')
  }
  const length =
    bytes[at] * 2 ** 24 + (bytes[at + 1] << 16) + (bytes[at + 2] << 8) + bytes[at + 3]
  const start = at + 4
  if (start + length > bytes.length) {
    throw new CertError('an SSH key field runs past the end of the blob')
  }
  return { value: bytes.subarray(start, start + length), next: start + length }
}

/** An SSH public key's size, from wherever its type keeps it: RSA and DSA
 * carry a big integer to measure, Ed25519 is fixed, and an ECDSA key's curve
 * is in its own type name. */
function sshKeyBits(type: string, blob: Uint8Array, at: number): number | undefined {
  if (type === 'ssh-rsa') {
    // RSAPublicKey on the wire is exponent then modulus, the opposite order
    // from PKCS#1.
    const exponent = readSshString(blob, at)
    return bitLength(readSshString(blob, exponent.next).value)
  }
  if (type === 'ssh-dss') return bitLength(readSshString(blob, at).value)
  if (type === 'ssh-ed25519') return 256
  return SSH_CURVE_BITS[type]
}

/** An `authorized_keys` line's rows: what kind of key it is and the two
 * fingerprints `ssh-keygen -l` prints, so either can be matched against a
 * server's `known_hosts` or a provider's console. */
async function runSshKey(match: RegExpMatchArray): Promise<ToolResult> {
  const [, declaredType, body, comment] = match
  const blob = decodeBase64(body, 'SSH key')
  const type = readSshString(blob, 0)
  const embeddedType = new TextDecoder('utf-8', { fatal: false }).decode(
    type.value,
  )

  const sha256 = new Uint8Array(await crypto.subtle.digest('SHA-256', blob))
  const fields: ToolField[] = [
    { label: 'Type', value: 'SSH public key (authorized_keys line)' },
    { label: 'Key type', value: embeddedType },
  ]

  if (embeddedType !== declaredType) {
    fields.push({
      label: 'Type mismatch',
      value: `the line says ${declaredType} but the key blob says ${embeddedType}`,
      warn: true,
    })
  }

  const bits = sshKeyBits(embeddedType, blob, type.next)
  if (bits !== undefined) fields.push({ label: 'Key size', value: `${bits} bits` })
  if (comment !== undefined) fields.push({ label: 'Comment', value: comment })

  fields.push(
    // Lowercase, matching `ssh-keygen -l -E md5`; a certificate fingerprint is
    // uppercase because that is how `openssl` prints one, and both are
    // compared against those tools rather than against each other.
    { label: 'MD5 fingerprint', value: colonHex(md5(blob)) },
    {
      label: 'SHA256 fingerprint',
      // Unpadded base64 with the algorithm in front: the exact string
      // `ssh-keygen -l` prints and `known_hosts` comparisons quote.
      value: `SHA256:${btoa(String.fromCharCode(...sha256)).replace(/=+$/, '')}`,
    },
  )

  return { ok: true, output: asText(fields), fields }
}

/** The `<pre>` view: the same rows the table shows, label-aligned so a chain's
 * two subjects line up under each other. */
function asText(fields: ToolField[]): string {
  const width = Math.max(...fields.map((field) => field.label.length))
  return fields
    .map((field) => `${field.label.padEnd(width)}  ${field.value}`)
    .join('\n')
}

async function run(input: string): Promise<ToolResult> {
  const trimmed = input.trim()
  if (trimmed === '') return { ok: true, output: '' }

  const sshLine = SSH_LINE.exec(trimmed)

  try {
    if (sshLine !== null) return await runSshKey(sshLine)

    const blocks = parseBlocks(trimmed)
    if (blocks.length === 0) {
      return {
        ok: false,
        output: '',
        error:
          'no PEM block found — paste a -----BEGIN CERTIFICATE----- block, a CSR, or an authorized_keys line',
      }
    }

    const now = Date.now()
    const fields = (
      await Promise.all(
        blocks.map((block, index) =>
          blockFields(block, index, blocks.length, now),
        ),
      )
    ).flat()

    const order = orderField(blocks)
    if (order !== undefined) fields.unshift(order)

    return { ok: true, output: asText(fields), fields }
  } catch (error) {
    // Both an `Asn1Error` from the walker and a `CertError` from the
    // navigation above are the same thing to the reader: this input is not
    // what it looked like. Anything else is a bug and gets a generic message
    // rather than a stack the pane would render as output.
    return {
      ok: false,
      output: '',
      error: error instanceof Error ? error.message : 'could not read the input',
    }
  }
}

/** `-----BEGIN` is as close to unambiguous as a format marker gets, so it
 * scores above every other tool's ceiling; an `authorized_keys` line scores
 * lower, since a line starting `ssh-` is a weaker claim than an armour
 * header. */
function detect(input: string): number {
  const trimmed = input.trim()
  if (trimmed.includes('-----BEGIN')) return 0.95
  return SSH_LINE.test(trimmed) ? 0.8 : 0
}

export const cert = {
  id: 'cert',
  name: 'cert',
  detect,
  run,
} satisfies Tool
