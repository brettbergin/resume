import { describe, expect, it } from 'vitest'

import { hash } from './hash.ts'
import type { ToolField, ToolResult } from './types.ts'

/*
 * Every digest asserted here is a published one — RFC 1321 for MD5, the FIPS
 * 180 examples for SHA over 'abc', RFC 4231 test case 2 for HMAC — so the tool
 * is pinned to the standards rather than to whatever it happened to emit the
 * first time it ran. A hash tool whose tests were recorded from its own output
 * would confirm nothing: the entire use of the tool is comparing its rows
 * against a value printed somewhere else.
 */

const run = (input: string, options: Record<string, string> = {}) =>
  hash.run(input, options)

/** The digest rows, keyed by label — the order is asserted separately. */
function rowsOf(result: ToolResult): Record<string, string> {
  return Object.fromEntries(
    (result.fields ?? []).map((field: ToolField) => [field.label, field.value]),
  )
}

/** RFC 1321, appendix A.5, minus the empty string: an untouched pane shows
 * nothing, which is asserted on its own below. */
const RFC_1321_SUITE: readonly [input: string, digest: string][] = [
  ['a', '0cc175b9c0f1b6a831c399e269772661'],
  ['abc', '900150983cd24fb0d6963f7d28e17f72'],
  ['message digest', 'f96b697d7cb7938d525a2f31aaf161d0'],
  ['abcdefghijklmnopqrstuvwxyz', 'c3fcd3d76192e4007dfb496cca67e13b'],
  [
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
    'd174ab98d277d9f5a5611c2c9f419d9f',
  ],
  ['1234567890'.repeat(8), '57edf4a22be3c955ac49da2e2107b67a'],
]

/** FIPS 180-2 appendix examples, over the string 'abc'. */
const ABC = {
  MD5: '900150983cd24fb0d6963f7d28e17f72',
  'SHA-1': 'a9993e364706816aba3e25717850c26c9cd0d89d',
  'SHA-256':
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  'SHA-512':
    'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f',
}

/** RFC 4231 test case 2 — a short ASCII key, which is what this tool's key
 * field can express. */
const RFC_4231_CASE_2 = {
  key: 'Jefe',
  data: 'what do ya want for nothing?',
  'HMAC-SHA-1': 'effcdf6ae5eb2fa2d27416d5f184df9c259a7c79',
  'HMAC-SHA-256':
    '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
  'HMAC-SHA-512':
    '164b7a7bfcf819e2e395fbe73b56e0a387bd64222e831fd610270cd7ea2505549758bf75c05a994a6d034f65f8f0e6fdcaeab1a34d4a6b4b636e070a38bce737',
}

describe('hashing text', () => {
  it.each(RFC_1321_SUITE)('gives the RFC 1321 MD5 of %j', async (input, digest) => {
    expect(rowsOf(await run(input)).MD5).toBe(digest)
  })

  it('gives the published MD5, SHA-1, SHA-256 and SHA-512 of "abc"', async () => {
    expect(rowsOf(await run('abc'))).toMatchObject(ABC)
  })

  it('emits the four digests in a fixed order, strongest last', async () => {
    const result = await run('abc')
    expect(result.fields?.map((field) => field.label)).toEqual([
      'Input',
      'MD5',
      'SHA-1',
      'SHA-256',
      'SHA-512',
    ])
    expect(result.ok).toBe(true)
  })

  it('renders every digest as lowercase hex', async () => {
    const result = await run('The quick brown fox jumps over the lazy dog')
    for (const [label, value] of Object.entries(rowsOf(result))) {
      if (label === 'Input') continue
      expect(value, label).toMatch(/^[0-9a-f]+$/)
    }
  })

  it('hashes the UTF-8 bytes of non-ASCII text', async () => {
    // 'é' is two bytes, so a tool hashing UTF-16 code units would disagree.
    const result = await run('é')
    expect(rowsOf(result).Input).toBe('2 bytes')
    expect(rowsOf(result).MD5).toBe('66ddcd97cfdeabb2f6fb8a999b4bc76f')
    expect(rowsOf(result)['SHA-1']).toBe(
      'bf15be717ac1b080b4f1c456692825891ff5073d',
    )
  })

  it('shows the digests in the output pane as well as the field table', async () => {
    const result = await run('abc')
    expect(result.output).toContain(`SHA-256  ${ABC['SHA-256']}`)
    expect(result.output.split('\n')).toHaveLength(4)
  })

  it('leaves an untouched pane empty rather than digesting nothing', async () => {
    const result = await run('')
    expect(result).toEqual({ ok: true, output: '' })
  })
})

describe('the HMAC key option', () => {
  it('is declared as a secret so it never reaches the URL fragment', () => {
    const option = hash.options?.find((entry) => entry.key === 'hmacKey')
    expect(option).toMatchObject({ kind: 'text', default: '', secret: true })
  })

  it('adds no HMAC rows while the key is empty', async () => {
    const labels = (await run('abc')).fields?.map((field) => field.label) ?? []
    expect(labels.filter((label) => label.startsWith('HMAC'))).toEqual([])
  })

  it('matches RFC 4231 test case 2 under SHA-1, SHA-256 and SHA-512', async () => {
    const result = await run(RFC_4231_CASE_2.data, {
      hmacKey: RFC_4231_CASE_2.key,
    })
    expect(rowsOf(result)).toMatchObject({
      'HMAC-SHA-1': RFC_4231_CASE_2['HMAC-SHA-1'],
      'HMAC-SHA-256': RFC_4231_CASE_2['HMAC-SHA-256'],
      'HMAC-SHA-512': RFC_4231_CASE_2['HMAC-SHA-512'],
    })
  })

  it('keeps the plain digests alongside the HMAC rows', async () => {
    const result = await run('abc', { hmacKey: 'Jefe' })
    expect(rowsOf(result)).toMatchObject(ABC)
  })

  it('changes the HMAC when one character of the key changes', async () => {
    const signed = rowsOf(await run('abc', { hmacKey: 'Jefe' }))
    const mistyped = rowsOf(await run('abc', { hmacKey: 'Jeff' }))
    expect(mistyped['HMAC-SHA-256']).not.toBe(signed['HMAC-SHA-256'])
  })
})

describe('hashing a dropped file', () => {
  const digestsOnly = (result: ToolResult) =>
    (result.fields ?? []).filter((field) =>
      ['MD5', 'SHA-1', 'SHA-256', 'SHA-512'].includes(field.label),
    )

  it('gives the same digests as the same bytes typed as text', async () => {
    const file = new File([new TextEncoder().encode('abc')], 'note.txt')
    const fromFile = await hash.runFile(file)
    expect(digestsOnly(fromFile)).toEqual(digestsOnly(await run('abc')))
    expect(rowsOf(fromFile)['SHA-256']).toBe(ABC['SHA-256'])
  })

  it('names the file and its size', async () => {
    const file = new File([Uint8Array.from([0, 1, 2, 3])], 'blob.bin')
    expect(rowsOf(await hash.runFile(file)).File).toBe('blob.bin — 4 bytes')
  })

  it('hashes bytes that are not valid text', async () => {
    const bytes = Uint8Array.from([0x00, 0xff, 0x80, 0xfe])
    const fromFile = await hash.runFile(new File([bytes], 'raw.bin'))
    expect(rowsOf(fromFile).MD5).toMatch(/^[0-9a-f]{32}$/)
    expect(fromFile.ok).toBe(true)
  })
})
