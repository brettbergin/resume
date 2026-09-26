import { deflateRawSync } from 'node:zlib'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { DETECTION_THRESHOLD } from './magic.ts'
import {
  decodeSamlPayload,
  detect,
  formatXml,
  inspectSaml,
  MAX_INFLATED_BYTES,
  parseXml,
  saml,
  SIGNATURE_DISCLAIMER,
} from './saml.ts'
import type { ToolField } from './types.ts'

/*
 * Anchored on a committed fixture rather than on strings built inside the
 * test: `test/fixtures/saml-response.xml` is a representative `saml2p:Response`
 * — protocol and assertion namespaces bound to different prefixes, an
 * `Issuer` at both levels, an enveloped `ds:Signature`, a `Subject`, a
 * `Conditions` window and an `AudienceRestriction`.
 *
 * Its `NotOnOrAfter` is 2015-06-01T12:05:00Z, deliberately and permanently in
 * the past: the expiry warning is then a property of the fixture rather than
 * of the day the suite runs, and the still-valid case is built against a
 * pinned clock instead, so neither direction can rot into the other.
 *
 * The signature in the fixture is not a real signature and is not meant to
 * be. The tool reports presence, never validity, and that is exactly what is
 * asserted here.
 *
 * The redirect-binding input is produced with node:zlib's `deflateRawSync`,
 * not with anything from this repository. A round trip through our own
 * inflater fed by our own deflater would prove only that two halves of the
 * same idea agree; compressing with the platform is what makes the decode a
 * real test of the vendored inflater in `vendor/inflate.ts`.
 */

const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), '../../test/fixtures')

const fixture = (name: string): string => readFileSync(resolve(fixtures, name), 'utf8')

const RESPONSE_XML = fixture('saml-response.xml')

/** The fixture as an HTTP-POST binding form field: plain base64. */
const postBinding = (xml: string): string => Buffer.from(xml, 'utf8').toString('base64')

/** The fixture as an HTTP-Redirect binding query parameter: raw DEFLATE (no
 * zlib header), then base64 (SAMLBind 2.0 §3.4.4.1). */
const redirectBinding = (xml: string): string =>
  deflateRawSync(Buffer.from(xml, 'utf8')).toString('base64')

/** The same document with its `ds:Signature` subtree removed — the shape a
 * signature-stripping attempt leaves behind. */
const UNSIGNED_XML = RESPONSE_XML.replace(
  /[ \t]*<ds:Signature[\s\S]*?<\/ds:Signature>\n/,
  '',
)

const field = (fields: ToolField[] | undefined, label: string): ToolField | undefined =>
  fields?.find((entry) => entry.label === label)

const valueOf = (fields: ToolField[] | undefined, label: string): string | undefined =>
  field(fields, label)?.value

/** A clock inside the fixture's own validity window would need the fixture to
 * be perpetually fresh, which is the thing it must not be — so the still-valid
 * case gets its own document, built around a pinned `now`. */
const NOW = Date.parse('2024-03-01T10:00:00Z')

const withWindow = (notBefore: string, notOnOrAfter: string): string =>
  RESPONSE_XML.replace(
    /NotBefore="[^"]*" NotOnOrAfter="[^"]*"/,
    `NotBefore="${notBefore}" NotOnOrAfter="${notOnOrAfter}"`,
  )

afterEach(() => {
  vi.useRealTimers()
})

describe('decodeSamlPayload', () => {
  it('decodes a plain base64 POST binding payload', () => {
    const decoded = decodeSamlPayload(postBinding(RESPONSE_XML))

    expect(decoded.encoding).toBe('base64')
    expect(decoded.xml).toBe(RESPONSE_XML)
  })

  it('inflates a base64-of-DEFLATE redirect binding payload', () => {
    const decoded = decodeSamlPayload(redirectBinding(RESPONSE_XML))

    expect(decoded.encoding).toBe('base64+deflate')
    expect(decoded.xml).toBe(RESPONSE_XML)
  })

  it('accepts the url-safe alphabet, missing padding and wrapped whitespace', () => {
    const wrapped = postBinding(RESPONSE_XML)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
      .replace(/(.{64})/g, '$1\n')

    expect(decodeSamlPayload(wrapped).xml).toBe(RESPONSE_XML)
  })

  it('rejects input that is not base64 at all', () => {
    expect(() => decodeSamlPayload('not a saml blob!')).toThrow(/not base64/)
  })

  it('rejects base64 that decodes to something that is neither XML nor DEFLATE', () => {
    expect(() => decodeSamlPayload(Buffer.from('hello there').toString('base64'))).toThrow(
      /neither XML nor a DEFLATE stream/,
    )
  })
})

/*
 * A decompression bomb dressed as an ordinary paste: a quarter of a gigabyte
 * of zeros, raw DEFLATEd by node:zlib and base64-encoded, which lands at a few
 * hundred kilobytes — an oversized clipboard, but not an implausible one.
 *
 * It is not SAML and does not pretend to be. That is the point: `detect` runs
 * over every paste the landing page sees, for every registered tool, so the
 * cost of *deciding this is not SAML* is paid by whoever pastes it, and this
 * is the only detector on the page that decompresses to find out.
 */
const BOMB_PLAINTEXT_BYTES = 256 * 1024 * 1024

const bomb = deflateRawSync(Buffer.alloc(BOMB_PLAINTEXT_BYTES)).toString('base64')

describe('decompression bombs', () => {
  it('is what it claims: a small paste that expands past the cap', () => {
    expect(bomb.length).toBeLessThan(BOMB_PLAINTEXT_BYTES / 100)
    expect(BOMB_PLAINTEXT_BYTES).toBeGreaterThan(MAX_INFLATED_BYTES)
  })

  it('is refused by size, with the limit named', () => {
    expect(() => decodeSamlPayload(bomb)).toThrow(
      new RegExp(`expands past the ${MAX_INFLATED_BYTES}-byte limit`),
    )
  })

  it('scores zero from detect without stalling the thread that called it', () => {
    // The call magic paste makes over every registered tool for every paste.
    // Uncapped it inflates all 256 MiB before it can answer "not SAML":
    // seconds of frozen tab and gigabytes of allocation for a score of 0. The
    // bound is loose on purpose — it separates "gave up early" from "decoded
    // the whole thing", it does not measure anything.
    const started = performance.now()

    expect(detect(bomb)).toBe(0)
    expect(performance.now() - started).toBeLessThan(1000)
  })

  it('tells the reader which limit stopped it rather than failing vaguely', () => {
    const result = saml.run(bomb, {})

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/expands past the/)
    expect(result.output).toBe('')
  })

  it('still decodes a redirect payload that is large but under the cap', () => {
    // The neighbour of the case above: the cap is two orders of magnitude
    // above a real assertion, so padding the fixture out to half a megabyte
    // still has to come back intact.
    const padded = RESPONSE_XML.replace(
      '</saml2p:Response>',
      `  <!--${'padding '.repeat(64 * 1024)}-->\n</saml2p:Response>`,
    )
    const decoded = decodeSamlPayload(redirectBinding(padded))

    expect(padded.length).toBeGreaterThan(MAX_INFLATED_BYTES / 4)
    expect(padded.length).toBeLessThan(MAX_INFLATED_BYTES)
    expect(decoded.encoding).toBe('base64+deflate')
    expect(decoded.xml).toBe(padded)
  })
})

describe('formatXml', () => {
  it('reproduces the fixture, which is already in the format it emits', () => {
    expect(formatXml(RESPONSE_XML)).toBe(RESPONSE_XML.trim())
  })

  it('indents a document that arrived as one line, the way a real one does', () => {
    const oneLine = RESPONSE_XML.replace(/>\s+</g, '><').trim()

    expect(formatXml(oneLine)).toBe(RESPONSE_XML.trim())
  })

  it('refuses a document whose tags do not nest', () => {
    expect(() => formatXml('<a><b></a></b>')).toThrow(/does not match/)
  })
})

describe('parseXml', () => {
  it('resolves elements by namespace rather than by prefix', () => {
    const { root } = parseXml(RESPONSE_XML)

    expect(root.localName).toBe('Response')
    expect(root.namespaceUri).toBe('urn:oasis:names:tc:SAML:2.0:protocol')
    expect(root.children.filter((child) => child.kind === 'element')[0]).toMatchObject({
      localName: 'Issuer',
      namespaceUri: 'urn:oasis:names:tc:SAML:2.0:assertion',
    })
  })

  it('reads the same fields from a document using different prefixes', () => {
    const renamed = RESPONSE_XML.replace(/saml2:/g, 'assert:').replace(
      /xmlns:saml2=/g,
      'xmlns:assert=',
    )

    expect(renamed).not.toContain('saml2:Assertion')
    expect(inspectSaml(parseXml(renamed), NOW).nameId).toBe('jane.doe@tools.example')
    expect(inspectSaml(parseXml(renamed), NOW).audiences).toEqual([
      'https://sp.tools.example/metadata',
    ])
  })

  it('ignores an element that only borrows a SAML local name', () => {
    const foreign =
      '<Response xmlns="urn:oasis:names:tc:SAML:2.0:protocol">' +
      '<Issuer xmlns="http://example.com/other">https://spoofed.example</Issuer>' +
      '</Response>'

    expect(inspectSaml(parseXml(foreign), NOW).issuer).toBeNull()
  })

  it('skips a DOCTYPE without expanding anything it declares', () => {
    const withDoctype =
      '<!DOCTYPE Response [<!ENTITY xxe "PWNED">]>\n<Response><Issuer>&xxe;</Issuer></Response>'
    const { root } = parseXml(withDoctype)

    expect(root.localName).toBe('Response')
    expect(inspectSaml({ declaration: null, root }, NOW).issuer).toBe('&xxe;')
  })
})

describe('inspectSaml', () => {
  it('extracts the fixture fields', () => {
    const inspection = inspectSaml(parseXml(RESPONSE_XML), NOW)

    expect(inspection).toMatchObject({
      issuer: 'https://idp.tools.example/metadata',
      nameId: 'jane.doe@tools.example',
      nameIdFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
      notBefore: '2015-06-01T11:59:00Z',
      notOnOrAfter: '2015-06-01T12:05:00Z',
      audiences: ['https://sp.tools.example/metadata'],
      signaturePresent: true,
    })
  })

  it('flags the fixture as expired and not as pending', () => {
    const inspection = inspectSaml(parseXml(RESPONSE_XML), NOW)

    expect(inspection.expired).toBe(true)
    expect(inspection.notYetValid).toBe(false)
  })

  it('flags neither when the clock sits inside the window', () => {
    const inside = withWindow('2024-03-01T09:59:00Z', '2024-03-01T10:05:00Z')
    const inspection = inspectSaml(parseXml(inside), NOW)

    expect(inspection.expired).toBe(false)
    expect(inspection.notYetValid).toBe(false)
  })

  it('flags an assertion whose window has not opened yet', () => {
    const later = withWindow('2024-03-01T10:01:00Z', '2024-03-01T10:06:00Z')
    const inspection = inspectSaml(parseXml(later), NOW)

    expect(inspection.notYetValid).toBe(true)
    expect(inspection.expired).toBe(false)
  })

  it('reports no signature once the Signature element is stripped', () => {
    expect(inspectSaml(parseXml(UNSIGNED_XML), NOW).signaturePresent).toBe(false)
    expect(UNSIGNED_XML).not.toContain('Signature')
  })
})

describe('saml.run', () => {
  it('pretty-prints and extracts from a POST binding paste', () => {
    const result = saml.run(postBinding(RESPONSE_XML), {})

    expect(result.ok).toBe(true)
    expect(result.output).toBe(RESPONSE_XML.trim())
    expect(valueOf(result.fields, 'Encoding')).toBe('base64 (HTTP-POST binding)')
    expect(valueOf(result.fields, 'Issuer')).toBe('https://idp.tools.example/metadata')
    expect(valueOf(result.fields, 'NameID')).toBe('jane.doe@tools.example')
    expect(valueOf(result.fields, 'AudienceRestriction')).toBe(
      'https://sp.tools.example/metadata',
    )
  })

  it('produces the same output from a redirect binding paste', () => {
    const post = saml.run(postBinding(RESPONSE_XML), {})
    const redirect = saml.run(redirectBinding(RESPONSE_XML), {})

    expect(redirect.ok).toBe(true)
    expect(redirect.output).toBe(post.output)
    expect(valueOf(redirect.fields, 'Encoding')).toBe(
      'base64 of DEFLATE (HTTP-Redirect binding)',
    )
  })

  it('warns on the fixture window, which is permanently in the past', () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)

    const result = saml.run(postBinding(RESPONSE_XML), {})

    expect(field(result.fields, 'NotOnOrAfter')).toMatchObject({
      value: '2015-06-01T12:05:00Z — expired',
      warn: true,
    })
    expect(field(result.fields, 'NotBefore')?.warn).toBe(false)
  })

  it('does not warn while the assertion is still inside its window', () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)

    const inside = withWindow('2024-03-01T09:59:00Z', '2024-03-01T10:05:00Z')
    const result = saml.run(postBinding(inside), {})

    expect(field(result.fields, 'NotBefore')?.warn).toBe(false)
    expect(field(result.fields, 'NotOnOrAfter')).toMatchObject({
      value: '2024-03-01T10:05:00Z',
      warn: false,
    })
  })

  it('warns when the window has not opened yet', () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)

    const later = withWindow('2024-03-01T10:01:00Z', '2024-03-01T10:06:00Z')
    const result = saml.run(postBinding(later), {})

    expect(field(result.fields, 'NotBefore')).toMatchObject({
      value: '2024-03-01T10:01:00Z — not valid yet',
      warn: true,
    })
  })

  it('reports a present signature without claiming it was checked', () => {
    const result = saml.run(postBinding(RESPONSE_XML), {})

    expect(valueOf(result.fields, 'Signature present')).toBe('yes')
    expect(valueOf(result.fields, 'Signature validation')).toBe(SIGNATURE_DISCLAIMER)
    expect(SIGNATURE_DISCLAIMER).toMatch(/not performed/)
  })

  it('reports an absent signature, and still says nothing was validated', () => {
    const result = saml.run(postBinding(UNSIGNED_XML), {})

    expect(valueOf(result.fields, 'Signature present')).toBe('no')
    expect(valueOf(result.fields, 'Signature validation')).toBe(SIGNATURE_DISCLAIMER)
  })

  it('says so, rather than throwing, when the input is malformed', () => {
    for (const input of [
      'not a saml blob!',
      Buffer.from('hello there').toString('base64'),
      postBinding('<saml2p:Response><saml2:Issuer></saml2p:Response>'),
    ]) {
      const result = saml.run(input, {})

      expect(result.ok).toBe(false)
      expect(result.error).toBeTruthy()
      expect(result.output).toBe('')
    }
  })

  it('explains itself on an empty input instead of erroring', () => {
    const result = saml.run('', {})

    expect(result.ok).toBe(true)
    expect(result.output).toMatch(/Signatures are never validated/)
  })
})

describe('saml.detect', () => {
  it('scores both supported encodings above the magic paste threshold', () => {
    expect(detect(postBinding(RESPONSE_XML))).toBeGreaterThan(DETECTION_THRESHOLD)
    expect(detect(redirectBinding(RESPONSE_XML))).toBeGreaterThan(DETECTION_THRESHOLD)
  })

  it('scores a SAML document that uses a default namespace declaration', () => {
    const unprefixed =
      '<Response xmlns="urn:oasis:names:tc:SAML:2.0:protocol" Version="2.0"><Status/></Response>'

    expect(detect(postBinding(unprefixed))).toBeGreaterThan(DETECTION_THRESHOLD)
  })

  it('scores unrelated input at zero', () => {
    for (const input of [
      '',
      'the quick brown fox',
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln',
      postBinding('<html><body>not saml</body></html>'),
      postBinding('{"iss":"https://idp.tools.example"}'),
      Buffer.from('hello there').toString('base64'),
    ]) {
      expect(detect(input)).toBe(0)
    }
  })
})
