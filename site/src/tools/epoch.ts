/*
 * Timestamps in every form they get pasted in.
 *
 * The input is a Unix timestamp at one of the three precisions that show up in
 * logs — 10 digits is seconds, 13 is milliseconds, 16 is microseconds — or a
 * date string: ISO 8601 out of an API response, RFC 2822 out of a mail header
 * or an HTTP `Date`. All of it lands on the same instant and the same rows, so
 * the reader can paste whichever form the log gave them and read off whichever
 * form the next system wants.
 *
 * Everything is parsed into an exact microsecond count held as a `bigint`
 * rather than a `Date`. A 16-digit microsecond timestamp is above
 * `Number.MAX_SAFE_INTEGER` from 2255 onwards, and `Date` itself only holds
 * milliseconds, so going through either would silently round the input the
 * reader pasted. `Date` is still what formats the result — it just never holds
 * the precision.
 *
 * `detect` has to win outright on a bare number. A 16-digit timestamp is also
 * a valid hex string and a valid base64 alphabet string, and is essentially
 * never meant as either, so digits score 0.9 against hex's 0.5 and base64's
 * 0.7 ceiling.
 */

import type { Tool, ToolField, ToolResult } from './types.ts'

/** Fixed rather than the runtime's locale: the phrase is part of the tool's
 * output, and a shared link should read the same to whoever opens it. */
const relativeFormat = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

/** How many of the previous unit make up each one, walked smallest first so
 * the phrase uses the largest unit the difference fills. The 4.34524 is the
 * mean number of weeks in a month — the relative phrase is a human
 * approximation, and pretending otherwise would need a calendar. */
const DIVISIONS = [
  { per: 60, unit: 'second' },
  { per: 60, unit: 'minute' },
  { per: 24, unit: 'hour' },
  { per: 7, unit: 'day' },
  { per: 4.34524, unit: 'week' },
  { per: 12, unit: 'month' },
  { per: Number.POSITIVE_INFINITY, unit: 'year' },
] as const satisfies readonly { per: number; unit: Intl.RelativeTimeFormatUnit }[]

/** A full ISO 8601 date, optionally with a time, and optionally with a zone.
 * Deliberately stricter than `Date.parse`, which will take `2023` as a year
 * and a browser-specific grab bag of other things: this only decides whether
 * an input *looks* like ISO 8601, and the parse still has to succeed. */
const ISO_8601 =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/i

/** `Wed, 14 Nov 2023 22:13:20 GMT` and friends — the day name and comma are
 * what make this worth guessing at, since without them the legacy date parser
 * accepts far too much to be a signal. */
const RFC_2822 =
  /^[a-z]{3},\s*\d{1,2}\s+[a-z]{3}\s+\d{4}\s+\d{2}:\d{2}(?::\d{2})?\s*(?:[+-]\d{4}|[a-z]{1,5})?$/i

const MICROS_PER_MS = 1000n
const MICROS_PER_SECOND = 1000000n

/** The digit counts a bare number is accepted at, and what each one means. */
const PRECISIONS = new Map<number, bigint>([
  [10, MICROS_PER_SECOND],
  [13, MICROS_PER_MS],
  [16, 1n],
])

/** `bigint` division truncates towards zero, which would put a pre-1970
 * timestamp in the wrong second. Every derived field floors instead, so
 * `-1.5s` reads as second `-2` with a positive sub-second remainder, the same
 * way `Date` splits it. */
function floorDiv(value: bigint, divisor: bigint): bigint {
  const quotient = value / divisor
  return value % divisor !== 0n && value < 0n ? quotient - 1n : quotient
}

function pad(value: number, width = 2): string {
  return String(Math.abs(value)).padStart(width, '0')
}

/** ISO 8601 in the reader's own zone, carrying the offset that makes it
 * unambiguous. Built by hand because `toISOString` is UTC-only and
 * `toLocaleString` produces a display format, not an interchange one. */
function localIso(date: Date): string {
  // getTimezoneOffset is minutes *behind* UTC, so a zone east of UTC reports a
  // negative number and the sign has to be flipped to read as an ISO offset.
  const offset = -date.getTimezoneOffset()
  const sign = offset < 0 ? '-' : '+'
  const minutes = Math.abs(offset)
  const calendar = `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`
  return `${calendar}T${clock}${sign}${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`
}

/** RFC 2822 §3.3, which wants a numeric zone. `toUTCString` gets the whole
 * line right apart from spelling the offset `GMT`, which 2822 only keeps
 * around as an obsolete form. */
function rfc2822(date: Date): string {
  return date.toUTCString().replace(/GMT$/, '+0000')
}

/** "3 hours ago", "in 2 days" — the largest unit the gap actually fills. */
function relative(micros: bigint, now: number): string {
  let duration = Number(micros - BigInt(now) * MICROS_PER_MS) / 1e6
  for (const { per, unit } of DIVISIONS) {
    if (Math.abs(duration) < per) return relativeFormat.format(Math.round(duration), unit)
    duration /= per
  }
  /* c8 ignore next -- the last division is Infinity, so the loop always returns */
  return relativeFormat.format(Math.round(duration), 'year')
}

/** The input as exact microseconds since the epoch, or an error explaining
 * what it was not. Returning the reason rather than `null` is what keeps the
 * "10, 13 or 16 digits" hint attached to the input it applies to. */
function parse(input: string): { micros: bigint } | { error: string } {
  const trimmed = input.trim()

  if (/^\d+$/.test(trimmed)) {
    const scale = PRECISIONS.get(trimmed.length)
    if (scale === undefined) {
      return {
        error: `a numeric timestamp has to be 10 digits (seconds), 13 (milliseconds) or 16 (microseconds) — this is ${trimmed.length}`,
      }
    }
    return { micros: BigInt(trimmed) * scale }
  }

  if (!ISO_8601.test(trimmed) && !RFC_2822.test(trimmed)) {
    return {
      error:
        'not a timestamp: expected 10, 13 or 16 digits, an ISO 8601 date or an RFC 2822 date',
    }
  }

  const ms = Date.parse(trimmed)
  if (Number.isNaN(ms)) {
    return { error: `not a valid date: ${trimmed}` }
  }
  return { micros: BigInt(ms) * MICROS_PER_MS }
}

function fieldsFor(micros: bigint, now: number): ToolField[] {
  const ms = floorDiv(micros, MICROS_PER_MS)
  const date = new Date(Number(ms))
  return [
    { label: 'Epoch (seconds)', value: floorDiv(micros, MICROS_PER_SECOND).toString() },
    { label: 'Epoch (milliseconds)', value: ms.toString() },
    { label: 'Epoch (microseconds)', value: micros.toString() },
    { label: 'ISO 8601 (UTC)', value: date.toISOString() },
    { label: 'ISO 8601 (local)', value: localIso(date) },
    { label: 'RFC 2822', value: rfc2822(date) },
    { label: 'Relative', value: relative(micros, now) },
  ]
}

function run(input: string): ToolResult {
  if (input.trim() === '') return { ok: true, output: '' }

  const parsed = parse(input)
  if ('error' in parsed) return { ok: false, output: '', error: parsed.error }

  const ms = Number(floorDiv(parsed.micros, MICROS_PER_MS))
  const date = new Date(ms)
  if (Number.isNaN(date.getTime())) {
    return {
      ok: false,
      output: '',
      error: `that instant is outside the range a date can represent: ${parsed.micros} µs`,
    }
  }

  const now = Date.now()
  return {
    ok: true,
    output: `${date.toISOString()} — ${relative(parsed.micros, now)}`,
    fields: fieldsFor(parsed.micros, now),
  }
}

function detect(input: string): number {
  const trimmed = input.trim()
  if (trimmed === '') return 0

  // Above hex (0.5) and base64's 0.7 ceiling on purpose: a bare 10, 13 or
  // 16-digit number is a timestamp, whatever else it also happens to be.
  if (/^\d+$/.test(trimmed)) return PRECISIONS.has(trimmed.length) ? 0.9 : 0
  if (ISO_8601.test(trimmed) && !Number.isNaN(Date.parse(trimmed))) return 0.8
  if (RFC_2822.test(trimmed) && !Number.isNaN(Date.parse(trimmed))) return 0.7
  return 0
}

export const epoch = {
  id: 'epoch',
  name: 'epoch',
  detect,
  run,
} satisfies Tool
