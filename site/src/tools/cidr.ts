/*
 * Subnet arithmetic for the two address families, from whichever form the
 * input arrived in: `a.b.c.d/n` out of a firewall rule, a bare address out of
 * a log line, a compressed IPv6 literal out of a `ip -6 addr` dump, an IPv6
 * prefix out of an allocation ticket. A bare address is read as a single-host
 * block — /32 or /128 — so the same rows come back either way.
 *
 * Addresses are `bigint` throughout, both families alike. IPv4 would fit in a
 * `number`, but the host count of a /0 is 2^32 and of an IPv6 /48 is 2^80, so
 * anything that counted addresses in a double would be wrong long before it
 * was interesting; one numeric type for both families also means the mask,
 * containment and classification logic is written once.
 *
 * IPv6 has no broadcast address and neither does a /31 or a /32, so those rows
 * say so rather than inventing the last address of the block and calling it a
 * broadcast — a reader copying a "broadcast" out of this tool would be copying
 * a lie. The /31 case follows RFC 3021: both addresses are usable hosts.
 *
 * `detect` scores a dotted quad at 0.85 and an IPv6 literal at 0.8, above
 * base64's 0.7 ceiling and hex's 0.5: `10.0.0.0/8` is not usefully anything
 * else, and while a bare `2001:db8::1` shares no alphabet with the encodings,
 * keeping the two families adjacent keeps the ordering easy to reason about.
 */

import type { Tool, ToolField, ToolOption, ToolOptions, ToolResult } from './types.ts'

const options: readonly ToolOption[] = [
  {
    key: 'contains',
    label: 'Contains',
    kind: 'text',
    default: '',
    placeholder: '10.1.2.3',
  },
]

/** How many bits an address of each family has. */
const WIDTH = { 4: 32, 6: 128 } as const

type Version = 4 | 6

/** An address with the block it was given in. `address` is the address as
 * pasted, not the network address: `192.168.1.130/26` keeps the `.130` so the
 * rows can show both the host the reader typed and the network it sits in. */
interface Network {
  version: Version
  address: bigint
  prefix: number
}

/** `192.168.1.130` as a `bigint`. Leading zeros are rejected: `010` is ten to
 * some resolvers and eight to others, so an input that relies on either is a
 * mistake worth surfacing rather than guessing at. */
function parseIPv4(text: string): bigint | null {
  const parts = text.split('.')
  if (parts.length !== 4) return null

  let value = 0n
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    if (part.length > 1 && part.startsWith('0')) return null
    const octet = Number(part)
    if (octet > 255) return null
    value = (value << 8n) | BigInt(octet)
  }
  return value
}

/** `::ffff:1.2.3.4` and `64:ff9b::1.2.3.4` rewritten with those last 32 bits
 * spelled as two hex groups, so the group parser below never has to know
 * about the dotted form. Returns `text` unchanged when there is no embedded
 * IPv4 part, and `null` when what follows the last colon looked like one and
 * was not. */
function expandEmbeddedIPv4(text: string): string | null {
  if (!text.includes('.')) return text

  const cut = text.lastIndexOf(':')
  if (cut < 0) return null

  const embedded = parseIPv4(text.slice(cut + 1))
  if (embedded === null) return null

  const high = (embedded >> 16n).toString(16)
  const low = (embedded & 0xffffn).toString(16)
  return `${text.slice(0, cut + 1)}${high}:${low}`
}

/** One side of a `::`, or a whole address when there is none. `null` for a
 * group that is not one to four hex digits. */
function parseGroups(side: string): number[] | null {
  if (side === '') return []

  const groups: number[] = []
  for (const part of side.split(':')) {
    if (!/^[0-9a-f]{1,4}$/i.test(part)) return null
    groups.push(Number.parseInt(part, 16))
  }
  return groups
}

/** An IPv6 literal, compressed or full, as a `bigint`. Accepts `::` standing
 * for a single zero group — RFC 5952 says not to *emit* that, but plenty of
 * things do — and rejects a second `::`, which would be ambiguous. */
function parseIPv6(text: string): bigint | null {
  const expanded = expandEmbeddedIPv4(text)
  if (expanded === null) return null

  const halves = expanded.split('::')
  if (halves.length > 2) return null

  const head = parseGroups(halves[0])
  const tail = halves.length === 2 ? parseGroups(halves[1]) : []
  if (head === null || tail === null) return null

  const given = head.length + tail.length
  let groups: number[]
  if (halves.length === 2) {
    // `::` has to stand for at least one group, so eight given groups plus a
    // `::` is not a longer address, it is a malformed one.
    if (given > 7) return null
    groups = [...head, ...Array.from({ length: 8 - given }, () => 0), ...tail]
  } else {
    if (given !== 8) return null
    groups = head
  }

  let value = 0n
  for (const group of groups) value = (value << 16n) | BigInt(group)
  return value
}

/** An address of either family, with which family it turned out to be. A
 * colon anywhere means IPv6 — including `::ffff:1.2.3.4`, which is an IPv6
 * address that happens to be written with a dotted tail. */
function parseAddress(text: string): { version: Version; value: bigint } | null {
  if (text.includes(':')) {
    const value = parseIPv6(text)
    return value === null ? null : { version: 6, value }
  }
  const value = parseIPv4(text)
  return value === null ? null : { version: 4, value }
}

function formatIPv4(value: bigint): string {
  const octets: string[] = []
  for (let shift = 24n; shift >= 0n; shift -= 8n) {
    octets.push(String((value >> shift) & 0xffn))
  }
  return octets.join('.')
}

/** RFC 5952: lowercase, no leading zeros in a group, and the longest run of
 * two or more zero groups replaced by `::` — leftmost run on a tie. */
function formatIPv6(value: bigint): string {
  const groups: string[] = []
  for (let shift = 112n; shift >= 0n; shift -= 16n) {
    groups.push(((value >> shift) & 0xffffn).toString(16))
  }

  let bestStart = -1
  let bestLength = 0
  let start = -1
  for (let index = 0; index <= groups.length; index += 1) {
    if (index < groups.length && groups[index] === '0') {
      if (start < 0) start = index
      continue
    }
    if (start >= 0) {
      const length = index - start
      if (length > bestLength) {
        bestStart = start
        bestLength = length
      }
      start = -1
    }
  }

  if (bestLength < 2) return groups.join(':')
  return `${groups.slice(0, bestStart).join(':')}::${groups.slice(bestStart + bestLength).join(':')}`
}

function formatAddress(version: Version, value: bigint): string {
  return version === 4 ? formatIPv4(value) : formatIPv6(value)
}

/** The netmask for a prefix length, as a `bigint` of the family's width. */
function maskFor(version: Version, prefix: number): bigint {
  const width = BigInt(WIDTH[version])
  return ((1n << width) - 1n) ^ ((1n << (width - BigInt(prefix))) - 1n)
}

const networkOf = (net: Network): bigint => net.address & maskFor(net.version, net.prefix)

const lastOf = (net: Network): bigint =>
  networkOf(net) | (maskFor(net.version, net.prefix) ^ ((1n << BigInt(WIDTH[net.version])) - 1n))

/** `::` and the leading groups of a well-known IPv6 prefix as a `bigint`, so
 * the table below reads like the prefixes it is transcribing. */
function ip6(...groups: number[]): bigint {
  const leading = groups.reduce((value, group) => (value << 16n) | BigInt(group), 0n)
  return leading << BigInt(16 * (8 - groups.length))
}

const ip4 = (a: number, b: number, c: number, d: number): bigint =>
  (BigInt(a) << 24n) | (BigInt(b) << 16n) | (BigInt(c) << 8n) | BigInt(d)

/** The blocks worth naming, checked in order so the first match wins. The
 * ranges are disjoint as written, so the order is about readability — families
 * grouped, most specific reason first — not about resolving overlaps. */
const RANGES = [
  { version: 4, base: ip4(127, 0, 0, 0), prefix: 8, label: 'loopback' },
  { version: 4, base: ip4(10, 0, 0, 0), prefix: 8, label: 'private' },
  { version: 4, base: ip4(172, 16, 0, 0), prefix: 12, label: 'private' },
  { version: 4, base: ip4(192, 168, 0, 0), prefix: 16, label: 'private' },
  { version: 4, base: ip4(169, 254, 0, 0), prefix: 16, label: 'link-local' },
  { version: 4, base: ip4(100, 64, 0, 0), prefix: 10, label: 'CGNAT' },
  { version: 4, base: ip4(192, 0, 2, 0), prefix: 24, label: 'documentation' },
  { version: 4, base: ip4(198, 51, 100, 0), prefix: 24, label: 'documentation' },
  { version: 4, base: ip4(203, 0, 113, 0), prefix: 24, label: 'documentation' },
  { version: 4, base: ip4(224, 0, 0, 0), prefix: 4, label: 'multicast' },
  { version: 6, base: 1n, prefix: 128, label: 'loopback' },
  { version: 6, base: ip6(0xfc00), prefix: 7, label: 'private' },
  { version: 6, base: ip6(0xfe80), prefix: 10, label: 'link-local' },
  { version: 6, base: ip6(0x2001, 0x0db8), prefix: 32, label: 'documentation' },
  { version: 6, base: ip6(0xff00), prefix: 8, label: 'multicast' },
] as const satisfies readonly {
  version: Version
  base: bigint
  prefix: number
  label: string
}[]

/** What the block is for. Decided on the network address rather than on the
 * whole block: a prefix shorter than the special range it contains — `0/0`
 * contains every one of them — is not itself special. */
function classify(version: Version, network: bigint): string {
  for (const range of RANGES) {
    if (range.version !== version) continue
    if ((network & maskFor(version, range.prefix)) === range.base) return range.label
  }
  return 'public'
}

/** Thousands separators, applied to a `bigint`'s digits directly. `Intl` would
 * do this too, but it would do it in the runtime's locale, and the value is
 * part of the tool's output — a shared link should read the same to whoever
 * opens it. */
function group(value: bigint): string {
  return value.toString().replace(/\B(?=(?:\d{3})+$)/g, ',')
}

/** The input as an address plus a prefix length, or the reason it is not one. */
function parseNetwork(input: string): Network | { error: string } {
  const trimmed = input.trim()
  const parts = trimmed.split('/')
  if (parts.length > 2) {
    return { error: `not a CIDR block: more than one "/" in ${trimmed}` }
  }

  const parsed = parseAddress(parts[0])
  if (parsed === null) {
    return {
      error:
        'not an address or CIDR block: expected a.b.c.d, a.b.c.d/n, an IPv6 literal or an IPv6 prefix',
    }
  }

  const width = WIDTH[parsed.version]
  if (parts.length === 1) {
    return { version: parsed.version, address: parsed.value, prefix: width }
  }

  if (!/^\d{1,3}$/.test(parts[1])) {
    return { error: `not a prefix length: ${parts[1]}` }
  }
  const prefix = Number(parts[1])
  if (prefix > width) {
    return {
      error: `a prefix length has to be 0-${width} for IPv${parsed.version} — this is /${prefix}`,
    }
  }

  return { version: parsed.version, address: parsed.value, prefix }
}

/** The broadcast row's value, or the reason there is no broadcast address to
 * show. IPv6 never had one; a /31 gave its up to a point-to-point link (RFC
 * 3021) and a /32 is a single host. */
function broadcastValue(net: Network): string {
  if (net.version === 6) return 'n/a — IPv6 has no broadcast address'
  if (net.prefix === 32) return 'n/a — a /32 is a single host'
  if (net.prefix === 31) return 'n/a — a /31 is a point-to-point link (RFC 3021)'
  return formatIPv4(lastOf(net))
}

/** First and last usable host. Every address in an IPv6 prefix is usable, as
 * are both addresses of a /31 and the single address of a /32 or /128; only a
 * /30-or-shorter IPv4 block loses its first and last to the network and
 * broadcast addresses. */
function hostRange(net: Network): { first: bigint; last: bigint } {
  const network = networkOf(net)
  const last = lastOf(net)
  if (net.version === 4 && net.prefix <= 30) {
    return { first: network + 1n, last: last - 1n }
  }
  return { first: network, last }
}

/** The row the `contains` option adds. `warn` marks the answer the reader was
 * probably not hoping for — the address is outside the block — since that is
 * the one worth a second look in a firewall rule. */
function containsField(net: Network, query: string): ToolField | { error: string } {
  const parsed = parseAddress(query.trim())
  if (parsed === null) {
    return { error: `"contains" is not an address: ${query.trim()}` }
  }
  if (parsed.version !== net.version) {
    return {
      error: `"contains" is an IPv${parsed.version} address and the block is IPv${net.version}`,
    }
  }

  const block = `${formatAddress(net.version, networkOf(net))}/${net.prefix}`
  const inside = (parsed.value & maskFor(net.version, net.prefix)) === networkOf(net)
  const address = formatAddress(parsed.version, parsed.value)
  return {
    label: 'Contains',
    value: `${address} is ${inside ? 'inside' : 'outside'} ${block}`,
    warn: !inside,
  }
}

function fieldsFor(net: Network): ToolField[] {
  const network = networkOf(net)
  const { first, last } = hostRange(net)
  const format = (value: bigint) => formatAddress(net.version, value)
  const count = 1n << BigInt(WIDTH[net.version] - net.prefix)

  const fields: ToolField[] = [
    { label: 'Version', value: `IPv${net.version}` },
    { label: 'Network', value: format(network) },
    { label: 'Broadcast', value: broadcastValue(net) },
    { label: 'First host', value: format(first) },
    { label: 'Last host', value: format(last) },
    { label: 'Host count', value: group(count) },
    { label: 'Prefix length', value: `/${net.prefix}` },
  ]

  // The other three notations are IPv4's: nothing writes an IPv6 mask as a
  // literal, and a 128-bit wildcard would be noise in the table.
  if (net.version === 4) {
    const mask = maskFor(4, net.prefix)
    fields.push(
      { label: 'Netmask', value: formatIPv4(mask) },
      { label: 'Netmask (hex)', value: `0x${mask.toString(16).padStart(8, '0')}` },
      { label: 'Wildcard', value: formatIPv4(mask ^ 0xffffffffn) },
    )
  }

  fields.push({ label: 'Classification', value: classify(net.version, network) })
  return fields
}

function run(input: string, toolOptions: ToolOptions): ToolResult {
  if (input.trim() === '') return { ok: true, output: '' }

  const net = parseNetwork(input)
  if ('error' in net) return { ok: false, output: '', error: net.error }

  const fields = fieldsFor(net)

  const contains = toolOptions.contains ?? ''
  if (contains.trim() !== '') {
    const field = containsField(net, contains)
    if ('error' in field) return { ok: false, output: '', error: field.error }
    fields.push(field)
  }

  const network = networkOf(net)
  const { first, last } = hostRange(net)
  const format = (value: bigint) => formatAddress(net.version, value)
  const hosts = first === last ? format(first) : `${format(first)} – ${format(last)}`
  const count = 1n << BigInt(WIDTH[net.version] - net.prefix)
  const summary = [
    `${format(network)}/${net.prefix}`,
    classify(net.version, network),
    `${group(count)} address${count === 1n ? '' : 'es'}`,
    `hosts ${hosts}`,
  ].join(' — ')

  return { ok: true, output: summary, fields }
}

function detect(input: string): number {
  const trimmed = input.trim()
  if (trimmed === '') return 0

  const net = parseNetwork(trimmed)
  if ('error' in net) return 0
  return net.version === 4 ? 0.85 : 0.8
}

export const cidr = {
  id: 'cidr',
  name: 'cidr',
  options,
  detect,
  run,
} satisfies Tool
