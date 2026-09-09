import { describe, expect, it } from 'vitest'

import { cidr } from './cidr.ts'
import type { ToolField } from './types.ts'

/*
 * The arithmetic is checked against hand-worked vectors rather than against a
 * second implementation of the same shifts: 192.168.1.130/26 is the example
 * every subnetting table uses, and its rows are written out here in full so a
 * regression in the masking shows up as a wrong address rather than as two
 * copies of the same mistake agreeing with each other.
 *
 * The IPv6 host counts are the reason the tool holds addresses as `bigint`,
 * so they are asserted as exact digit strings: a /48 has 2^80 addresses, which
 * is nineteen orders of magnitude past what a double can count.
 */

const run = (input: string, contains = '') => cidr.run(input, { contains })
const detect = (input: string) => cidr.detect?.(input) ?? 0

function field(fields: ToolField[] | undefined, label: string): ToolField {
  const row = fields?.find((entry) => entry.label === label)
  if (row === undefined) throw new Error(`no field labelled ${label}`)
  return row
}

const value = (fields: ToolField[] | undefined, label: string): string =>
  field(fields, label).value

describe('cidr on an IPv4 block', () => {
  const result = run('192.168.1.130/26')

  it('parses a host address inside the block', () => {
    expect(result.ok).toBe(true)
    expect(result.error).toBeUndefined()
  })

  it('derives the network and broadcast addresses', () => {
    expect(value(result.fields, 'Version')).toBe('IPv4')
    expect(value(result.fields, 'Network')).toBe('192.168.1.128')
    expect(value(result.fields, 'Broadcast')).toBe('192.168.1.191')
  })

  it('derives the usable host range and the host count', () => {
    expect(value(result.fields, 'First host')).toBe('192.168.1.129')
    expect(value(result.fields, 'Last host')).toBe('192.168.1.190')
    expect(value(result.fields, 'Host count')).toBe('64')
  })

  it('shows the mask in every notation', () => {
    expect(value(result.fields, 'Prefix length')).toBe('/26')
    expect(value(result.fields, 'Netmask')).toBe('255.255.255.192')
    expect(value(result.fields, 'Netmask (hex)')).toBe('0xffffffc0')
    expect(value(result.fields, 'Wildcard')).toBe('0.0.0.63')
  })

  it('classifies the block', () => {
    expect(value(result.fields, 'Classification')).toBe('private')
  })

  it('summarises the block in the output line', () => {
    expect(result.output).toBe(
      '192.168.1.128/26 — private — 64 addresses — hosts 192.168.1.129 – 192.168.1.190',
    )
  })

  it('reads a bare address as a single host', () => {
    const bare = run('192.168.1.130')
    expect(bare.ok).toBe(true)
    expect(value(bare.fields, 'Prefix length')).toBe('/32')
    expect(value(bare.fields, 'Network')).toBe('192.168.1.130')
    expect(value(bare.fields, 'Host count')).toBe('1')
  })

  it('counts a /0 without overflowing', () => {
    expect(value(run('0.0.0.0/0').fields, 'Host count')).toBe('4,294,967,296')
    expect(value(run('0.0.0.0/0').fields, 'Netmask')).toBe('0.0.0.0')
    expect(value(run('0.0.0.0/0').fields, 'Wildcard')).toBe('255.255.255.255')
  })
})

describe('cidr on the IPv4 edge prefixes', () => {
  it('treats both addresses of a /31 as hosts and reports no broadcast', () => {
    const result = run('10.0.0.5/31')
    expect(result.ok).toBe(true)
    expect(value(result.fields, 'Network')).toBe('10.0.0.4')
    expect(value(result.fields, 'First host')).toBe('10.0.0.4')
    expect(value(result.fields, 'Last host')).toBe('10.0.0.5')
    expect(value(result.fields, 'Host count')).toBe('2')
    expect(value(result.fields, 'Broadcast')).toContain('n/a')
    expect(value(result.fields, 'Broadcast')).toContain('/31')
  })

  it('treats a /32 as one host with no broadcast', () => {
    const result = run('10.0.0.5/32')
    expect(result.ok).toBe(true)
    expect(value(result.fields, 'Network')).toBe('10.0.0.5')
    expect(value(result.fields, 'First host')).toBe('10.0.0.5')
    expect(value(result.fields, 'Last host')).toBe('10.0.0.5')
    expect(value(result.fields, 'Host count')).toBe('1')
    expect(value(result.fields, 'Broadcast')).toContain('n/a')
    expect(value(result.fields, 'Netmask')).toBe('255.255.255.255')
    expect(result.output).toBe('10.0.0.5/32 — private — 1 address — hosts 10.0.0.5')
  })

  it('keeps a /30 as the smallest block with a broadcast address', () => {
    const result = run('10.0.0.5/30')
    expect(value(result.fields, 'Broadcast')).toBe('10.0.0.7')
    expect(value(result.fields, 'First host')).toBe('10.0.0.5')
    expect(value(result.fields, 'Last host')).toBe('10.0.0.6')
  })
})

describe('cidr on an IPv6 prefix', () => {
  const result = run('2001:db8::/48')

  it('counts the addresses as a BigInt rather than a double', () => {
    expect(result.ok).toBe(true)
    expect(value(result.fields, 'Host count')).toBe('1,208,925,819,614,629,174,706,176')
  })

  it('reports no IPv4-style broadcast address', () => {
    expect(value(result.fields, 'Broadcast')).toBe('n/a — IPv6 has no broadcast address')
  })

  it('covers the whole prefix with the usable host range', () => {
    expect(value(result.fields, 'Version')).toBe('IPv6')
    expect(value(result.fields, 'Network')).toBe('2001:db8::')
    expect(value(result.fields, 'First host')).toBe('2001:db8::')
    expect(value(result.fields, 'Last host')).toBe('2001:db8:0:ffff:ffff:ffff:ffff:ffff')
  })

  it('classifies the documentation prefix', () => {
    expect(value(result.fields, 'Classification')).toBe('documentation')
  })

  it('leaves out the IPv4-only mask notations', () => {
    const labels = result.fields?.map((row) => row.label) ?? []
    expect(labels).toContain('Prefix length')
    expect(labels).not.toContain('Netmask')
    expect(labels).not.toContain('Netmask (hex)')
    expect(labels).not.toContain('Wildcard')
  })

  it('reads a bare IPv6 literal as a /128', () => {
    const bare = run('2001:0db8:0000:0000:0000:0000:0000:0001')
    expect(bare.ok).toBe(true)
    expect(value(bare.fields, 'Prefix length')).toBe('/128')
    expect(value(bare.fields, 'Network')).toBe('2001:db8::1')
    expect(value(bare.fields, 'Host count')).toBe('1')
  })

  it('accepts the compressed and full spellings of the same address', () => {
    expect(run('2001:db8::1').fields).toEqual(
      run('2001:0db8:0000:0000:0000:0000:0000:0001').fields,
    )
  })

  it('accepts an embedded IPv4 tail', () => {
    const result = run('::ffff:192.168.1.1')
    expect(result.ok).toBe(true)
    expect(value(result.fields, 'Version')).toBe('IPv6')
    expect(value(result.fields, 'Network')).toBe('::ffff:c0a8:101')
  })
})

describe('cidr classification', () => {
  const cases: readonly [string, string][] = [
    ['10.1.2.3', 'private'],
    ['172.16.5.5/12', 'private'],
    ['172.32.0.1', 'public'],
    ['192.168.0.1', 'private'],
    ['100.64.0.1', 'CGNAT'],
    ['127.0.0.1', 'loopback'],
    ['169.254.1.1', 'link-local'],
    ['192.0.2.10', 'documentation'],
    ['198.51.100.10', 'documentation'],
    ['203.0.113.10', 'documentation'],
    ['224.0.0.1', 'multicast'],
    ['8.8.8.8', 'public'],
    ['::1', 'loopback'],
    ['fd00::1', 'private'],
    ['fe80::1', 'link-local'],
    ['2001:db8::1', 'documentation'],
    ['ff02::1', 'multicast'],
    ['2606:4700::1111', 'public'],
  ]

  for (const [input, expected] of cases) {
    it(`classifies ${input} as ${expected}`, () => {
      expect(value(run(input).fields, 'Classification')).toBe(expected)
    })
  }
})

describe('the cidr contains check', () => {
  it('adds no row when the option is empty', () => {
    const labels = run('192.168.1.0/24').fields?.map((row) => row.label) ?? []
    expect(labels).not.toContain('Contains')
  })

  it('reports an address inside the block without a warning', () => {
    const row = field(run('192.168.1.0/24', '192.168.1.55').fields, 'Contains')
    expect(row.value).toBe('192.168.1.55 is inside 192.168.1.0/24')
    expect(row.warn).toBe(false)
  })

  it('warns about an address outside the block', () => {
    const row = field(run('192.168.1.0/24', '192.168.2.55').fields, 'Contains')
    expect(row.value).toBe('192.168.2.55 is outside 192.168.1.0/24')
    expect(row.warn).toBe(true)
  })

  it('checks containment for IPv6 too', () => {
    const inside = field(run('2001:db8::/48', '2001:db8:0:1::5').fields, 'Contains')
    expect(inside.warn).toBe(false)
    const outside = field(run('2001:db8::/48', '2001:db8:1::5').fields, 'Contains')
    expect(outside.warn).toBe(true)
  })

  it('fails on a contains value that is not an address', () => {
    const result = run('192.168.1.0/24', 'not-an-address')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('contains')
  })

  it('fails when the families do not match', () => {
    const result = run('192.168.1.0/24', '::1')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('IPv6')
  })
})

describe('cidr on input it cannot use', () => {
  it('returns an empty result for empty input', () => {
    expect(run('')).toEqual({ ok: true, output: '' })
    expect(run('   ')).toEqual({ ok: true, output: '' })
  })

  const bad = [
    'hello',
    '192.168.1',
    '192.168.1.256',
    '192.168.001.1',
    '192.168.1.1/33',
    '2001:db8::1/129',
    '2001:db8::1::2',
    '1:2:3:4:5:6:7:8:9',
    'gggg::1',
    '10.0.0.0/8/16',
    '10.0.0.0/eight',
    '::ffff:192.168.1.256',
  ] as const

  for (const input of bad) {
    it(`fails on ${input} rather than throwing`, () => {
      const result = run(input)
      expect(result.ok).toBe(false)
      expect(result.error ?? '').not.toBe('')
      expect(result.output).toBe('')
    })
  }
})

describe('cidr detection', () => {
  it('claims IPv4 blocks and bare dotted quads', () => {
    expect(detect('10.0.0.0/8')).toBeGreaterThan(0.6)
    expect(detect('192.168.1.130/26')).toBe(0.85)
    expect(detect('  8.8.8.8  ')).toBe(0.85)
  })

  it('claims IPv6 literals and prefixes slightly lower', () => {
    expect(detect('2001:db8::1')).toBeGreaterThan(0.6)
    expect(detect('2001:db8::/48')).toBe(0.8)
    expect(detect('::1')).toBe(0.8)
  })

  it('claims nothing else', () => {
    for (const input of ['hello', '', '   ', '1700000000', 'deadbeef', '192.168.1']) {
      expect(detect(input), input).toBe(0)
    }
  })
})
