import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { DEFAULT_TOOL_ID } from './fragment.ts'
import { createMagic, DETECTION_THRESHOLD } from './magic.ts'
import { findTool, tools } from './registry.ts'
import type { Tool, ToolOptions, ToolResult } from './types.ts'

/*
 * Magic paste is asserted through the real registry, not through stubs, for
 * everything the acceptance criteria name: the routing table below is the
 * feature's promise — paste a JWT and you get the JWT tool — and it is only
 * true if the *shipped* detectors are calibrated against each other. A stub
 * registry would assert that this module sorts numbers.
 *
 * Stubs appear only where the real registry cannot express the case: a tie at
 * the same confidence, and a `detect` that throws. Neither should exist among
 * the real tools, so both are constructed here.
 *
 * The import list is itself part of the test. This file imports `magic.ts`
 * before `registry.ts`, which is the load order that a static import cycle
 * between the two would die on (see the cycle note in `magic.ts`); the suite
 * running at all is the assertion.
 */

/* Resolved through `node:path` rather than `new URL(…, import.meta.url)`:
 * Vite reads the latter as an asset reference and refuses to serve a file from
 * outside the module graph. */
const fixtures = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../test/fixtures',
)

/** The self-signed certificate the cert tool's own suite decodes. Reused here
 * so the routing case is a real PEM block rather than a plausible-looking
 * header line. */
const SELF_SIGNED = readFileSync(resolve(fixtures, 'self-signed.pem'), 'utf8')

/* RFC 7515, Appendix A.1: the HS256 example token. */
const JWT_TOKEN =
  'eyJ0eXAiOiJKV1QiLA0KICJhbGciOiJIUzI1NiJ9' +
  '.eyJpc3MiOiJqb2UiLA0KICJleHAiOjEzMDA4MTkzODAsDQogImh0dHA6Ly9leGFtcGxlLmNvbS9pc19yb290Ijp0cnVlfQ' +
  '.dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'

/** The registered magic paste tool, which is what the page actually runs. */
const magic = findTool(DEFAULT_TOOL_ID) as Tool

const run = (input: string, options: ToolOptions = {}): Promise<ToolResult> =>
  Promise.resolve(magic.run(input, options))

const labels = (result: ToolResult): string[] =>
  (result.fields ?? []).map((field) => field.label)

/** A tool that recognises nothing but whatever it is told to. */
function stub(
  id: string,
  detect: (input: string) => number,
  output = id,
): Tool {
  return { id, name: id, detect, run: () => ({ ok: true, output }) }
}

describe('magic paste in the registry', () => {
  it('is the first tool listed and the one the default id resolves to', () => {
    expect(tools[0]?.id).toBe('magic')
    expect(findTool(DEFAULT_TOOL_ID)).toBe(tools[0])
  })

  it('declares no detect of its own', () => {
    // It would rank against the tools it dispatches to, and win or lose its
    // own sweep.
    expect(magic.detect).toBeUndefined()
  })
})

describe('magic paste routing', () => {
  /* One row per format the page promises to recognise on paste. The inputs are
   * the smallest thing that is unambiguously the format, and several are here
   * because they are ambiguous to a *character class* and must still land
   * right: a 10-digit epoch is valid hex, a 16-digit one is valid base64. */
  const cases: readonly [name: string, input: string, expected: string][] = [
    ['a JWT', JWT_TOKEN, 'jwt'],
    ['a PEM certificate', SELF_SIGNED, 'cert'],
    ['a 10-digit epoch', '1700000000', 'epoch'],
    ['a 16-digit epoch', '1700000000000000', 'epoch'],
    ['a CIDR block', '192.168.1.130/26', 'cidr'],
    ['a base64 string', 'Zm9vYmFy', 'base64'],
    ['a hex string', '48656c6c6f', 'hex'],
    ['doubly percent-encoded text', '%2520', 'url'],
  ]

  for (const [name, input, expected] of cases) {
    it(`routes ${name} to ${expected}`, async () => {
      const result = await run(input)
      expect(result.detected?.toolId).toBe(expected)
    })
  }

  it('renders the detected tool result, not a description of it', async () => {
    const [detected, direct] = await Promise.all([
      run('48656c6c6f'),
      Promise.resolve(findTool('hex')?.run('48656c6c6f', {}) as ToolResult),
    ])
    expect(detected.output).toBe(direct.output)
  })

  it('awaits a tool whose run is asynchronous', async () => {
    // cert goes through `crypto.subtle` for its fingerprint, so its `run`
    // returns a promise; magic has to resolve it rather than hand the pane a
    // promise wearing a detection row.
    const result = await run(SELF_SIGNED)
    expect(result.output).not.toBe('')
    expect(result.fields?.some((field) => field.label === 'Subject')).toBe(true)
  })
})

describe('the detection a dispatched result carries', () => {
  it('leads with a row naming the tool and its confidence', async () => {
    const result = await run(JWT_TOKEN)
    const first = result.fields?.[0]
    expect(first?.label).toBe('Detected as')
    expect(first?.value).toContain('jwt')
    expect(first?.value).toMatch(/\d+% confidence/)
  })

  it('keeps the dispatched tool own rows after the detection row', async () => {
    const result = await run('192.168.1.130/26')
    const direct = (await findTool('cidr')?.run('192.168.1.130/26', {})) as ToolResult
    expect(labels(result)).toEqual(['Detected as', ...labels(direct)])
  })

  it('reports the tool id and score machine-readably, for the switch link', async () => {
    const result = await run(JWT_TOKEN)
    expect(result.detected).toEqual({
      toolId: 'jwt',
      confidence: expect.any(Number),
    })
    // The chip links to `#/tools/<id>`, so the id has to be the registered
    // one and not a display name.
    expect(findTool(result.detected?.toolId ?? '')).toBeDefined()
    expect(result.detected?.confidence).toBeGreaterThan(DETECTION_THRESHOLD)
  })

  it('passes the pane options through to the tool it dispatched to', async () => {
    const encoded = await run('%2520', { mode: 'encode' })
    expect(encoded.output).toBe('%252520')
  })
})

describe('magic paste with nothing to go on', () => {
  it('shows instructions for empty input, with no detection', async () => {
    for (const input of ['', '   \n  ']) {
      const result = await run(input)
      expect(result.ok, JSON.stringify(input)).toBe(true)
      expect(result.output, JSON.stringify(input)).toContain('Paste anything')
      expect(result.detected, JSON.stringify(input)).toBeUndefined()
      expect(result.fields, JSON.stringify(input)).toBeUndefined()
      expect(result.error, JSON.stringify(input)).toBeUndefined()
    }
  })

  it('reports the near misses rather than failing when nothing clears the bar', async () => {
    // Six digits: hex will take it at 0.5, under the threshold, and nothing
    // else wants it at all.
    const result = await run('123456')
    expect(result.ok).toBe(true)
    expect(result.error).toBeUndefined()
    expect(result.detected).toBeUndefined()
    expect(result.output).toContain('hex')
    expect(result.output).toContain('50%')
    expect(result.fields?.[0]).toEqual({ label: 'Closest guess', value: 'hex — 50%' })
    expect(result.fields?.length).toBeLessThanOrEqual(2)
  })

  it('says so plainly when every tool scored zero', async () => {
    const result = await run('the quick brown fox!')
    expect(result.ok).toBe(true)
    expect(result.error).toBeUndefined()
    expect(result.detected).toBeUndefined()
    expect(result.output).toContain('No tool recognised this input.')
    expect(result.fields).toBeUndefined()
  })

  it('treats the threshold as exclusive', async () => {
    const onTheLine = createMagic(() => [
      stub('exactly-threshold', () => DETECTION_THRESHOLD),
    ])
    const above = createMagic(() => [
      stub('just-above', () => DETECTION_THRESHOLD + 0.01),
    ])

    expect((await onTheLine.run('x', {})).detected).toBeUndefined()
    expect((await above.run('x', {})).detected?.toolId).toBe('just-above')
  })
})

describe('magic paste over an unhelpful registry', () => {
  it('breaks a tie in favour of the earlier tool in registry order', async () => {
    const order = createMagic(() => [stub('alpha', () => 0.8), stub('beta', () => 0.8)])
    const reversed = createMagic(() => [
      stub('beta', () => 0.8),
      stub('alpha', () => 0.8),
    ])

    expect((await order.run('x', {})).detected?.toolId).toBe('alpha')
    expect((await reversed.run('x', {})).detected?.toolId).toBe('beta')
  })

  it('scores a detect that throws as zero instead of propagating', async () => {
    const boom = stub('boom', () => {
      throw new Error('detector exploded')
    })
    const withNeighbour = createMagic(() => [boom, stub('calm', () => 0.9)])

    const dispatched = await withNeighbour.run('x', {})
    expect(dispatched.detected?.toolId).toBe('calm')

    // Alone, the throwing tool must still leave a usable landing state.
    const alone = await createMagic(() => [boom]).run('x', {})
    expect(alone.ok).toBe(true)
    expect(alone.detected).toBeUndefined()
    expect(alone.output).toContain('No tool recognised this input.')
  })

  it('ignores a NaN score, which would otherwise poison the ranking', async () => {
    const nonsense = createMagic(() => [
      stub('nan', () => Number.NaN),
      stub('real', () => 0.7),
    ])
    expect((await nonsense.run('x', {})).detected?.toolId).toBe('real')
  })

  it('skips itself and any tool without a detect', async () => {
    const selfish = createMagic(() => [
      { id: 'magic', name: 'magic paste', detect: () => 1, run: () => ({ ok: true, output: 'self' }) },
      { id: 'quiet', name: 'quiet', run: () => ({ ok: true, output: 'quiet' }) },
      stub('real', () => 0.7),
    ])
    expect((await selfish.run('x', {})).detected?.toolId).toBe('real')
  })
})
