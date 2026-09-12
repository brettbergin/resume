import { describe, expect, it } from 'vitest'

import { gradeHeaders, headers, parseHeaders } from './headers.ts'
import type { ToolField } from './types.ts'

/*
 * `LINES` holds the known-good state for each graded header individually so
 * a bad-case test can omit or corrupt exactly one line and reassemble the
 * rest untouched — every bad case below is a single deviation from
 * `GOOD_HEADERS`, which keeps each test a test of one rule.
 *
 * Values are drawn from the OWASP HTTP Security Response Headers Cheat
 * Sheet. `X-Frame-Options` is deliberately absent from the good set: the CSP
 * already carries `frame-ancestors 'none'`, which supersedes it, so its own
 * bad case is "no frame-ancestors either" rather than "header missing" (a
 * plain omission would still be covered by the CSP and score no warning).
 */
const LINES = {
  status: 'HTTP/1.1 200 OK',
  sts: 'Strict-Transport-Security: max-age=63072000; includeSubDomains; preload',
  csp: "Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
  xcto: 'X-Content-Type-Options: nosniff',
  referrer: 'Referrer-Policy: no-referrer',
  permissions: 'Permissions-Policy: geolocation=(), microphone=()',
  coop: 'Cross-Origin-Opener-Policy: same-origin',
  corp: 'Cross-Origin-Resource-Policy: same-origin',
  acao: 'Access-Control-Allow-Origin: https://example.com',
  cookie: 'Set-Cookie: session=abc123; Secure; HttpOnly; SameSite=Strict',
} as const

const GOOD_HEADERS = Object.values(LINES).join('\n')

/** `findField` returns the row whose label contains `label` — a substring
 * rather than an exact match so `'Set-Cookie'` finds `'Set-Cookie: session'`
 * without the caller needing the cookie's name. */
function findField(fields: ToolField[], label: string): ToolField | undefined {
  return fields.find((field) => field.label.includes(label))
}

/** Removes the line `line` from `raw` entirely — the "omit this header" bad
 * case. */
function omit(raw: string, line: string): string {
  return raw
    .split('\n')
    .filter((candidate) => candidate !== line)
    .join('\n')
}

/** Replaces the line `line` in `raw` with `replacement` — the "corrupt this
 * header's value" bad case. */
function corrupt(raw: string, line: string, replacement: string): string {
  return raw.replace(line, replacement)
}

const BASELINE_SCORE = gradeHeaders(parseHeaders(GOOD_HEADERS)).score

describe('parseHeaders', () => {
  it('strips a leading status line', () => {
    const parsed = parseHeaders('HTTP/1.1 200 OK\nX-Content-Type-Options: nosniff')
    expect(parsed.has('http/1.1 200 ok')).toBe(false)
    expect(parsed.get('x-content-type-options')).toEqual(['nosniff'])
  })

  it('accumulates repeated Set-Cookie headers instead of overwriting', () => {
    const parsed = parseHeaders('Set-Cookie: a=1; Secure\nSet-Cookie: b=2; Secure; HttpOnly; SameSite=Lax')
    expect(parsed.get('set-cookie')).toEqual(['a=1; Secure', 'b=2; Secure; HttpOnly; SameSite=Lax'])
  })

  it('only splits on the first colon, keeping a colon inside a value intact', () => {
    const parsed = parseHeaders('Set-Cookie: token=a:b; Path=/')
    expect(parsed.get('set-cookie')).toEqual(['token=a:b; Path=/'])
  })

  it('returns an empty map for empty input', () => {
    const parsed = parseHeaders('')
    expect(parsed.size).toBe(0)
  })
})

describe('gradeHeaders warnings', () => {
  describe('Strict-Transport-Security', () => {
    it('flags a missing header', () => {
      const raw = omit(GOOD_HEADERS, LINES.sts)
      const result = gradeHeaders(parseHeaders(raw))
      expect(findField(result.fields, 'Strict-Transport-Security')?.warn).toBe(true)
      expect(result.score).toBeLessThan(BASELINE_SCORE)
    })

    it('flags max-age=3600 as under one year', () => {
      const raw = corrupt(GOOD_HEADERS, LINES.sts, 'Strict-Transport-Security: max-age=3600; includeSubDomains; preload')
      const result = gradeHeaders(parseHeaders(raw))
      expect(findField(result.fields, 'Strict-Transport-Security')?.warn).toBe(true)
      expect(result.score).toBeLessThan(BASELINE_SCORE)
    })

    it('flags a missing includeSubDomains', () => {
      const raw = corrupt(GOOD_HEADERS, LINES.sts, 'Strict-Transport-Security: max-age=63072000; preload')
      const result = gradeHeaders(parseHeaders(raw))
      expect(findField(result.fields, 'Strict-Transport-Security')?.warn).toBe(true)
      expect(result.score).toBeLessThan(BASELINE_SCORE)
    })

    it('flags a missing preload', () => {
      const raw = corrupt(GOOD_HEADERS, LINES.sts, 'Strict-Transport-Security: max-age=63072000; includeSubDomains')
      const result = gradeHeaders(parseHeaders(raw))
      expect(findField(result.fields, 'Strict-Transport-Security')?.warn).toBe(true)
      expect(result.score).toBeLessThan(BASELINE_SCORE)
    })
  })

  describe('Content-Security-Policy', () => {
    it('flags a missing header', () => {
      const raw = omit(GOOD_HEADERS, LINES.csp)
      const result = gradeHeaders(parseHeaders(raw))
      expect(findField(result.fields, 'Content-Security-Policy')?.warn).toBe(true)
      expect(result.score).toBeLessThan(BASELINE_SCORE)
    })

    it('warns via analyzeCSP delegation when script-src allows unsafe-inline', () => {
      const raw = corrupt(GOOD_HEADERS, LINES.csp, `${LINES.csp}; script-src 'unsafe-inline'`)
      const result = gradeHeaders(parseHeaders(raw))
      const field = findField(result.fields, 'Content-Security-Policy')
      expect(field?.warn).toBe(true)
      expect(field?.value).toContain('unsafe-inline')
      expect(result.score).toBeLessThan(BASELINE_SCORE)
    })
  })

  describe('X-Content-Type-Options', () => {
    it('flags a missing header', () => {
      const raw = omit(GOOD_HEADERS, LINES.xcto)
      const result = gradeHeaders(parseHeaders(raw))
      expect(findField(result.fields, 'X-Content-Type-Options')?.warn).toBe(true)
      expect(result.score).toBeLessThan(BASELINE_SCORE)
    })

    it('flags a value other than nosniff', () => {
      const raw = corrupt(GOOD_HEADERS, LINES.xcto, 'X-Content-Type-Options: text')
      const result = gradeHeaders(parseHeaders(raw))
      expect(findField(result.fields, 'X-Content-Type-Options')?.warn).toBe(true)
      expect(result.score).toBeLessThan(BASELINE_SCORE)
    })
  })

  describe('X-Frame-Options', () => {
    it('flags missing frame protection when the CSP has no frame-ancestors either', () => {
      const raw = corrupt(GOOD_HEADERS, LINES.csp, LINES.csp.replace("; frame-ancestors 'none'", ''))
      const result = gradeHeaders(parseHeaders(raw))
      expect(findField(result.fields, 'X-Frame-Options')?.warn).toBe(true)
      expect(result.score).toBeLessThan(BASELINE_SCORE)
    })
  })

  describe('Referrer-Policy', () => {
    it('flags a missing header', () => {
      const raw = omit(GOOD_HEADERS, LINES.referrer)
      const result = gradeHeaders(parseHeaders(raw))
      expect(findField(result.fields, 'Referrer-Policy')?.warn).toBe(true)
      expect(result.score).toBeLessThan(BASELINE_SCORE)
    })

    it('flags unsafe-url', () => {
      const raw = corrupt(GOOD_HEADERS, LINES.referrer, 'Referrer-Policy: unsafe-url')
      const result = gradeHeaders(parseHeaders(raw))
      expect(findField(result.fields, 'Referrer-Policy')?.warn).toBe(true)
      expect(result.score).toBeLessThan(BASELINE_SCORE)
    })
  })

  describe('Permissions-Policy', () => {
    it('flags a missing header', () => {
      const raw = omit(GOOD_HEADERS, LINES.permissions)
      const result = gradeHeaders(parseHeaders(raw))
      expect(findField(result.fields, 'Permissions-Policy')?.warn).toBe(true)
      expect(result.score).toBeLessThan(BASELINE_SCORE)
    })
  })

  describe('Cross-Origin-Opener-Policy', () => {
    it('flags a missing header', () => {
      const raw = omit(GOOD_HEADERS, LINES.coop)
      const result = gradeHeaders(parseHeaders(raw))
      expect(findField(result.fields, 'Cross-Origin-Opener-Policy')?.warn).toBe(true)
      expect(result.score).toBeLessThan(BASELINE_SCORE)
    })
  })

  describe('Cross-Origin-Resource-Policy', () => {
    it('flags a missing header', () => {
      const raw = omit(GOOD_HEADERS, LINES.corp)
      const result = gradeHeaders(parseHeaders(raw))
      expect(findField(result.fields, 'Cross-Origin-Resource-Policy')?.warn).toBe(true)
      expect(result.score).toBeLessThan(BASELINE_SCORE)
    })
  })

  describe('Access-Control-Allow-Origin', () => {
    it('flags a bare wildcard as a deduction, not a failure', () => {
      const raw = corrupt(GOOD_HEADERS, LINES.acao, 'Access-Control-Allow-Origin: *')
      const result = gradeHeaders(parseHeaders(raw))
      expect(findField(result.fields, 'Access-Control-Allow-Origin')?.warn).toBe(true)
      expect(result.score).toBeLessThan(BASELINE_SCORE)
      expect(result.grade).not.toBe('F')
    })

    it('forces grade F when the wildcard is combined with credentials', () => {
      const raw = `${corrupt(GOOD_HEADERS, LINES.acao, 'Access-Control-Allow-Origin: *')}\nAccess-Control-Allow-Credentials: true`
      const result = gradeHeaders(parseHeaders(raw))
      expect(findField(result.fields, 'Access-Control-Allow-Origin')?.warn).toBe(true)
      expect(result.grade).toBe('F')
      expect(result.score).toBe(0)
    })
  })
})

describe('gradeHeaders – Set-Cookie', () => {
  const first = 'Set-Cookie: a=1; HttpOnly; SameSite=Strict' // missing Secure
  const second = 'Set-Cookie: b=2; Secure; SameSite=Strict' // missing HttpOnly
  const withoutGoodCookie = omit(GOOD_HEADERS, LINES.cookie)
  const raw = `${withoutGoodCookie}\n${first}\n${second}`

  it('produces one field per repeated Set-Cookie value', () => {
    const result = gradeHeaders(parseHeaders(raw))
    const cookieFields = result.fields.filter((field) => field.label.startsWith('Set-Cookie'))
    expect(cookieFields).toHaveLength(2)
  })

  it('flags the cookie missing Secure', () => {
    const result = gradeHeaders(parseHeaders(raw))
    const cookieFields = result.fields.filter((field) => field.label.startsWith('Set-Cookie'))
    expect(cookieFields[0].warn).toBe(true)
    expect(cookieFields[0].value).toContain('Secure')
  })

  it('flags the cookie missing HttpOnly', () => {
    const result = gradeHeaders(parseHeaders(raw))
    const cookieFields = result.fields.filter((field) => field.label.startsWith('Set-Cookie'))
    expect(cookieFields[1].warn).toBe(true)
    expect(cookieFields[1].value).toContain('HttpOnly')
  })

  it('reflects both deductions in the combined score', () => {
    const both = gradeHeaders(parseHeaders(raw)).score
    const onlyFirst = gradeHeaders(parseHeaders(`${withoutGoodCookie}\n${first}`)).score
    expect(both).toBeLessThan(onlyFirst)
    expect(onlyFirst).toBeLessThan(BASELINE_SCORE)
  })
})

describe('gradeHeaders – frame-ancestors interaction', () => {
  it('notes the deprecation but does not warn when both are present', () => {
    const raw = "Content-Security-Policy: frame-ancestors 'none'\nX-Frame-Options: DENY"
    const result = gradeHeaders(parseHeaders(raw))
    const field = findField(result.fields, 'X-Frame-Options')
    expect(field?.warn).toBeFalsy()
    expect(field?.value).toContain('deprecated')
  })

  it('warns when both are absent', () => {
    const result = gradeHeaders(new Map())
    expect(findField(result.fields, 'X-Frame-Options')?.warn).toBe(true)
  })
})

describe('gradeHeaders – known-good', () => {
  it('gets the top grade with a score at or above 90', () => {
    const result = gradeHeaders(parseHeaders(GOOD_HEADERS))
    expect(result.grade).toBe('A+')
    expect(result.score).toBeGreaterThanOrEqual(90)
  })

  it('produces zero warn fields', () => {
    const result = gradeHeaders(parseHeaders(GOOD_HEADERS))
    expect(result.fields.some((field) => field.warn)).toBe(false)
  })
})

describe('the headers Tool', () => {
  describe('detect', () => {
    it('scores a raw HTTP header block above 0.7', () => {
      const raw = `${LINES.status}\n${GOOD_HEADERS}`
      expect(headers.detect?.(raw) ?? 0).toBeGreaterThan(0.7)
    })

    it('scores 0 on a JSON blob', () => {
      const json = '{\n  "status": 200,\n  "headers": {\n    "content-type": "text/html"\n  }\n}'
      expect(headers.detect?.(json)).toBe(0)
    })

    it('scores 0 on plain prose', () => {
      expect(headers.detect?.('This response looks fine to me, nothing unusual here.')).toBe(0)
    })
  })

  describe('run', () => {
    it('returns ok: true with empty output on empty input', () => {
      expect(headers.run('', {})).toEqual({ ok: true, output: '' })
    })

    it('returns a fields array and a grade in the output for a valid input', () => {
      const result = headers.run(GOOD_HEADERS, {})
      expect(result.fields?.length).toBeGreaterThan(0)
      expect(result.output).toContain('grade')
    })
  })
})
