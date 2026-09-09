/*
 * Digests of whatever is in the pane: MD5, SHA-1, SHA-256 and SHA-512 at
 * once, and HMAC under the same hashes when a key is supplied.
 *
 * All four at once rather than behind a selector, because the reason to open
 * this tool is almost always to compare against a digest someone else printed
 * — a checksum under a download, a fingerprint in a console — and the reader
 * usually does not know which algorithm produced it until they see which row
 * matches. The weak ones are here for that reason alone; nothing on this page
 * suggests MD5 or SHA-1 is a sound choice for anything new.
 *
 * SHA comes from `crypto.subtle`, MD5 from the vendored implementation next
 * door, since Web Crypto declines to provide it. Both operate on bytes, so
 * text is UTF-8 encoded once and every row hashes exactly the same input —
 * which is also what lets `runFile` reuse the whole path for a dropped file.
 *
 * The HMAC key is `secret: true`: it is a shared secret, and the fragment is a
 * link people paste into chat. It never reaches the URL.
 *
 * No `detect`. Any text at all is hashable, so a confidence score here would
 * be a claim about nothing and would outrank tools that actually recognised
 * their input.
 */

import type {
  Tool,
  ToolField,
  ToolOption,
  ToolOptions,
  ToolResult,
} from './types.ts'
import { md5 } from './vendor/md5.ts'

const options: readonly ToolOption[] = [
  {
    key: 'hmacKey',
    label: 'HMAC key',
    kind: 'text',
    default: '',
    placeholder: 'optional — never written to the URL',
    secret: true,
  },
]

const utf8 = new TextEncoder()

/** The SHA family Web Crypto offers, in the order the rows are shown. */
const SHA_ALGORITHMS = ['SHA-1', 'SHA-256', 'SHA-512'] as const

/** SHA-384 is deliberately absent from both lists: four digest rows and three
 * HMAC rows is already a wall of hex, and nothing in the wild prints an
 * HMAC-SHA-384 that these rows would be compared against. */
const HMAC_ALGORITHMS = ['SHA-1', 'SHA-256', 'SHA-512'] as const

/* Web Crypto takes a `BufferSource`, which rules out an array backed by a
 * `SharedArrayBuffer`; spelling the backing buffer out keeps that check at the
 * signatures rather than at every call. Both callers below build their bytes
 * from a plain buffer anyway. */
type Bytes = Uint8Array<ArrayBuffer>

const toHex = (digest: ArrayBuffer): string =>
  Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')

async function digestRows(bytes: Bytes): Promise<ToolField[]> {
  const shas = await Promise.all(
    SHA_ALGORITHMS.map(async (algorithm) => ({
      label: algorithm,
      value: toHex(await crypto.subtle.digest(algorithm, bytes)),
    })),
  )
  return [{ label: 'MD5', value: md5(bytes) }, ...shas]
}

async function hmacRows(bytes: Bytes, key: string): Promise<ToolField[]> {
  const keyBytes = utf8.encode(key)
  return Promise.all(
    HMAC_ALGORITHMS.map(async (algorithm) => {
      const cryptoKey = await crypto.subtle.importKey(
        'raw',
        keyBytes,
        { name: 'HMAC', hash: algorithm },
        false,
        ['sign'],
      )
      return {
        label: `HMAC-${algorithm}`,
        value: toHex(await crypto.subtle.sign('HMAC', cryptoKey, bytes)),
      }
    }),
  )
}

/** The `<pre>` view: the same rows the table shows, laid out so the digests
 * start in one column and a mismatch against a pasted value is visible at a
 * glance rather than character by character. */
function asText(fields: ToolField[]): string {
  const width = Math.max(...fields.map((field) => field.label.length))
  return fields
    .map((field) => `${field.label.padEnd(width)}  ${field.value}`)
    .join('\n')
}

/** Digest every algorithm over one byte string, plus any extra rows the
 * caller wants above them — the one path both text and files run through. */
async function hashBytes(
  bytes: Bytes,
  toolOptions: ToolOptions,
  leadingFields: ToolField[] = [],
): Promise<ToolResult> {
  const digests = await digestRows(bytes)
  const key = toolOptions.hmacKey ?? ''
  const macs = key === '' ? [] : await hmacRows(bytes, key)
  const fields = [...leadingFields, ...digests, ...macs]
  return { ok: true, output: asText([...digests, ...macs]), fields }
}

async function run(
  input: string,
  toolOptions: ToolOptions,
): Promise<ToolResult> {
  // Empty in, empty out, as every other tool on the page does. The digest of
  // the empty string is a real value, but showing it on an untouched pane
  // reads as output the reader did not ask for.
  if (input === '') return { ok: true, output: '' }
  const bytes = utf8.encode(input)
  return hashBytes(bytes, toolOptions, [
    { label: 'Input', value: `${bytes.length} bytes` },
  ])
}

/** A file dropped on the pane. Read whole into memory — the digests need
 * every byte anyway, and a browser tab is not where anyone checksums a disk
 * image. HMAC is not offered here: the key lives in the options row, which a
 * drop does not carry. */
async function runFile(file: File): Promise<ToolResult> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  return hashBytes(bytes, {}, [
    { label: 'File', value: `${file.name} — ${bytes.length} bytes` },
  ])
}

export const hash = {
  id: 'hash',
  name: 'hash',
  options,
  run,
  runFile,
} satisfies Tool
