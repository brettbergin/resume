import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { base64 } from './base64.ts'
import { epoch } from './epoch.ts'
import { hex } from './hex.ts'
import type { ToolField } from './types.ts'

/*
 * The clock is pinned for the whole suite. Half of what this tool emits is
 * relative to "now", so without a fixed clock the relative-phrase assertions
 * would go stale on their own — a test that passes in March and fails in May
 * is worse than no test.
 *
 * The zone is *not* pinned, on purpose: the suite has to pass wherever it is
 * run, including a contributor's laptop and CI. So the UTC rows are asserted
 * against exact strings, and the local row is checked by parsing it back to
 * the same instant and comparing its parts against `Date`'s own accessors.
 */

const NOW = new Date('2026-03-01T12:00:00Z')

/** 2023-11-14T22:13:20Z, the same instant at all three precisions. */
const SECONDS = '1700000000'
const MILLISECONDS = '1700000000000'
const MICROSECONDS = '1700000000000000'
const INSTANT = 1700000000000

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

// The tool takes no options, so its concrete `run` takes only the input; the
// pane still calls it through `Tool`, where the options argument is ignored.
const run = (input: string) => epoch.run(input)
const detect = (input: string) => epoch.detect?.(input) ?? 0

function fieldValue(fields: ToolField[] | undefined, label: string): string {
  const field = fields?.find((row) => row.label === label)
  if (field === undefined) throw new Error(`no field labelled ${label}`)
  return field.value
}

describe('epoch parsing of numeric timestamps', () => {
  it('reads 10 digits as seconds, 13 as milliseconds and 16 as microseconds', () => {
    for (const input of [SECONDS, MILLISECONDS, MICROSECONDS]) {
      const result = run(input)
      expect(result.ok, input).toBe(true)
      expect(fieldValue(result.fields, 'ISO 8601 (UTC)'), input).toBe(
        '2023-11-14T22:13:20.000Z',
      )
    }
  })

  it('produces identical fields whichever precision the instant arrived in', () => {
    expect(run(MILLISECONDS).fields).toEqual(run(SECONDS).fields)
    expect(run(MICROSECONDS).fields).toEqual(run(SECONDS).fields)
  })

  it('emits the instant at all three precisions', () => {
    const { fields } = run(SECONDS)
    expect(fieldValue(fields, 'Epoch (seconds)')).toBe(SECONDS)
    expect(fieldValue(fields, 'Epoch (milliseconds)')).toBe(MILLISECONDS)
    expect(fieldValue(fields, 'Epoch (microseconds)')).toBe(MICROSECONDS)
  })

  it('keeps sub-millisecond precision a 16-digit input carries', () => {
    const { fields } = run('1700000000123456')
    expect(fieldValue(fields, 'Epoch (microseconds)')).toBe('1700000000123456')
    expect(fieldValue(fields, 'Epoch (milliseconds)')).toBe('1700000000123')
    expect(fieldValue(fields, 'Epoch (seconds)')).toBe('1700000000')
    expect(fieldValue(fields, 'ISO 8601 (UTC)')).toBe('2023-11-14T22:13:20.123Z')
  })

  it('ignores surrounding whitespace from a sloppy paste', () => {
    expect(run(`  ${SECONDS}\n`).fields).toEqual(run(SECONDS).fields)
  })

  it('says so when a number is not one of the three precisions', () => {
    const result = run('2023')
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/10 digits/)
    expect(result.fields).toBeUndefined()
  })
})

describe('epoch parsing of date strings', () => {
  it('reads an ISO 8601 instant', () => {
    const { fields } = run('2023-11-14T22:13:20Z')
    expect(fieldValue(fields, 'Epoch (seconds)')).toBe(SECONDS)
  })

  it('reads an ISO 8601 instant with a non-UTC offset', () => {
    const { fields } = run('2023-11-14T23:13:20+01:00')
    expect(fieldValue(fields, 'Epoch (seconds)')).toBe(SECONDS)
  })

  it('reads an RFC 2822 date out of a header', () => {
    const { fields } = run('Tue, 14 Nov 2023 22:13:20 GMT')
    expect(fieldValue(fields, 'Epoch (seconds)')).toBe(SECONDS)
  })

  it('reads a bare ISO calendar date', () => {
    expect(fieldValue(run('2023-11-14').fields, 'ISO 8601 (UTC)')).toBe(
      '2023-11-14T00:00:00.000Z',
    )
  })
})

describe('epoch formatting', () => {
  it('formats RFC 2822 with a numeric zone rather than the obsolete GMT', () => {
    expect(fieldValue(run(SECONDS).fields, 'RFC 2822')).toBe(
      'Tue, 14 Nov 2023 22:13:20 +0000',
    )
  })

  it('formats local time as the same instant, with the local offset', () => {
    const local = fieldValue(run(SECONDS).fields, 'ISO 8601 (local)')
    expect(local).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/)
    // Parsed back it has to be the instant we started from, which is what
    // makes the offset it carries correct rather than merely well shaped.
    expect(Date.parse(local)).toBe(INSTANT)

    const date = new Date(INSTANT)
    const pad = (value: number) => String(value).padStart(2, '0')
    expect(local.slice(0, 10)).toBe(
      `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    )
    expect(local.slice(11, 19)).toBe(
      `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`,
    )
  })

  it('summarises the instant and how long ago it was', () => {
    expect(run(SECONDS).output).toBe('2023-11-14T22:13:20.000Z — 2 years ago')
  })
})

describe('the relative phrase', () => {
  /** An offset from the pinned clock, as a 10-digit epoch. */
  const at = (offsetSeconds: number) =>
    String(Math.trunc(NOW.getTime() / 1000) + offsetSeconds)

  const phrase = (offsetSeconds: number) =>
    fieldValue(run(at(offsetSeconds)).fields, 'Relative')

  it('reads in the past', () => {
    expect(phrase(-3 * 3600)).toBe('3 hours ago')
    expect(phrase(-90)).toBe('1 minute ago')
  })

  it('reads in the future', () => {
    expect(phrase(2 * 86400)).toBe('in 2 days')
    expect(phrase(45)).toBe('in 45 seconds')
  })

  it('picks the largest unit the gap fills', () => {
    expect(phrase(-72366400)).toBe('2 years ago')
  })

  it('moves with the clock', () => {
    const input = at(-3600)
    expect(fieldValue(run(input).fields, 'Relative')).toBe('1 hour ago')
    vi.setSystemTime(new Date(NOW.getTime() + 3600 * 1000))
    expect(fieldValue(run(input).fields, 'Relative')).toBe('2 hours ago')
  })
})

describe('epoch error handling', () => {
  const unparseable = [
    'not a date',
    'hello world',
    '2023-13-45T99:99:99Z',
    'Tue, 32 Xxx 2023 22:13:20 GMT',
    '0x1700000000',
  ]

  it('returns an error result rather than throwing', () => {
    for (const input of unparseable) {
      const result = run(input)
      expect(result.ok, input).toBe(false)
      expect(result.error, input).toBeTruthy()
      expect(result.output, input).toBe('')
    }
  })

  it('never puts Invalid Date in a field', () => {
    for (const input of [...unparseable, SECONDS, '2023-11-14']) {
      const result = run(input)
      for (const field of result.fields ?? []) {
        expect(field.value, `${input} / ${field.label}`).not.toMatch(/Invalid Date|NaN/)
      }
    }
  })

  it('gives empty output for empty input', () => {
    expect(run('')).toEqual({ ok: true, output: '' })
    expect(run('   ')).toEqual({ ok: true, output: '' })
  })
})

describe('epoch detection', () => {
  it('is confident about a bare timestamp at any of the three precisions', () => {
    expect(detect(SECONDS)).toBe(0.9)
    expect(detect(MILLISECONDS)).toBe(0.9)
    expect(detect(MICROSECONDS)).toBe(0.9)
  })

  it('outranks base64 and hex on a 16-digit timestamp', () => {
    const score = detect(MICROSECONDS)
    expect(score).toBeGreaterThan(base64.detect?.(MICROSECONDS) ?? 0)
    expect(score).toBeGreaterThan(hex.detect?.(MICROSECONDS) ?? 0)
  })

  it('recognises an ISO 8601 string', () => {
    expect(detect('2023-11-14T22:13:20Z')).toBe(0.8)
    expect(detect('2023-11-14')).toBe(0.8)
  })

  it('recognises an RFC 2822 string above the magic threshold', () => {
    expect(detect('Tue, 14 Nov 2023 22:13:20 GMT')).toBeGreaterThan(0.6)
  })

  it('scores anything else as zero', () => {
    expect(detect('not a date')).toBe(0)
    expect(detect('')).toBe(0)
    expect(detect('2023')).toBe(0)
    expect(detect('deadbeefdeadbeef')).toBe(0)
    expect(detect('2023-13-45')).toBe(0)
  })
})
