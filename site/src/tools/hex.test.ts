import { describe, expect, it } from 'vitest'

import { hex } from './hex.ts'

/*
 * The vectors are the shapes hex actually arrives in — `0x` prefixes, colon
 * and dash separators, line wrapping — plus the two failure modes that have to
 * be results rather than throws: a stray character and an odd digit count.
 */

const decode = (input: string) => hex.run(input, { mode: 'decode' })
const encode = (input: string) => hex.run(input, { mode: 'encode' })

describe('hex decoding', () => {
  it('decodes a plain lowercase string', () => {
    expect(decode('48656c6c6f')).toMatchObject({ ok: true, output: 'Hello' })
  })

  it('decodes uppercase digits', () => {
    expect(decode('48656C6C6F').output).toBe('Hello')
  })

  it.each([
    '0x48:65-6c 6c6f',
    '48 65 6c 6c 6f',
    '48:65:6c:6c:6f',
    '48-65-6C-6C-6F',
    '0x48 0x65 0x6c 0x6c 0x6f',
    '4865\n6c6c\n6f\n',
  ])('tolerates the decoration in %o', (input) => {
    expect(decode(input)).toMatchObject({ ok: true, output: 'Hello' })
  })

  it('decodes multi-byte UTF-8 back to text', () => {
    expect(decode('c3a9').output).toBe('é')
  })

  it('reports the decoded size in bytes', () => {
    expect(decode('48656c6c6f').fields).toContainEqual({
      label: 'Decoded',
      value: '5 bytes',
    })
  })

  it('returns an error result for an odd digit count, without throwing', () => {
    const result = decode('48656c6c6')
    expect(result.ok).toBe(false)
    expect(result.output).toBe('')
    expect(result.error).toMatch(/odd/)
  })

  it('returns an error result for a character that is not hex', () => {
    const result = decode('48zz6c')
    expect(result.ok).toBe(false)
    expect(result.output).toBe('')
    expect(result.error).toMatch(/hex/)
  })

  it('gives empty output for empty input', () => {
    expect(decode('')).toEqual({ ok: true, output: '' })
    expect(decode('   ')).toEqual({ ok: true, output: '' })
  })
})

describe('hex output that is not valid UTF-8', () => {
  const result = decode('fffe')

  it('renders a hex dump instead of replacement characters', () => {
    expect(result.ok).toBe(true)
    expect(result.output).toBe(
      '00000000  ff fe                                             |..|',
    )
    expect(result.output).not.toContain('�')
  })

  it('says so in a warning field', () => {
    expect(result.fields).toContainEqual({
      label: 'Encoding',
      value: 'not valid UTF-8 — shown as a hex dump',
      warn: true,
    })
  })
})

describe('hex encoding', () => {
  it('emits lowercase pairs', () => {
    expect(encode('Hello')).toMatchObject({ ok: true, output: '48656c6c6f' })
  })

  it('encodes non-ASCII text as its UTF-8 bytes', () => {
    expect(encode('é').output).toBe('c3a9')
  })

  it('round-trips through decoding', () => {
    expect(decode(encode('Hello, world!').output).output).toBe('Hello, world!')
  })
})

describe('hex detection', () => {
  const detect = (input: string) => hex.detect?.(input) ?? 0

  it('is confident about hex containing a-f', () => {
    expect(detect('48656c6c6f')).toBeGreaterThan(0.6)
  })

  it('stays under the magic threshold for an all-digit epoch', () => {
    expect(detect('1755112233')).toBeLessThanOrEqual(0.5)
    expect(detect('1755112233000')).toBe(0)
  })

  it('scores an odd digit count as zero', () => {
    expect(detect('48656c6c6')).toBe(0)
  })

  it('scores input containing a character that is not hex as zero', () => {
    expect(detect('hello world')).toBe(0)
    expect(detect('48 65 zz')).toBe(0)
  })

  it('scores empty input as zero', () => {
    expect(detect('')).toBe(0)
    expect(detect('  ')).toBe(0)
  })

  it('sees through separators and prefixes', () => {
    expect(detect('0x48:65-6c 6c6f')).toBeGreaterThan(0.6)
  })

  it('is only tentative about two digits', () => {
    expect(detect('ff')).toBeLessThanOrEqual(0.5)
  })
})

describe('the hex tool definition', () => {
  it('defaults to decoding', () => {
    const defaults = Object.fromEntries(
      (hex.options ?? []).map((option) => [option.key, option.default]),
    )
    expect(defaults).toEqual({ mode: 'decode' })
  })

  it('decodes when handed no options at all', () => {
    expect(hex.run('48656c6c6f', {})).toMatchObject({ output: 'Hello' })
  })
})
