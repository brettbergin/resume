import { describe, expect, it } from 'vitest'

import { url } from './url.ts'

/*
 * The interesting cases are the double encoding (`%2520`, which is the bug
 * this tool usually gets opened for) and the malformed escapes, which have to
 * come back as error results because `decodeURIComponent` throws on them.
 */

const decode = (input: string) => url.run(input, { mode: 'decode' })
const encode = (input: string) => url.run(input, { mode: 'encode' })

const LAYERS_2 = { label: 'Layers', value: 'decoded 2 layers' }

describe('url decoding', () => {
  it('decodes a single layer', () => {
    expect(decode('a%20b')).toMatchObject({ ok: true, output: 'a b' })
  })

  it('decodes a query string a form posted', () => {
    expect(decode('name%3Dvalue%26x%3D1').output).toBe('name=value&x=1')
  })

  it('decodes multi-byte UTF-8 escapes', () => {
    expect(decode('caf%C3%A9').output).toBe('café')
  })

  it('reports no layer count for ordinary single-layer input', () => {
    expect(decode('a%20b').fields).toBeUndefined()
  })

  it('decodes %2520 to a space and reports 2 layers', () => {
    const result = decode('%2520')
    expect(result).toMatchObject({ ok: true, output: ' ' })
    expect(result.fields).toContainEqual(LAYERS_2)
  })

  it('leaves input with no escapes alone', () => {
    expect(decode('plain text')).toMatchObject({ ok: true, output: 'plain text' })
  })

  it('returns an error result for a malformed escape, without throwing', () => {
    for (const input of ['%zz', '%', '%E0%A4%A', '100%']) {
      const result = decode(input)
      expect(result.ok, input).toBe(false)
      expect(result.output, input).toBe('')
      expect(result.error, input).toMatch(/percent/)
    }
  })

  it('gives empty output for empty input', () => {
    expect(decode('')).toEqual({ ok: true, output: '' })
  })
})

describe('url encoding', () => {
  it('escapes the characters a query parameter cannot carry', () => {
    expect(encode('name=value&x=1')).toMatchObject({
      ok: true,
      output: 'name%3Dvalue%26x%3D1',
    })
  })

  it('escapes non-ASCII as UTF-8', () => {
    expect(encode('café').output).toBe('caf%C3%A9')
  })

  it('round-trips through decoding', () => {
    expect(decode(encode('a b&c=d/é').output).output).toBe('a b&c=d/é')
  })
})

describe('url detection', () => {
  const detect = (input: string) => url.detect?.(input) ?? 0

  it('recognises percent-encoded input', () => {
    expect(detect('a%20b')).toBeGreaterThan(0.6)
    expect(detect('caf%C3%A9')).toBeGreaterThan(0.6)
  })

  it('ignores a percent sign that is not an escape', () => {
    expect(detect('100% done')).toBe(0)
    expect(detect('50%')).toBe(0)
  })

  it('scores a malformed escape as zero', () => {
    expect(detect('%E0%A4%A')).toBe(0)
  })

  it('scores plain text as zero', () => {
    expect(detect('')).toBe(0)
    expect(detect('hello world')).toBe(0)
  })
})

describe('the url tool definition', () => {
  it('defaults to decoding', () => {
    const defaults = Object.fromEntries(
      (url.options ?? []).map((option) => [option.key, option.default]),
    )
    expect(defaults).toEqual({ mode: 'decode' })
  })

  it('decodes when handed no options at all', () => {
    expect(url.run('a%20b', {})).toMatchObject({ output: 'a b' })
  })
})
