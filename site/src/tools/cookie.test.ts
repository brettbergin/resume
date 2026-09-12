import { describe, expect, it } from 'vitest'

import {
  analyzeCookie,
  cookie,
  detect,
  detectHeaderKind,
  parseCookieHeader,
  parseSetCookieHeader,
} from './cookie.ts'
import { detect as detectHeaders } from './headers.ts'
import type { ToolField } from './types.ts'

function findField(fields: ToolField[], label: string): ToolField | undefined {
  return fields.find((field) => field.label.includes(label))
}

describe('parseSetCookieHeader', () => {
  it('parses name, value and boolean attributes', () => {
    const parsed = parseSetCookieHeader('session=abc123; Secure; HttpOnly; SameSite=Strict; Path=/')
    expect(parsed.name).toBe('session')
    expect(parsed.value).toBe('abc123')
    expect(parsed.attributes.get('secure')).toBe(true)
    expect(parsed.attributes.get('httponly')).toBe(true)
    expect(parsed.attributes.get('samesite')).toBe('Strict')
    expect(parsed.attributes.get('path')).toBe('/')
  })

  it('strips a Set-Cookie: prefix, case-insensitively', () => {
    const parsed = parseSetCookieHeader('set-cookie: a=1; Secure')
    expect(parsed.name).toBe('a')
    expect(parsed.attributes.get('secure')).toBe(true)
  })

  it('treats attribute keys case-insensitively', () => {
    const parsed = parseSetCookieHeader('a=1; SECURE; httpONLY')
    expect(parsed.attributes.get('secure')).toBe(true)
    expect(parsed.attributes.get('httponly')).toBe(true)
  })

  it('parses Domain and Expires and Max-Age attributes', () => {
    const parsed = parseSetCookieHeader(
      'a=1; Domain=.example.com; Expires=Wed, 09 Jun 2027 10:18:14 GMT; Max-Age=3600',
    )
    expect(parsed.attributes.get('domain')).toBe('.example.com')
    expect(parsed.attributes.get('expires')).toBe('Wed, 09 Jun 2027 10:18:14 GMT')
    expect(parsed.attributes.get('max-age')).toBe('3600')
  })
})

describe('parseCookieHeader', () => {
  it('parses semicolon-separated name=value pairs', () => {
    const pairs = parseCookieHeader('a=1; b=2; c=3')
    expect(pairs).toEqual([
      { name: 'a', value: '1' },
      { name: 'b', value: '2' },
      { name: 'c', value: '3' },
    ])
  })

  it('strips a Cookie: prefix, case-insensitively', () => {
    const pairs = parseCookieHeader('cookie: a=1; b=2')
    expect(pairs).toEqual([
      { name: 'a', value: '1' },
      { name: 'b', value: '2' },
    ])
  })

  it('returns an empty array for a blank header', () => {
    expect(parseCookieHeader('Cookie: ')).toEqual([])
  })
})

describe('detectHeaderKind', () => {
  it('recognises an explicit Set-Cookie: prefix', () => {
    expect(detectHeaderKind('Set-Cookie: a=1')).toBe('set-cookie')
  })

  it('recognises an explicit Cookie: prefix', () => {
    expect(detectHeaderKind('Cookie: a=1; b=2')).toBe('cookie')
  })

  it('infers Set-Cookie from a known attribute keyword with no prefix', () => {
    expect(detectHeaderKind('a=1; Secure; HttpOnly')).toBe('set-cookie')
  })

  it('infers a Cookie header from bare name=value pairs with no prefix', () => {
    expect(detectHeaderKind('a=1; b=2; c=3')).toBe('cookie')
  })
})

describe('detect', () => {
  it('scores a representative Set-Cookie value above 0.6', () => {
    expect(detect('session=abc123; Secure; HttpOnly; SameSite=Strict')).toBeGreaterThan(0.6)
  })

  it('scores plain JSON as 0', () => {
    expect(detect('{"a": 1, "b": 2}')).toBe(0)
  })

  it('scores prose as 0', () => {
    expect(detect('the quick brown fox jumps over the lazy dog')).toBe(0)
  })

  it('scores a JWT as 0', () => {
    expect(
      detect(
        'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dQw4w9WgXcQ_v9U2XqO0K1ZLwYMOB_LzD2Uz1p8Sk0g',
      ),
    ).toBe(0)
  })

  it('scores 0 with no attribute keyword after the semicolon', () => {
    expect(detect('a=1; b=2; c=3')).toBe(0)
  })

  it('scores below headers.detect for a raw response pasted with its status line and headers', () => {
    const sample = [
      'HTTP/1.1 200 OK',
      'Date: Wed, 09 Jun 2027 10:18:14 GMT',
      'Content-Type: application/json',
      'Set-Cookie: session=abc123; Secure; HttpOnly; SameSite=Strict',
      'Content-Length: 348',
    ].join('\n')

    const cookieScore = detect(sample)
    const headersScore = detectHeaders(sample)

    expect(cookieScore).toBeLessThan(headersScore)
  })
})

describe('analyzeCookie', () => {
  const attrs = (pairs: [string, string | true][]) => new Map<string, string | true>(pairs)

  it('reports Secure, HttpOnly and SameSite when all are set', () => {
    const analysis = analyzeCookie('session', 'abc', attrs([
      ['secure', true],
      ['httponly', true],
      ['samesite', 'Strict'],
    ]), { isRequest: false })
    expect(analysis.secure).toBe(true)
    expect(analysis.httpOnly).toBe(true)
    expect(analysis.sameSite).toBe('Strict')
    expect(analysis.warnings).toEqual([])
  })

  it('warns on missing Secure for a response cookie', () => {
    const analysis = analyzeCookie('session', 'abc', attrs([['httponly', true], ['samesite', 'Strict']]), {
      isRequest: false,
    })
    expect(analysis.secure).toBe(false)
    expect(analysis.warnings.some((w) => w.includes('Secure'))).toBe(true)
  })

  it('warns on missing HttpOnly for a response cookie', () => {
    const analysis = analyzeCookie('session', 'abc', attrs([['secure', true], ['samesite', 'Strict']]), {
      isRequest: false,
    })
    expect(analysis.warnings.some((w) => w.includes('HttpOnly'))).toBe(true)
  })

  it('reports SameSite=Lax with no warning', () => {
    const analysis = analyzeCookie('session', 'abc', attrs([['secure', true], ['httponly', true], ['samesite', 'Lax']]), {
      isRequest: false,
    })
    expect(analysis.sameSite).toBe('Lax')
    expect(analysis.warnings.some((w) => w.includes('SameSite'))).toBe(false)
  })

  it('warns on missing SameSite for a response cookie', () => {
    const analysis = analyzeCookie('session', 'abc', attrs([['secure', true], ['httponly', true]]), {
      isRequest: false,
    })
    expect(analysis.sameSite).toBeNull()
    expect(analysis.warnings.some((w) => w.includes('SameSite'))).toBe(true)
  })

  it('warns on SameSite=None without Secure', () => {
    const analysis = analyzeCookie('session', 'abc', attrs([['httponly', true], ['samesite', 'None']]), {
      isRequest: false,
    })
    expect(analysis.warnings.some((w) => w.includes('SameSite=None'))).toBe(true)
  })

  it('does not warn on SameSite=None with Secure', () => {
    const analysis = analyzeCookie(
      'session',
      'abc',
      attrs([['secure', true], ['httponly', true], ['samesite', 'None']]),
      { isRequest: false },
    )
    expect(analysis.warnings.some((w) => w.includes('SameSite=None'))).toBe(false)
  })

  it('suppresses missing-attribute warnings for a request Cookie header', () => {
    const analysis = analyzeCookie('session', 'abc', attrs([]), { isRequest: true })
    expect(analysis.warnings).toEqual([])
  })

  it('reports session expiry when no Expires or Max-Age is present', () => {
    const analysis = analyzeCookie('a', '1', attrs([]), { isRequest: false })
    expect(analysis.expiry).toBe('session')
    expect(analysis.isSession).toBe(true)
  })

  it('reports an absolute expiry date from Expires', () => {
    const analysis = analyzeCookie('a', '1', attrs([['expires', 'Wed, 09 Jun 2027 10:18:14 GMT']]), {
      isRequest: false,
    })
    expect(analysis.isSession).toBe(false)
    expect(analysis.expiry).toBe(new Date('Wed, 09 Jun 2027 10:18:14 GMT').toISOString())
  })

  it('reports an absolute expiry date computed from Max-Age', () => {
    const before = Date.now()
    const analysis = analyzeCookie('a', '1', attrs([['max-age', '3600']]), { isRequest: false })
    const parsed = new Date(analysis.expiry).getTime()
    expect(analysis.isSession).toBe(false)
    expect(parsed).toBeGreaterThanOrEqual(before + 3600 * 1000 - 5000)
    expect(parsed).toBeLessThanOrEqual(Date.now() + 3600 * 1000 + 5000)
  })

  it('reports the Domain attribute value', () => {
    const analysis = analyzeCookie('a', '1', attrs([['domain', 'example.com']]), { isRequest: false })
    expect(analysis.domain).toBe('example.com')
  })

  it('reports null Domain when the attribute is absent', () => {
    const analysis = analyzeCookie('a', '1', attrs([]), { isRequest: false })
    expect(analysis.domain).toBeNull()
  })

  it('reports the Path attribute value', () => {
    const analysis = analyzeCookie('a', '1', attrs([['path', '/admin']]), { isRequest: false })
    expect(analysis.path).toBe('/admin')
  })

  it('reports null Path when the attribute is absent', () => {
    const analysis = analyzeCookie('a', '1', attrs([]), { isRequest: false })
    expect(analysis.path).toBeNull()
  })

  it('flags a Max-Age=0 cookie as already expired', () => {
    const analysis = analyzeCookie('a', '1', attrs([['max-age', '0']]), { isRequest: false })
    expect(analysis.isSession).toBe(false)
    expect(analysis.warnings.some((w) => w.includes('already expired'))).toBe(true)
  })

  it('does not flag a future Max-Age as expired', () => {
    const analysis = analyzeCookie('a', '1', attrs([['max-age', '3600']]), { isRequest: false })
    expect(analysis.warnings.some((w) => w.includes('already expired'))).toBe(false)
  })

  it('flags a Domain wider than the given host', () => {
    const analysis = analyzeCookie(
      'a',
      '1',
      attrs([['secure', true], ['httponly', true], ['samesite', 'Strict'], ['domain', '.example.com']]),
      { host: 'sub.example.com', isRequest: false },
    )
    expect(analysis.warnings.some((w) => w.includes('wider than host'))).toBe(true)
  })

  it('does not flag a Domain that exactly matches the host', () => {
    const analysis = analyzeCookie(
      'a',
      '1',
      attrs([['secure', true], ['httponly', true], ['samesite', 'Strict'], ['domain', 'example.com']]),
      { host: 'example.com', isRequest: false },
    )
    expect(analysis.warnings.some((w) => w.includes('wider than host'))).toBe(false)
  })

  it('reports Domain scope as unknown when no host is given', () => {
    const analysis = analyzeCookie('a', '1', attrs([['domain', '.example.com']]), { isRequest: false })
    expect(analysis.domainScopeUnknown).toBe(true)
  })

  it('does not report Domain scope as unknown when there is no Domain attribute at all', () => {
    const analysis = analyzeCookie('a', '1', attrs([]), { isRequest: false })
    expect(analysis.domainScopeUnknown).toBe(false)
  })

  it('flags a __Host- cookie missing Secure', () => {
    const analysis = analyzeCookie('__Host-session', 'abc', attrs([['path', '/']]), { isRequest: false })
    expect(analysis.warnings.some((w) => w.includes('__Host-') && w.includes('not Secure'))).toBe(true)
  })

  it('flags a __Host- cookie whose Path is not /', () => {
    const analysis = analyzeCookie(
      '__Host-session',
      'abc',
      attrs([['secure', true], ['path', '/account']]),
      { isRequest: false },
    )
    expect(analysis.warnings.some((w) => w.includes('__Host-') && w.includes('Path is not "/"'))).toBe(true)
  })

  it('flags a __Host- cookie that carries a Domain attribute', () => {
    const analysis = analyzeCookie(
      '__Host-session',
      'abc',
      attrs([['secure', true], ['path', '/'], ['domain', 'example.com']]),
      { isRequest: false },
    )
    expect(analysis.warnings.some((w) => w.includes('__Host-') && w.includes('carries a Domain attribute'))).toBe(
      true,
    )
  })

  it('does not flag a compliant __Host- cookie', () => {
    const analysis = analyzeCookie(
      '__Host-session',
      'abc',
      attrs([['secure', true], ['httponly', true], ['samesite', 'Strict'], ['path', '/']]),
      { isRequest: false },
    )
    expect(analysis.warnings.some((w) => w.includes('__Host-'))).toBe(false)
  })

  it('flags a __Secure- cookie missing Secure', () => {
    const analysis = analyzeCookie('__Secure-session', 'abc', attrs([]), { isRequest: false })
    expect(analysis.warnings.some((w) => w.includes('__Secure-'))).toBe(true)
  })

  it('does not flag a compliant __Secure- cookie', () => {
    const analysis = analyzeCookie('__Secure-session', 'abc', attrs([['secure', true]]), { isRequest: false })
    expect(analysis.warnings.some((w) => w.includes('__Secure-'))).toBe(false)
  })

  it('flags a name+value over the 4 KB boundary', () => {
    // 'name=' is 5 bytes; 4092 more bytes makes 4097 total, one over the limit.
    const bigValue = 'a'.repeat(4092)
    const analysis = analyzeCookie('name', bigValue, attrs([]), { isRequest: false })
    expect(analysis.warnings.some((w) => w.includes('4096-byte'))).toBe(true)
  })

  it('does not flag a name+value at exactly the 4 KB boundary', () => {
    // 'name=' is 5 bytes; 4091 more bytes makes exactly 4096 total.
    const okValue = 'a'.repeat(4091)
    const analysis = analyzeCookie('name', okValue, attrs([]), { isRequest: false })
    expect(analysis.warnings.some((w) => w.includes('4096-byte'))).toBe(false)
  })
})

describe('cookie tool', () => {
  it('returns ok with empty output on blank input', () => {
    const result = cookie.run('', {})
    expect(result).toEqual({ ok: true, output: '' })
  })

  it('reports all six security-relevant attributes for a well-formed Set-Cookie header', () => {
    const result = cookie.run(
      'Set-Cookie: session=abc123; Secure; HttpOnly; SameSite=Strict; Domain=example.com; Path=/; Expires=Wed, 09 Jun 2027 10:18:14 GMT',
      { host: 'example.com' },
    )
    expect(result.ok).toBe(true)
    const fields = result.fields ?? []
    expect(findField(fields, 'Secure')?.value).toBe('yes')
    expect(findField(fields, 'HttpOnly')?.value).toBe('yes')
    expect(findField(fields, 'SameSite')?.value).toBe('Strict')
    expect(findField(fields, 'Domain')?.value).toBe('example.com')
    expect(findField(fields, 'Path')?.value).toBe('/')
    expect(findField(fields, 'Expiry')?.value).toBe(new Date('Wed, 09 Jun 2027 10:18:14 GMT').toISOString())
    expect(fields.every((f) => f.warn !== true)).toBe(true)
  })

  it('notes the host was not supplied instead of asserting the Domain scope is safe', () => {
    const result = cookie.run(
      'Set-Cookie: a=1; Secure; HttpOnly; SameSite=Strict; Domain=.example.com',
      {},
    )
    const fields = result.fields ?? []
    const scopeField = findField(fields, 'Domain scope')
    expect(scopeField?.value).toContain('no host given')
    expect(fields.some((f) => f.value.includes('wider than host'))).toBe(false)
  })

  it('reports warnings as fields for a Set-Cookie header missing attributes', () => {
    const result = cookie.run('Set-Cookie: session=abc; Path=/', {})
    expect(result.ok).toBe(false)
    const secureField = findField(result.fields ?? [], 'Secure')
    const httpOnlyField = findField(result.fields ?? [], 'HttpOnly')
    expect(secureField?.warn).toBe(true)
    expect(httpOnlyField?.warn).toBe(true)
  })

  it('handles multiple Set-Cookie cookies in one paste', () => {
    const result = cookie.run(
      'Set-Cookie: a=1; Secure; HttpOnly; SameSite=Strict\nSet-Cookie: b=2; Path=/',
      {},
    )
    const fields = result.fields ?? []
    expect(fields.some((f) => f.label.startsWith('a:'))).toBe(true)
    expect(fields.some((f) => f.label.startsWith('b:'))).toBe(true)
  })

  it('does not emit missing-attribute warnings for a request Cookie header', () => {
    const result = cookie.run('Cookie: a=1; b=2', {})
    expect(result.ok).toBe(true)
    expect(result.output).toContain('not observable')
    expect((result.fields ?? []).every((f) => f.warn !== true)).toBe(true)
  })

  it('uses the host option to flag a wider Domain scope', () => {
    const result = cookie.run(
      'Set-Cookie: a=1; Secure; HttpOnly; SameSite=Strict; Domain=.example.com',
      { host: 'sub.example.com' },
    )
    const warningField = (result.fields ?? []).find((f) => f.value.includes('wider than host'))
    expect(warningField).toBeDefined()
  })

  it('is registered under id cookie with a host option', () => {
    expect(cookie.id).toBe('cookie')
    expect(cookie.options?.some((option) => option.key === 'host')).toBe(true)
  })
})
