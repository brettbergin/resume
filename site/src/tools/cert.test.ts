import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { cert } from './cert.ts'
import type { ToolField, ToolResult } from './types.ts'

/*
 * Everything asserted here is anchored outside the tool.
 *
 * The certificates, the CSR and the SSH key are committed fixtures under
 * `test/fixtures/`, generated once with the commands recorded beside each
 * constant below, and the expected fingerprints, subjects and dates were read
 * out of `openssl` and `ssh-keygen` — never out of this tool. A cert decoder
 * whose expectations came from its own output would prove nothing: the only
 * reason to open one is to agree with whatever printed the value you are
 * comparing against.
 *
 * The fixtures were issued with `-days 3650` so they do not rot, and every
 * date-dependent assertion pins the clock with `vi.setSystemTime` rather than
 * reasoning about today: the days-remaining row is a function of the fixture
 * and the clock, and both have to be fixed for the warning threshold to be
 * testable at all.
 *
 * Only `Date` is faked. The fingerprints go through `crypto.subtle.digest`,
 * whose promises resolve on the microtask queue, and faking the whole timer
 * environment would leave those awaits hanging.
 */

/* Resolved through `node:path` rather than `new URL(…, import.meta.url)`:
 * Vite reads the latter as an asset reference and refuses to serve a file from
 * outside the module graph. */
const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), '../../test/fixtures')

const fixture = (name: string): string =>
  readFileSync(resolve(fixtures, name), 'utf8')

/*
 * openssl req -x509 -newkey rsa:2048 -nodes -keyout self-signed.key \
 *   -out self-signed.pem -days 3650 -sha256 \
 *   -subj "/CN=tools.example/O=Tools Fixtures" \
 *   -addext "subjectAltName=DNS:tools.example,DNS:www.tools.example,IP:127.0.0.1"
 */
const selfSigned = fixture('self-signed.pem')

/*
 * A leaf issued by a CA, leaf first. The CA key is RSA and the leaf key is EC
 * on purpose, so one fixture covers both key-size paths — a measured modulus
 * and a curve looked up by OID.
 *
 * openssl req -x509 -newkey rsa:2048 -nodes -keyout ca.key -out ca.pem \
 *   -days 3650 -sha256 -subj "/CN=Tools Fixtures CA/O=Tools Fixtures"
 * openssl req -new -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes \
 *   -keyout leaf.key -out leaf.csr \
 *   -subj "/CN=leaf.tools.example/O=Tools Fixtures"
 * printf 'subjectAltName=DNS:leaf.tools.example,DNS:www.leaf.tools.example\n
 *   basicConstraints=CA:FALSE\n' > leaf.ext
 * openssl x509 -req -in leaf.csr -CA ca.pem -CAkey ca.key -out leaf.pem \
 *   -days 3650 -sha256 -set_serial 4097 -extfile leaf.ext
 * cat leaf.pem ca.pem > chain.pem
 * cat ca.pem leaf.pem > chain-out-of-order.pem
 */
const chain = fixture('chain.pem')
const chainOutOfOrder = fixture('chain-out-of-order.pem')

/*
 * openssl req -new -newkey rsa:2048 -nodes -keyout request.key \
 *   -out request.csr -sha256 -subj "/CN=csr.tools.example/O=Tools Fixtures" \
 *   -addext "subjectAltName=DNS:csr.tools.example"
 */
const request = fixture('request.csr')

/*
 * ssh-keygen -t ed25519 -N '' -C 'tools@example' -f id_ed25519
 * cp id_ed25519.pub authorized_keys
 */
const authorizedKeys = fixture('authorized_keys')

/** `openssl x509 -in self-signed.pem -noout -fingerprint -sha256` */
const SELF_SIGNED_SHA256 =
  '1F:97:8A:B7:99:CD:7B:99:87:42:99:4B:B6:09:44:5A:5B:78:56:33:5C:BA:5D:0B:63:E0:FD:F2:44:F5:19:DC'

/** `openssl x509 -in self-signed.pem -noout -serial` */
const SELF_SIGNED_SERIAL = '7F58A1D0C47CD6F0037281A581ACCDB15523A800'

/** `openssl x509 -in self-signed.pem -noout -dates -dateopt iso_8601` */
const NOT_BEFORE = '2026-09-09T14:18:22Z'
const NOT_AFTER = '2036-09-06T14:18:22Z'

/** The chain's two certificates, from
 * `openssl crl2pkcs7 -nocrl -certfile chain.pem | openssl pkcs7 -print_certs`
 * and `openssl x509 -fingerprint -sha256` over each block in turn. */
const LEAF_SUBJECT = 'CN=leaf.tools.example, O=Tools Fixtures'
const CA_SUBJECT = 'CN=Tools Fixtures CA, O=Tools Fixtures'
const LEAF_SHA256 =
  '8F:66:01:C4:31:EF:01:01:68:D7:1D:CE:F3:B3:A2:53:EC:24:E4:42:22:0A:3C:43:77:39:E2:FD:0F:C7:D9:B6'
const CA_SHA256 =
  '80:28:6C:48:62:9B:5D:6F:C3:59:3C:84:9B:DA:7E:72:E4:E1:9A:D8:5A:75:77:C6:4B:74:14:CF:22:D1:F0:BD'

/** `ssh-keygen -lf authorized_keys` and `ssh-keygen -E md5 -lf authorized_keys`:
 *   256 SHA256:2+JkTbXKualU2Iz74yJ30kHCR3z9AOLMnULA+IB/u1g tools@example (ED25519)
 *   256 MD5:59:96:21:39:85:7a:db:29:b3:4f:38:51:ed:9e:bb:83 tools@example (ED25519)
 */
const SSH_SHA256 = 'SHA256:2+JkTbXKualU2Iz74yJ30kHCR3z9AOLMnULA+IB/u1g'
const SSH_MD5 = '59:96:21:39:85:7a:db:29:b3:4f:38:51:ed:9e:bb:83'

/** Well inside the fixtures' ten-year validity, and the clock every assertion
 * that is not about expiry runs under. */
const MIDDLE_OF_VALIDITY = new Date('2027-01-01T00:00:00Z')

/* The tool takes no options — there is nothing to configure about reading a
 * certificate — so `run` is called with the input alone. */
const run = (input: string): Promise<ToolResult> => cert.run(input)

const fields = (result: ToolResult): ToolField[] => result.fields ?? []

/** One row by label. Fails loudly rather than returning undefined: a missing
 * row and a row with the wrong value are different bugs and should not
 * produce the same assertion failure. */
function field(result: ToolResult, label: string): ToolField {
  const found = fields(result).find((row) => row.label === label)
  if (found === undefined) {
    throw new Error(
      `no field labelled ${label}; got ${fields(result)
        .map((row) => row.label)
        .join(', ')}`,
    )
  }
  return found
}

const value = (result: ToolResult, label: string): string =>
  field(result, label).value

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(MIDDLE_OF_VALIDITY)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('the self-signed certificate fixture', () => {
  it('reports the subject and issuer as openssl prints them', async () => {
    const result = await run(selfSigned)
    expect(result.ok).toBe(true)
    expect(value(result, 'Type')).toBe('X.509 certificate')
    expect(value(result, 'Subject')).toBe('CN=tools.example, O=Tools Fixtures')
    expect(value(result, 'Issuer')).toBe('CN=tools.example, O=Tools Fixtures')
  })

  it('reports all three subject alternative names', async () => {
    const sans = value(await run(selfSigned), 'SANs')
    expect(sans).toBe('DNS:tools.example, DNS:www.tools.example, IP:127.0.0.1')
  })

  it('reports the validity window as ISO UTC', async () => {
    const result = await run(selfSigned)
    expect(value(result, 'Not before')).toBe(NOT_BEFORE)
    expect(value(result, 'Not after')).toBe(NOT_AFTER)
  })

  it('reports the key and signature algorithms', async () => {
    const result = await run(selfSigned)
    expect(value(result, 'Key algorithm')).toBe('RSA')
    expect(value(result, 'Key size')).toBe('2048 bits')
    expect(value(result, 'Signature algorithm')).toBe(
      'sha256WithRSAEncryption',
    )
    expect(value(result, 'Serial')).toBe(SELF_SIGNED_SERIAL)
  })

  it('reports the SHA-256 fingerprint openssl reports', async () => {
    expect(value(await run(selfSigned), 'SHA-256 fingerprint')).toBe(
      SELF_SIGNED_SHA256,
    )
  })

  it('renders every row in the text output too', async () => {
    const result = await run(selfSigned)
    expect(result.output).toContain('CN=tools.example')
    expect(result.output).toContain(SELF_SIGNED_SHA256)
  })

  it('does not prefix the rows of a single certificate', async () => {
    // The `#1` prefix earns its noise only when there is a `#2` to tell it
    // apart from.
    for (const row of fields(await run(selfSigned))) {
      expect(row.label).not.toMatch(/^#/)
    }
  })
})

describe('the days-remaining row', () => {
  it('does not warn well inside the validity window', async () => {
    const row = field(await run(selfSigned), 'Days remaining')
    expect(row.warn).not.toBe(true)
    expect(row.value).toMatch(/^\d+ days$/)
  })

  it('warns ten days before the certificate expires', async () => {
    vi.setSystemTime(new Date(Date.parse(NOT_AFTER) - 10 * 86_400_000))
    const row = field(await run(selfSigned), 'Days remaining')
    expect(row.warn).toBe(true)
    expect(row.value).toBe('10 days')
  })

  it('warns, and says how long ago, once it has expired', async () => {
    vi.setSystemTime(new Date(Date.parse(NOT_AFTER) + 3 * 86_400_000))
    const row = field(await run(selfSigned), 'Days remaining')
    expect(row.warn).toBe(true)
    expect(row.value).toBe('expired 3 days ago')
  })

  it('warns on the day the threshold is crossed, not a day either side', async () => {
    // 30 days is the boundary the row is documented to warn under, so both
    // sides of it are pinned rather than just the warning case.
    vi.setSystemTime(new Date(Date.parse(NOT_AFTER) - 30 * 86_400_000))
    expect(field(await run(selfSigned), 'Days remaining').warn).not.toBe(true)
    vi.setSystemTime(new Date(Date.parse(NOT_AFTER) - 29 * 86_400_000))
    expect(field(await run(selfSigned), 'Days remaining').warn).toBe(true)
  })
})

describe('a certificate chain', () => {
  it('reports both certificates, prefixed so the rows are attributable', async () => {
    const result = await run(chain)
    expect(result.ok).toBe(true)
    expect(value(result, '#1 Subject')).toBe(LEAF_SUBJECT)
    expect(value(result, '#1 Issuer')).toBe(CA_SUBJECT)
    expect(value(result, '#2 Subject')).toBe(CA_SUBJECT)
    expect(value(result, '#2 Issuer')).toBe(CA_SUBJECT)
    expect(value(result, '#1 SHA-256 fingerprint')).toBe(LEAF_SHA256)
    expect(value(result, '#2 SHA-256 fingerprint')).toBe(CA_SHA256)
  })

  it('reads the EC leaf key by its curve and the RSA CA key by its modulus', async () => {
    const result = await run(chain)
    expect(value(result, '#1 Key algorithm')).toBe('EC (P-256)')
    expect(value(result, '#1 Key size')).toBe('256 bits')
    expect(value(result, '#1 Serial')).toBe('1001')
    expect(value(result, '#2 Key algorithm')).toBe('RSA')
    expect(value(result, '#2 Key size')).toBe('2048 bits')
  })

  it('reports the leaf SANs from the issued certificate', async () => {
    expect(value(await run(chain), '#1 SANs')).toBe(
      'DNS:leaf.tools.example, DNS:www.leaf.tools.example',
    )
  })

  it('confirms the order when each issuer is the next subject', async () => {
    const row = field(await run(chain), 'Chain order')
    expect(row.warn).not.toBe(true)
    expect(row.value).toContain('correct')
  })

  it('names the broken link when the blocks are reversed', async () => {
    const result = await run(chainOutOfOrder)
    const row = field(result, 'Chain order')
    expect(row.warn).toBe(true)
    expect(row.value).toContain('#1 issuer')
    expect(row.value).toContain(CA_SUBJECT)
    expect(row.value).toContain(LEAF_SUBJECT)
  })

  it('still reports both certificates when the order is broken', async () => {
    const result = await run(chainOutOfOrder)
    expect(result.ok).toBe(true)
    expect(value(result, '#1 Subject')).toBe(CA_SUBJECT)
    expect(value(result, '#2 Subject')).toBe(LEAF_SUBJECT)
    expect(value(result, '#1 SHA-256 fingerprint')).toBe(CA_SHA256)
    expect(value(result, '#2 SHA-256 fingerprint')).toBe(LEAF_SHA256)
  })

  it('does not claim an order for a single certificate', async () => {
    const result = await run(selfSigned)
    expect(
      fields(result).some((row) => row.label === 'Chain order'),
    ).toBe(false)
  })
})

describe('a certificate request', () => {
  it('is recognised as a request and reports its subject and SAN', async () => {
    const result = await run(request)
    expect(result.ok).toBe(true)
    expect(value(result, 'Type')).toBe('certificate request (CSR)')
    expect(value(result, 'Subject')).toBe('CN=csr.tools.example, O=Tools Fixtures')
    expect(value(result, 'SANs')).toBe('DNS:csr.tools.example')
    expect(value(result, 'Key algorithm')).toBe('RSA')
    expect(value(result, 'Key size')).toBe('2048 bits')
  })

  it('reports no validity or serial, which a request does not carry', async () => {
    const labels = fields(await run(request)).map((row) => row.label)
    expect(labels).not.toContain('Not after')
    expect(labels).not.toContain('Days remaining')
    expect(labels).not.toContain('Serial')
    expect(labels).not.toContain('Issuer')
  })
})

describe('an authorized_keys line', () => {
  it('reports the key type, size and comment', async () => {
    const result = await run(authorizedKeys)
    expect(result.ok).toBe(true)
    expect(value(result, 'Key type')).toBe('ssh-ed25519')
    expect(value(result, 'Key size')).toBe('256 bits')
    expect(value(result, 'Comment')).toBe('tools@example')
  })

  it('reports both fingerprints ssh-keygen prints', async () => {
    const result = await run(authorizedKeys)
    expect(value(result, 'MD5 fingerprint')).toBe(SSH_MD5)
    expect(value(result, 'SHA256 fingerprint')).toBe(SSH_SHA256)
  })

  it('reads a line with no comment', async () => {
    const [type, body] = authorizedKeys.trim().split(/\s+/)
    const result = await run(`${type} ${body}`)
    expect(result.ok).toBe(true)
    expect(value(result, 'SHA256 fingerprint')).toBe(SSH_SHA256)
    expect(fields(result).some((row) => row.label === 'Comment')).toBe(false)
  })

  it('flags a line whose declared type is not the type in the blob', async () => {
    const [, body, comment] = authorizedKeys.trim().split(/\s+/)
    const row = field(
      await run(`ssh-rsa ${body} ${comment}`),
      'Type mismatch',
    )
    expect(row.warn).toBe(true)
    expect(row.value).toContain('ssh-ed25519')
  })
})

describe('bad input', () => {
  it('returns an empty result for an empty pane', async () => {
    const result = await run('   ')
    expect(result).toEqual({ ok: true, output: '' })
  })

  it('reports text that is neither PEM nor an SSH key', async () => {
    const result = await run('the quick brown fox')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('no PEM block')
  })

  it('reports a PEM block whose contents are not DER', async () => {
    const result = await run(
      '-----BEGIN CERTIFICATE-----\naGVsbG8=\n-----END CERTIFICATE-----',
    )
    expect(result.ok).toBe(false)
    expect(result.error).not.toBe('')
  })

  it('reports a truncated certificate rather than throwing', async () => {
    const lines = selfSigned.trim().split('\n')
    const truncated = [...lines.slice(0, 6), lines[lines.length - 1]].join('\n')
    const result = await run(truncated)
    expect(result.ok).toBe(false)
    expect(result.error).not.toBe('')
  })

  it('reports a PEM block it does not read rather than ignoring it', async () => {
    const result = await run(
      '-----BEGIN RSA PRIVATE KEY-----\naGVsbG8=\n-----END RSA PRIVATE KEY-----',
    )
    expect(result.ok).toBe(false)
    expect(result.error).toContain('RSA PRIVATE KEY')
  })
})

describe('cert.detect', () => {
  it('is confident about anything carrying a PEM armour header', () => {
    expect(cert.detect(selfSigned)).toBeGreaterThan(0.9)
    expect(cert.detect(chain)).toBeGreaterThan(0.9)
    expect(cert.detect(request)).toBeGreaterThan(0.9)
  })

  it('recognises an authorized_keys line less strongly', () => {
    const score = cert.detect(authorizedKeys)
    expect(score).toBeGreaterThan(0.5)
    expect(score).toBeLessThan(cert.detect(selfSigned))
  })

  it('claims nothing about plain text', () => {
    expect(cert.detect('the quick brown fox')).toBe(0)
    expect(cert.detect('')).toBe(0)
    expect(cert.detect('1735689600')).toBe(0)
  })
})
