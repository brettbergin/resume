import { describe, expect, it } from 'vitest'

import { hexdump } from './hexdump.ts'

/*
 * The dump is read by eye in a `<pre>`, so the assertions are on the exact
 * rendered text: column positions are the feature, and a drifting pad would
 * not fail any looser check.
 */

const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text)

describe('hexdump', () => {
  it('renders nothing for no bytes', () => {
    expect(hexdump(new Uint8Array(0))).toBe('')
  })

  it('renders offset, hex bytes and an ascii gutter', () => {
    expect(hexdump(bytesOf('foobar'))).toBe(
      '00000000  66 6f 6f 62 61 72                                 |foobar|',
    )
  })

  it('splits the hex column into two groups of eight', () => {
    const line = hexdump(bytesOf('0123456789abcdef'))
    expect(line).toBe(
      '00000000  30 31 32 33 34 35 36 37  38 39 61 62 63 64 65 66  |0123456789abcdef|',
    )
  })

  it('wraps every sixteen bytes and advances the offset', () => {
    const lines = hexdump(bytesOf('x'.repeat(33))).split('\n')
    expect(lines).toHaveLength(3)
    expect(lines[1].startsWith('00000010  ')).toBe(true)
    expect(lines[2].startsWith('00000020  78  ')).toBe(true)
  })

  it('pads a short final line so the gutter stays aligned', () => {
    const lines = hexdump(bytesOf('x'.repeat(17))).split('\n')
    expect(lines[1].indexOf('|')).toBe(lines[0].indexOf('|'))
  })

  it('shows control bytes and high bytes as dots', () => {
    const dump = hexdump(new Uint8Array([0x00, 0x0a, 0x7f, 0xff, 0x41]))
    expect(dump.endsWith('|....A|')).toBe(true)
    expect(dump).toContain('00 0a 7f ff 41')
  })
})
