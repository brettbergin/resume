import { describe, expect, it } from 'vitest'

import { html } from './html.ts'

/*
 * Encoding is checked against the five characters that change how markup
 * parses; decoding against the forms other people's escapers emit, the double
 * escape (`&amp;lt;`), and the two things it must not do — decode an unknown
 * name, or accept a numeric reference that is not a character.
 */

const decode = (input: string) => html.run(input, { mode: 'decode' })
const encode = (input: string) => html.run(input, { mode: 'encode' })

const LAYERS_2 = { label: 'Layers', value: 'decoded 2 layers' }

describe('html encoding', () => {
  it('escapes the five characters that change how markup parses', () => {
    expect(encode(`&<>"'`)).toMatchObject({
      ok: true,
      output: '&amp;&lt;&gt;&quot;&#39;',
    })
  })

  it('escapes a script tag', () => {
    expect(encode('<script>alert("x")</script>').output).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;',
    )
  })

  it('escapes the ampersand first, so entities are not double-built', () => {
    expect(encode('&lt;').output).toBe('&amp;lt;')
  })

  it('leaves text that needs no escaping alone', () => {
    expect(encode('café 100% ok').output).toBe('café 100% ok')
  })
})

describe('html decoding', () => {
  it('decodes the named entities the encoder emits', () => {
    expect(decode('&amp;&lt;&gt;&quot;&#39;')).toMatchObject({
      ok: true,
      output: `&<>"'`,
    })
  })

  it('decodes &apos;, which other escapers emit for the same character', () => {
    expect(decode('&apos;').output).toBe("'")
  })

  it('decodes decimal and hex numeric references', () => {
    expect(decode('&#65;&#x42;&#X43;').output).toBe('ABC')
    expect(decode('&#x1F600;').output).toBe('\u{1F600}')
  })

  it('reports no layer count for ordinary single-layer input', () => {
    expect(decode('&lt;').fields).toBeUndefined()
  })

  it('decodes &amp;lt; to < and reports 2 layers', () => {
    const result = decode('&amp;lt;')
    expect(result).toMatchObject({ ok: true, output: '<' })
    expect(result.fields).toContainEqual(LAYERS_2)
  })

  it('leaves an unknown entity name as text', () => {
    expect(decode('&foo; &T; AT&T').output).toBe('&foo; &T; AT&T')
  })

  it('does not reach Object.prototype for an entity name', () => {
    expect(decode('&constructor;&toString;').output).toBe(
      '&constructor;&toString;',
    )
  })

  it('leaves a numeric reference that is not a character alone', () => {
    expect(decode('&#1114112;').output).toBe('&#1114112;')
    expect(decode('&#xD800;').output).toBe('&#xD800;')
  })

  it('round-trips through encoding', () => {
    const plain = `<a href="x">Tom & Jerry's</a>`
    expect(decode(encode(plain).output).output).toBe(plain)
  })

  it('gives empty output for empty input', () => {
    expect(decode('')).toEqual({ ok: true, output: '' })
  })
})

describe('html detection', () => {
  const detect = (input: string) => html.detect?.(input) ?? 0

  it('recognises entity-encoded input', () => {
    expect(detect('&lt;script&gt;')).toBeGreaterThan(0.6)
    expect(detect('&#39;')).toBeGreaterThan(0.6)
  })

  it('scores text containing a bare ampersand as zero', () => {
    expect(detect('Tom & Jerry')).toBe(0)
    expect(detect('a &foo; b')).toBe(0)
  })

  it('scores plain text as zero', () => {
    expect(detect('')).toBe(0)
    expect(detect('hello world')).toBe(0)
  })
})

describe('the html tool definition', () => {
  it('defaults to decoding', () => {
    const defaults = Object.fromEntries(
      (html.options ?? []).map((option) => [option.key, option.default]),
    )
    expect(defaults).toEqual({ mode: 'decode' })
  })

  it('decodes when handed no options at all', () => {
    expect(html.run('&lt;', {})).toMatchObject({ output: '<' })
  })
})
