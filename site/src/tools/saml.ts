/*
 * SAML decoder and assertion inspector: paste a `SAMLResponse` or
 * `SAMLRequest` value — the base64 blob out of a POST form field, or the
 * base64-of-DEFLATE one out of a redirect URL — and read the document it
 * carries, pretty-printed, with the handful of fields that decide whether an
 * assertion would be accepted pulled out beside it.
 *
 * ## What this tool does not do
 *
 * It does not verify the signature. It reports whether a `Signature` element
 * is *present*, which is a statement about the document's shape and nothing
 * more: an assertion can carry a perfectly well-formed `Signature` that was
 * computed over different bytes, signed by a key the service provider does
 * not trust, or stripped and re-added by whoever is holding the token. That
 * distinction is the difference between "this looks signed" and "this is
 * authentic", and conflating the two is how signature-stripping and XML
 * signature wrapping bugs get shipped, so the disclaimer rides along on every
 * successful run as a field rather than living in a README nobody opens.
 *
 * ## Why the XML is parsed here rather than by the browser
 *
 * `DOMParser` would parse this document, but it comes with the entity
 * machinery of a general XML processor attached, and a SAML blob is
 * attacker-supplied by construction — it arrives from an identity provider
 * through the user's browser. The reader of this page is precisely the person
 * who pastes in a hostile one to see what it does. So the parser below reads
 * exactly the subset a SAML document needs: elements, attributes, text,
 * CDATA, comments, and the five predefined entities. A `DOCTYPE` is skipped
 * without being interpreted, so no entity it declares is ever expanded and no
 * external reference is ever followed. Nothing here fetches anything.
 *
 * Element lookup is by namespace URI, never by prefix: the same assertion is
 * written `<saml:Assertion>`, `<saml2:Assertion>` or `<Assertion>` by
 * different identity providers, and a parser that matched `saml2:` would
 * silently report an empty document for two thirds of the world.
 */

import type { Tool, ToolField, ToolOptions, ToolResult } from './types.ts'
import { InflateLimitError, inflateRaw } from './vendor/inflate.ts'

/** The SAML 2.0 assertion namespace — `Issuer`, `NameID`, `Conditions`,
 * `Audience` all live here, whatever prefix a producer binds to it. */
export const SAML_ASSERTION_NS = 'urn:oasis:names:tc:SAML:2.0:assertion'

/** The SAML 2.0 protocol namespace: `Response`, `AuthnRequest`, `Status`. */
export const SAML_PROTOCOL_NS = 'urn:oasis:names:tc:SAML:2.0:protocol'

/** SAML 1.1, still emitted by older identity providers. Its subject element
 * is `NameIdentifier` rather than `NameID`, which is why both names are
 * looked for. */
export const SAML1_ASSERTION_NS = 'urn:oasis:names:tc:SAML:1.0:assertion'

/** XML Signature. Presence of an element from this namespace is the whole of
 * what the signature row reports. */
export const XMLDSIG_NS = 'http://www.w3.org/2000/09/xmldsig#'

/** Said on every successful run, as a field rather than a footnote. */
export const SIGNATURE_DISCLAIMER =
  'not performed — this tool only reports whether a Signature element exists. ' +
  'No digest is recomputed, no key is checked, nothing is fetched. A present ' +
  'signature is not a valid one.'

/** What the pane shows before anything has been pasted. */
const INSTRUCTIONS = [
  'Paste a SAMLResponse or SAMLRequest value.',
  '',
  'Both encodings are accepted: plain base64 (the HTTP-POST binding, out of a',
  'form field) and base64-of-DEFLATE (the HTTP-Redirect binding, out of a',
  'query parameter).',
  '',
  'Signatures are never validated. The tool reports whether a Signature',
  'element is present, which says nothing about whether it verifies.',
  '',
  'Everything runs in this tab. Nothing is uploaded.',
].join('\n')

/** Anything this module refuses to decode. Thrown internally, turned into a
 * `ToolResult` with `ok: false` by `run` — the tool never throws at its
 * caller, because every input it sees is by definition untrusted. */
class SamlError extends Error {}

/* ------------------------------------------------------------------ *
 * Decoding the transport layer
 * ------------------------------------------------------------------ */

/** Which of the two bindings' encodings the input turned out to be. */
export type SamlEncoding = 'base64' | 'base64+deflate'

/** The bytes a `SAMLResponse` parameter carried, and how they were wrapped. */
export interface DecodedPayload {
  xml: string
  encoding: SamlEncoding
}

/** Everything either base64 alphabet may contain, plus the whitespace a
 * pasted form field or a wrapped log line brings with it. */
const BASE64_CHARS = /^[A-Za-z0-9+/\-_=\s]+$/

const utf8Decoder = new TextDecoder('utf-8')

/** Base64 to bytes, tolerant of the ways a real paste differs from the spec:
 * whitespace anywhere, the url-safe alphabet (a redirect binding's parameter
 * has been through a URL), and missing padding. */
function base64ToBytes(input: string): Uint8Array {
  const compact = input.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/')
  const padded = compact.padEnd(Math.ceil(compact.length / 4) * 4, '=')
  try {
    return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0))
  } catch {
    throw new SamlError('the input is not valid base64')
  }
}

/**
 * The largest document this tool will inflate a redirect-binding payload
 * into, in bytes.
 *
 * It exists because `detect` runs on every paste the landing page sees, for
 * every tool, and this is the only detector in the registry that decompresses
 * — so it is the only one whose cost is not bounded by the length of the
 * paste. Raw DEFLATE reaches about 1032:1, which turns a few hundred
 * kilobytes of base64 into gigabytes of allocation and seconds of blocked
 * main thread: a frozen or killed tab, from a blob that need not resemble
 * SAML at all. With a cap, the work any paste can ask for is bounded by a
 * constant whether or not it turns out to be SAML.
 *
 * 1 MiB is a couple of orders of magnitude above a real `Response` — a signed
 * assertion carrying a certificate chain is tens of kilobytes — so nothing a
 * reader is likely to hold in their clipboard reaches it, while the worst case
 * stays small enough to inflate between two keystrokes.
 */
export const MAX_INFLATED_BYTES = 1024 * 1024

/** Whether decoded bytes read as the start of an XML document: optional
 * whitespace or byte-order mark, then `<` — which covers a document that
 * opens with an XML declaration as much as one that opens with its root
 * element. */
function looksLikeXml(text: string): boolean {
  return /^[\s\uFEFF]*</.test(text)
}

/**
 * Turns a pasted `SAMLResponse`/`SAMLRequest` value into the XML it encodes.
 *
 * The two bindings differ only in whether the document was DEFLATEd before
 * being base64-encoded (SAMLBind 2.0 §3.4.4.1 and §3.5.4), and neither
 * encoding is self-describing, so both are tried: the base64 bytes are used
 * directly when they already read as XML, and inflated otherwise. Whichever
 * attempt produces something starting with `<` wins.
 *
 * The inflate is capped at `MAX_INFLATED_BYTES`: a DEFLATE stream chooses how
 * much output a given number of input bytes asks for, and this function runs
 * from `detect` on every paste the page sees, so the cap is what keeps the
 * cost of looking at a stranger's clipboard bounded. A stream that wants more
 * is refused by size, with its own message, rather than being confused with
 * bytes that are not a DEFLATE stream at all.
 *
 * Throws a `SamlError` — never a raw parser or inflate error — when the input
 * is not base64 at all, when the compressed bytes expand past the cap, or
 * when neither the decoded nor the inflated bytes look like a document.
 */
export function decodeSamlPayload(input: string): DecodedPayload {
  const trimmed = input.trim()
  if (trimmed === '') throw new SamlError('nothing to decode')
  if (!BASE64_CHARS.test(trimmed)) {
    throw new SamlError(
      'the input is not base64 — a SAMLResponse or SAMLRequest value is base64, optionally DEFLATEd first',
    )
  }

  const bytes = base64ToBytes(trimmed)

  const direct = utf8Decoder.decode(bytes)
  if (looksLikeXml(direct)) return { xml: direct, encoding: 'base64' }

  try {
    const inflated = utf8Decoder.decode(inflateRaw(bytes, { limit: MAX_INFLATED_BYTES }))
    if (looksLikeXml(inflated)) return { xml: inflated, encoding: 'base64+deflate' }
  } catch (error) {
    if (error instanceof InflateLimitError) {
      // Reported rather than swallowed: the stream decoded fine, it just
      // wanted more room than any SAML document needs, and someone holding a
      // genuinely enormous payload deserves to be told which limit stopped it
      // instead of being told their bytes are not a DEFLATE stream.
      throw new SamlError(
        `the DEFLATE stream expands past the ${MAX_INFLATED_BYTES}-byte limit this tool inflates ` +
          '— a SAML document is not this large, and decompressing further would hang the page',
      )
    }
    // Anything else falls through to the shared error below: that the bytes
    // are not a raw DEFLATE stream either is one more reason they are not a
    // SAML document, not a separate failure worth its own message.
  }

  throw new SamlError(
    'the base64 decoded, but the bytes are neither XML nor a DEFLATE stream that inflates to XML',
  )
}

/* ------------------------------------------------------------------ *
 * A small, deliberately incurious XML parser
 * ------------------------------------------------------------------ */

export interface XmlAttribute {
  /** The attribute as written, prefix included. */
  name: string
  value: string
}

export interface XmlElement {
  kind: 'element'
  /** The qualified name as written — kept so the pretty printer reproduces
   * the document's own prefixes rather than inventing new ones. */
  name: string
  localName: string
  /** The namespace the element's prefix (or the default declaration) was
   * bound to at this point in the document, or `null` when unbound. */
  namespaceUri: string | null
  attributes: XmlAttribute[]
  children: XmlNode[]
}

export interface XmlText {
  kind: 'text'
  text: string
}

export interface XmlComment {
  kind: 'comment'
  text: string
}

export type XmlNode = XmlElement | XmlText | XmlComment

export interface XmlDocument {
  /** The XML declaration as written, or `null` when the document has none. */
  declaration: string | null
  root: XmlElement
}

/** The five entities XML predefines. No others are expanded, and no `DOCTYPE`
 * is interpreted, so a document cannot declare its own. */
const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
}

/** Resolves character and predefined entity references in text and attribute
 * values. An unrecognised reference is left exactly as written: a decoder
 * that quietly dropped `&sessionId;` would be lying about the document. */
function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, reference: string) => {
    if (reference.startsWith('#x') || reference.startsWith('#X')) {
      const code = Number.parseInt(reference.slice(2), 16)
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole
    }
    if (reference.startsWith('#')) {
      const code = Number.parseInt(reference.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole
    }
    return ENTITIES[reference] ?? whole
  })
}

/** A name as XML allows one: no exhaustive Unicode production, just enough to
 * separate a name from the punctuation around it. Element and attribute names
 * in a SAML document are ASCII in practice, and a name outside this set stops
 * the parse rather than being read as something else. */
const NAME_CHARS = /[A-Za-z0-9_.:-]/

/** One prefix-to-namespace scope, chained to its parent element's. `''` is
 * the default namespace's key, which is how an unprefixed element gets one. */
type NamespaceScope = Readonly<Record<string, string>>

const ROOT_SCOPE: NamespaceScope = { xml: 'http://www.w3.org/XML/1998/namespace' }

/** The scope an element's children see: its parent's, plus whatever `xmlns`
 * declarations the element itself carries. */
function extendScope(parent: NamespaceScope, attributes: XmlAttribute[]): NamespaceScope {
  let scope = parent
  for (const attribute of attributes) {
    if (attribute.name === 'xmlns') {
      scope = { ...scope, '': attribute.value }
    } else if (attribute.name.startsWith('xmlns:')) {
      scope = { ...scope, [attribute.name.slice(6)]: attribute.value }
    }
  }
  return scope
}

function resolveNamespace(name: string, scope: NamespaceScope): string | null {
  const colon = name.indexOf(':')
  const prefix = colon === -1 ? '' : name.slice(0, colon)
  return scope[prefix] ?? null
}

const localNameOf = (name: string): string => name.slice(name.indexOf(':') + 1)

/**
 * Parses an XML document into elements, text and comments.
 *
 * Deliberately narrow: no `DOCTYPE` interpretation, no entity declarations,
 * no external references, no validation against a schema. Anything it cannot
 * read — an unclosed tag, a mismatched end tag, an unterminated comment — is
 * a `SamlError`, because a half-parsed security token is worse than none.
 */
export function parseXml(source: string): XmlDocument {
  let at = 0
  const text = source.replace(/^\uFEFF/, '')

  const startsWith = (token: string): boolean => text.startsWith(token, at)

  const skipWhitespace = (): void => {
    while (at < text.length && /\s/.test(text[at])) at += 1
  }

  const readName = (): string => {
    const start = at
    while (at < text.length && NAME_CHARS.test(text[at])) at += 1
    if (at === start) throw new SamlError(`expected an element name at offset ${start}`)
    return text.slice(start, at)
  }

  const readUntil = (token: string, what: string): string => {
    const end = text.indexOf(token, at)
    if (end === -1) throw new SamlError(`unterminated ${what}`)
    const content = text.slice(at, end)
    at = end + token.length
    return content
  }

  const readAttributes = (): XmlAttribute[] => {
    const attributes: XmlAttribute[] = []
    for (;;) {
      skipWhitespace()
      if (at >= text.length) throw new SamlError('unterminated start tag')
      if (startsWith('>') || startsWith('/>')) return attributes

      const name = readName()
      skipWhitespace()
      if (!startsWith('=')) throw new SamlError(`attribute ${name} has no value`)
      at += 1
      skipWhitespace()
      const quote = text[at]
      if (quote !== '"' && quote !== "'") {
        throw new SamlError(`attribute ${name} is not quoted`)
      }
      at += 1
      attributes.push({ name, value: decodeEntities(readUntil(quote, `attribute ${name}`)) })
    }
  }

  /** Skips a `<!DOCTYPE …>` declaration, including an internal subset, without
   * reading a single thing out of it. Entity declarations inside are the
   * whole XXE/billion-laughs family, and the only safe way to read one is not
   * to. */
  const skipDoctype = (): void => {
    let depth = 0
    while (at < text.length) {
      const character = text[at]
      at += 1
      if (character === '[') depth += 1
      else if (character === ']') depth -= 1
      else if (character === '>' && depth <= 0) return
    }
    throw new SamlError('unterminated DOCTYPE declaration')
  }

  /** Reads one element, having already consumed its `<`. */
  const readElement = (scope: NamespaceScope): XmlElement => {
    const name = readName()
    const attributes = readAttributes()
    const childScope = extendScope(scope, attributes)
    const element: XmlElement = {
      kind: 'element',
      name,
      localName: localNameOf(name),
      namespaceUri: resolveNamespace(name, childScope),
      attributes,
      children: [],
    }

    if (startsWith('/>')) {
      at += 2
      return element
    }
    at += 1 // the '>'

    for (;;) {
      if (at >= text.length) throw new SamlError(`unclosed element <${name}>`)

      if (startsWith('</')) {
        at += 2
        const closing = readName()
        skipWhitespace()
        if (!startsWith('>')) throw new SamlError(`malformed end tag </${closing}>`)
        at += 1
        if (closing !== name) {
          throw new SamlError(`end tag </${closing}> does not match <${name}>`)
        }
        return element
      }

      if (startsWith('<!--')) {
        at += 4
        element.children.push({ kind: 'comment', text: readUntil('-->', 'comment') })
        continue
      }
      if (startsWith('<![CDATA[')) {
        at += 9
        element.children.push({ kind: 'text', text: readUntil(']]>', 'CDATA section') })
        continue
      }
      if (startsWith('<?')) {
        at += 2
        readUntil('?>', 'processing instruction')
        continue
      }
      if (startsWith('<!')) {
        at += 2
        skipDoctype()
        continue
      }
      if (startsWith('<')) {
        at += 1
        element.children.push(readElement(childScope))
        continue
      }

      const next = text.indexOf('<', at)
      const chunk = text.slice(at, next === -1 ? text.length : next)
      at += chunk.length
      element.children.push({ kind: 'text', text: decodeEntities(chunk) })
    }
  }

  let declaration: string | null = null
  for (;;) {
    skipWhitespace()
    if (at >= text.length) throw new SamlError('the document has no root element')

    if (startsWith('<?')) {
      const start = at
      at += 2
      const body = readUntil('?>', 'processing instruction')
      if (/^xml\s/i.test(body)) declaration = text.slice(start, at)
      continue
    }
    if (startsWith('<!--')) {
      at += 4
      readUntil('-->', 'comment')
      continue
    }
    if (startsWith('<!')) {
      at += 2
      skipDoctype()
      continue
    }
    if (startsWith('</') || !startsWith('<')) {
      throw new SamlError('the document does not start with an element')
    }

    at += 1
    return { declaration, root: readElement(ROOT_SCOPE) }
  }
}

/* ------------------------------------------------------------------ *
 * Pretty printing
 * ------------------------------------------------------------------ */

const INDENT = '  '

const escapeText = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const escapeAttribute = (value: string): string => escapeText(value).replace(/"/g, '&quot;')

const isBlankText = (node: XmlNode): boolean => node.kind === 'text' && node.text.trim() === ''

function startTag(element: XmlElement): string {
  const attributes = element.attributes
    .map((attribute) => ` ${attribute.name}="${escapeAttribute(attribute.value)}"`)
    .join('')
  return `<${element.name}${attributes}`
}

/**
 * Renders one element and everything under it, indented by `depth`.
 *
 * Whitespace-only text between elements is dropped — it is the producer's own
 * formatting (usually none at all, since a SAML document travels as one long
 * line) and reproducing it would defeat the point of pretty printing. Text
 * with content is kept, trimmed, and an element holding nothing but text
 * stays on one line, which is what makes `<saml2:Issuer>https://…</saml2:Issuer>`
 * readable rather than three lines of scaffolding.
 *
 * Reformatting is not canonicalisation: the output is for a human to read,
 * and the bytes a signature was computed over are the input's, not these.
 */
function printElement(element: XmlElement, depth: number): string[] {
  const pad = INDENT.repeat(depth)
  const children = element.children.filter((child) => !isBlankText(child))

  if (children.length === 0) {
    return [`${pad}${startTag(element)}/>`]
  }

  if (children.length === 1 && children[0].kind === 'text') {
    return [`${pad}${startTag(element)}>${escapeText(children[0].text.trim())}</${element.name}>`]
  }

  const lines = [`${pad}${startTag(element)}>`]
  for (const child of children) {
    if (child.kind === 'element') {
      lines.push(...printElement(child, depth + 1))
    } else if (child.kind === 'comment') {
      lines.push(`${pad}${INDENT}<!--${child.text}-->`)
    } else {
      lines.push(`${pad}${INDENT}${escapeText(child.text.trim())}`)
    }
  }
  lines.push(`${pad}</${element.name}>`)
  return lines
}

/** A parsed document as indented text, declaration first when it had one. */
export function printXml(document: XmlDocument): string {
  const lines = document.declaration === null ? [] : [document.declaration]
  lines.push(...printElement(document.root, 0))
  return lines.join('\n')
}

/** Parse-and-print, for callers that only want the formatting. */
export function formatXml(source: string): string {
  return printXml(parseXml(source))
}

/* ------------------------------------------------------------------ *
 * Reading the assertion
 * ------------------------------------------------------------------ */

/** Every element in document order, depth first — the order a reader scans
 * the document in, so "the first `Issuer`" means the outermost one. */
function* walk(element: XmlElement): Generator<XmlElement> {
  yield element
  for (const child of element.children) {
    if (child.kind === 'element') yield* walk(child)
  }
}

/** The first element matching a local name in one of the SAML assertion
 * namespaces (2.0 or 1.1). Namespace-matched rather than prefix-matched, so
 * `saml:`, `saml2:` and an unprefixed default declaration all resolve. An
 * element in no namespace at all matches too: documents written by hand — and
 * by test fixtures — routinely omit the declaration, and refusing to read
 * them helps nobody. */
function findAll(
  root: XmlElement,
  localNames: readonly string[],
  namespaces: readonly string[],
): XmlElement[] {
  return [...walk(root)].filter(
    (element) =>
      localNames.includes(element.localName) &&
      (element.namespaceUri === null || namespaces.includes(element.namespaceUri)),
  )
}

function findFirst(
  root: XmlElement,
  localNames: readonly string[],
  namespaces: readonly string[],
): XmlElement | undefined {
  return findAll(root, localNames, namespaces)[0]
}

/** An element's text, with descendant text included and whitespace collapsed:
 * an `<Audience>` split across lines by a formatter is still one URI. */
function textOf(element: XmlElement): string {
  const parts: string[] = []
  for (const node of element.children) {
    if (node.kind === 'text') parts.push(node.text)
    else if (node.kind === 'element') parts.push(textOf(node))
  }
  return parts.join('').replace(/\s+/g, ' ').trim()
}

const ASSERTION_NAMESPACES = [SAML_ASSERTION_NS, SAML1_ASSERTION_NS]

/** What the inspector could read out of a document. Every field is optional
 * because every one of them is: an `AuthnRequest` has an `Issuer` and no
 * `Conditions`, an assertion may carry no audience restriction, and a
 * document that is missing something is a finding rather than an error. */
export interface SamlInspection {
  issuer: string | null
  nameId: string | null
  nameIdFormat: string | null
  notBefore: string | null
  notOnOrAfter: string | null
  audiences: string[]
  /** Whether a `Signature` element exists. Says nothing about validity. */
  signaturePresent: boolean
  /** `NotBefore` is in the future relative to the clock it was inspected at. */
  notYetValid: boolean
  /** `NotOnOrAfter` has passed relative to that same clock. */
  expired: boolean
}

/** An ISO 8601 instant as milliseconds, or `null` when the attribute is
 * missing or not a date — an unparseable value is reported as-is rather than
 * being silently treated as expired. */
function instant(value: string | null): number | null {
  if (value === null) return null
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

function attributeOf(element: XmlElement | undefined, name: string): string | null {
  return element?.attributes.find((attribute) => attribute.name === name)?.value ?? null
}

/**
 * Reads the fields that decide whether a service provider would accept an
 * assertion: who issued it, who it is about, when it is valid and who it is
 * for — plus whether it carries a signature at all.
 *
 * `now` is passed in rather than read from the clock so the time-window
 * verdict is a pure function of its inputs, which is the only way to test the
 * expiry warning without either faking the environment or writing an
 * assertion that starts failing on a particular Tuesday.
 *
 * The validity window comes from `Conditions`, not from the bearer
 * `SubjectConfirmationData`'s own `NotOnOrAfter`: they are usually minutes
 * apart, and `Conditions` is the one that bounds the assertion itself.
 */
export function inspectSaml(document: XmlDocument, now: number): SamlInspection {
  const { root } = document

  const issuer = findFirst(root, ['Issuer'], ASSERTION_NAMESPACES)
  const nameId = findFirst(root, ['NameID', 'NameIdentifier'], ASSERTION_NAMESPACES)
  const conditions = findFirst(root, ['Conditions'], ASSERTION_NAMESPACES)

  const notBefore = attributeOf(conditions, 'NotBefore')
  const notOnOrAfter = attributeOf(conditions, 'NotOnOrAfter')
  const notBeforeAt = instant(notBefore)
  const notOnOrAfterAt = instant(notOnOrAfter)

  const audiences = findAll(root, ['Audience'], ASSERTION_NAMESPACES)
    .map((element) => textOf(element))
    .filter((audience) => audience !== '')

  const signaturePresent = [...walk(root)].some(
    (element) =>
      element.localName === 'Signature' &&
      (element.namespaceUri === null || element.namespaceUri === XMLDSIG_NS),
  )

  return {
    issuer: issuer === undefined ? null : textOf(issuer),
    nameId: nameId === undefined ? null : textOf(nameId),
    nameIdFormat: attributeOf(nameId, 'Format'),
    notBefore,
    notOnOrAfter,
    audiences,
    signaturePresent,
    notYetValid: notBeforeAt !== null && now < notBeforeAt,
    expired: notOnOrAfterAt !== null && now >= notOnOrAfterAt,
  }
}

const MISSING = '(not present)'

const ENCODING_LABELS: Record<SamlEncoding, string> = {
  base64: 'base64 (HTTP-POST binding)',
  'base64+deflate': 'base64 of DEFLATE (HTTP-Redirect binding)',
}

/**
 * The inspection as the pane's rows.
 *
 * The signature rows are two, not one, and always both present: `Signature
 * present` answers a question about the document, and `Signature validation`
 * exists so that answer is never read as a verdict. Neither row is omitted
 * when a signature is absent — "no signature, and none was checked" is the
 * state someone most needs told plainly.
 */
export function samlFields(
  inspection: SamlInspection,
  encoding: SamlEncoding,
): ToolField[] {
  const window = (value: string | null, flagged: boolean, note: string): ToolField => ({
    label: '',
    value: value === null ? MISSING : flagged ? `${value} — ${note}` : value,
    warn: flagged,
  })

  const notBefore = window(inspection.notBefore, inspection.notYetValid, 'not valid yet')
  const notOnOrAfter = window(inspection.notOnOrAfter, inspection.expired, 'expired')

  const fields: ToolField[] = [
    { label: 'Encoding', value: ENCODING_LABELS[encoding] },
    { label: 'Issuer', value: inspection.issuer ?? MISSING, warn: inspection.issuer === null },
    { label: 'NameID', value: inspection.nameId ?? MISSING },
  ]

  if (inspection.nameIdFormat !== null) {
    fields.push({ label: 'NameID Format', value: inspection.nameIdFormat })
  }

  fields.push(
    { ...notBefore, label: 'NotBefore' },
    { ...notOnOrAfter, label: 'NotOnOrAfter' },
    {
      label: 'AudienceRestriction',
      value: inspection.audiences.length === 0 ? MISSING : inspection.audiences.join(', '),
    },
    { label: 'Signature present', value: inspection.signaturePresent ? 'yes' : 'no' },
    { label: 'Signature validation', value: SIGNATURE_DISCLAIMER },
  )

  return fields
}

/* ------------------------------------------------------------------ *
 * The tool
 * ------------------------------------------------------------------ */

/** The document types this tool is for, as the root element's local name.
 * Matched against a decoded document, never against the raw paste. */
const SAML_ROOTS = ['Response', 'AuthnRequest', 'LogoutRequest', 'LogoutResponse', 'Assertion']

/**
 * How confident we are that `input` is a SAML blob.
 *
 * Both bindings' encodings are decoded, because that is the only honest test:
 * base64 and base64-of-DEFLATE are indistinguishable by eye, and the base64
 * tool caps itself at 0.7 precisely so a tool that can prove what the bytes
 * are gets to outrank it.
 *
 * 0.95 — the score this page reserves for an unmistakable format — when the
 * decoded document opens with a `<saml…` tag or declares a SAML namespace on
 * a root element SAML actually defines. Anything else is zero: a decoder that
 * guessed from a scattered substring would take magic paste's landing state
 * away from whichever tool really owns the paste.
 */
export function detect(input: string): number {
  let xml: string
  try {
    xml = decodeSamlPayload(input).xml
  } catch {
    return 0
  }

  const body = xml.replace(/^[\s\uFEFF]*(?:<\?[^?]*\?>\s*)?/, '')
  if (/^<saml/i.test(body)) return 0.95

  try {
    const { root } = parseXml(xml)
    const namespace = root.namespaceUri
    if (
      SAML_ROOTS.includes(root.localName) &&
      (namespace === SAML_PROTOCOL_NS ||
        namespace === SAML_ASSERTION_NS ||
        namespace === SAML1_ASSERTION_NS)
    ) {
      return 0.95
    }
  } catch {
    return 0
  }

  return 0
}

function run(input: string, _options: ToolOptions): ToolResult {
  if (input.trim() === '') return { ok: true, output: INSTRUCTIONS }

  try {
    const { xml, encoding } = decodeSamlPayload(input)
    const document = parseXml(xml)
    return {
      ok: true,
      output: printXml(document),
      fields: samlFields(inspectSaml(document, Date.now()), encoding),
    }
  } catch (error) {
    return {
      ok: false,
      output: '',
      error: error instanceof SamlError ? error.message : 'the input could not be decoded as SAML',
    }
  }
}

export const saml = {
  id: 'saml',
  name: 'SAML',
  detect,
  run,
} satisfies Tool
