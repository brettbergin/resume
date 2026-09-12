import { describe, expect, it } from 'vitest'

import {
  DEFAULT_TOOL_ID,
  MAX_HASH_INPUT_BYTES,
  TOOLS_ROUTE,
  buildToolHash,
  exceedsHashLimit,
  isToolsRoute,
  parseToolHash,
} from './fragment.ts'
import type { ToolHashState } from './fragment.ts'

/*
 * The fragment is the page's entire state channel, and the strings it has to
 * survive come from outside: a link truncated by a chat client, hand-edited,
 * or written by an older version of the page. So the two properties under
 * test are that anything `buildToolHash` writes comes back unchanged, and
 * that everything else degrades to the default state without throwing.
 */

/** What a malformed hash must produce, every time. */
const fallback = { tool: DEFAULT_TOOL_ID, input: '', options: {} }

const roundTrip = (state: ToolHashState) => parseToolHash(buildToolHash(state))

describe('isToolsRoute', () => {
  it.each([
    '#/tools',
    '#/tools/',
    '#/tools/jwt',
    '#/tools/base64?i=Zm9v',
    '#/tools?i=Zm9v',
  ])('accepts %s', (hash) => {
    expect(isToolsRoute(hash)).toBe(true)
  })

  it.each(['', '#', '#about', '#/toolsmith', '#/tool', '#/experience'])(
    'rejects %s',
    (hash) => {
      expect(isToolsRoute(hash)).toBe(false)
    },
  )
})

describe('parseToolHash / buildToolHash', () => {
  it('round-trips a bare tool selection', () => {
    expect(roundTrip({ tool: 'jwt', input: '', options: {} })).toEqual({
      tool: 'jwt',
      input: '',
      options: {},
    })
  })

  it('round-trips an input, a multi-key options map and non-ASCII text', () => {
    const state: ToolHashState = {
      tool: 'base64',
      input: 'héllo — ünïcode ✅\nsecond line\t& an ampersand',
      options: { mode: 'encode', alphabet: 'urlsafe', extra: 'a=b&c' },
    }
    expect(roundTrip(state)).toEqual(state)
  })

  it('round-trips input that would break a raw URL', () => {
    const state: ToolHashState = {
      tool: 'cert',
      input: '-----BEGIN CERTIFICATE-----\nMIIB#?&=/+\n-----END CERTIFICATE-----',
      options: {},
    }
    expect(roundTrip(state)).toEqual(state)
  })

  it('writes a hash under the tools route with no base64 padding', () => {
    const hash = buildToolHash({
      tool: 'base64',
      input: 'f',
      options: { mode: 'encode' },
    })
    expect(hash.startsWith(`#${TOOLS_ROUTE}/base64?`)).toBe(true)
    // base64url throughout: no `+`, `/` or `=` inside either payload, so
    // nothing in the fragment needs a second layer of percent-escaping.
    const payloads = new URLSearchParams(hash.split('?')[1])
    for (const value of payloads.values()) {
      expect(value).toMatch(/^[A-Za-z0-9_-]*$/)
    }
    expect(payloads.get('i')).not.toBeNull()
    expect(payloads.get('o')).not.toBeNull()
  })

  it('falls back to the default tool for an id that is not a path segment', () => {
    expect(parseToolHash('#/tools/Not%20A%20Tool')).toEqual(fallback)
    expect(parseToolHash('#/tools/jwt/extra')).toEqual(fallback)
  })

  it.each(['', '#', '#/nonsense', '#/tools/jwt?i=@@@', '#/tools/jwt?o=@@@'])(
    'never throws on %s',
    (hash) => {
      expect(() => parseToolHash(hash)).not.toThrow()
    },
  )

  it('returns the default state for a hash that is not the tools route', () => {
    expect(parseToolHash('#/nonsense')).toEqual(fallback)
    expect(parseToolHash('')).toEqual(fallback)
  })

  it('returns the default state for an unparseable payload', () => {
    // The tool id still parses, so only the payload is dropped.
    expect(parseToolHash('#/tools/jwt?i=@@@')).toEqual({
      tool: 'jwt',
      input: '',
      options: {},
    })
    expect(parseToolHash('#/tools/jwt?i=////')).toEqual({
      tool: 'jwt',
      input: '',
      options: {},
    })
  })

  it('ignores options that are not a flat map of strings', () => {
    const encode = (json: string) =>
      btoa(json).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')

    for (const json of ['[1,2]', 'null', '"text"', '{"a":{"b":"c"}}', '{']) {
      expect(parseToolHash(`#/tools/jwt?o=${encode(json)}`).options).toEqual({})
    }
  })
})

describe('buildToolHash sensitive contract', () => {
  it('writes only the tool id when sensitive is true, even with input and options set', () => {
    const hash = buildToolHash(
      {
        tool: 'totp',
        input: 'otpauth://totp/Example:alice@example.com?secret=JBSWY3DPEHPK3PXP',
        options: { digits: '6', period: '30' },
      },
      { sensitive: true },
    )
    expect(hash).toBe(`#${TOOLS_ROUTE}/totp`)
    expect(hash).not.toContain('i=')
    expect(hash).not.toContain('o=')
  })

  it('parses a sensitive hash back to the tool with empty input and options', () => {
    const hash = buildToolHash(
      { tool: 'totp', input: 'JBSWY3DPEHPK3PXP', options: { digits: '6' } },
      { sensitive: true },
    )
    expect(parseToolHash(hash)).toEqual({
      tool: 'totp',
      input: '',
      options: {},
    })
  })

  it('behaves exactly as before when sensitive is false or omitted', () => {
    const state: ToolHashState = {
      tool: 'base64',
      input: 'hello',
      options: { mode: 'encode' },
    }
    expect(buildToolHash(state, { sensitive: false })).toBe(buildToolHash(state))
    expect(buildToolHash(state)).toContain('i=')
    expect(buildToolHash(state)).toContain('o=')
  })
})

describe('the hash input ceiling', () => {
  const atLimit = 'a'.repeat(MAX_HASH_INPUT_BYTES)
  const overLimit = 'a'.repeat(MAX_HASH_INPUT_BYTES + 1)

  it('accepts an input exactly at the limit', () => {
    expect(exceedsHashLimit(atLimit)).toBe(false)
    expect(roundTrip({ tool: 'cert', input: atLimit, options: {} })).toEqual({
      tool: 'cert',
      input: atLimit,
      options: {},
    })
  })

  it('measures the limit in UTF-8 bytes, not code units', () => {
    // Half as many characters, the same number of bytes.
    expect(exceedsHashLimit('é'.repeat(MAX_HASH_INPUT_BYTES / 2))).toBe(false)
    expect(exceedsHashLimit('é'.repeat(MAX_HASH_INPUT_BYTES / 2 + 1))).toBe(
      true,
    )
  })

  it('omits an oversized input but keeps the tool and the options', () => {
    const hash = buildToolHash({
      tool: 'cert',
      input: overLimit,
      options: { mode: 'decode' },
    })
    expect(exceedsHashLimit(overLimit)).toBe(true)
    expect(hash).not.toContain('i=')
    expect(parseToolHash(hash)).toEqual({
      tool: 'cert',
      input: '',
      options: { mode: 'decode' },
    })
  })
})
