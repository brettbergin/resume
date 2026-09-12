import { describe, expect, it } from 'vitest'

import { analyzeCSP, csp } from './csp.ts'
import type { CSPFinding } from './csp.ts'

/*
 * Each warning type gets its own minimal policy: `object-src 'none'`,
 * `base-uri 'self'` and `frame-ancestors 'self'` are present in every fixture
 * unless the fixture is testing one of those three directives being absent,
 * so a test for one weakness is not incidentally also a test for three
 * others. `report-uri` and `report-to` are left out entirely unless the
 * fixture is testing that pair.
 */

const BASELINE = "object-src 'none'; base-uri 'self'; frame-ancestors 'self'"

const has = (findings: CSPFinding[], directive: string, fragment: string): boolean =>
  findings.some(
    (finding) => finding.directive === directive && finding.message.includes(fragment),
  )

describe('analyzeCSP warnings', () => {
  it('flags unsafe-inline in any directive', () => {
    const { warnings } = analyzeCSP(`script-src 'self' 'unsafe-inline'; ${BASELINE}`)
    expect(has(warnings, 'script-src', 'unsafe-inline')).toBe(true)
  })

  it('does not flag unsafe-inline on a clean policy', () => {
    const { warnings } = analyzeCSP(`script-src 'self'; ${BASELINE}`)
    expect(warnings.some((finding) => finding.message.includes('unsafe-inline'))).toBe(false)
  })

  it('flags unsafe-eval in any directive', () => {
    const { warnings } = analyzeCSP(`script-src 'self' 'unsafe-eval'; ${BASELINE}`)
    expect(has(warnings, 'script-src', 'unsafe-eval')).toBe(true)
  })

  it('does not flag unsafe-eval on a clean policy', () => {
    const { warnings } = analyzeCSP(`script-src 'self'; ${BASELINE}`)
    expect(warnings.some((finding) => finding.message.includes('unsafe-eval'))).toBe(false)
  })

  it('flags a bare wildcard source', () => {
    const { warnings } = analyzeCSP(`img-src *; script-src 'self'; ${BASELINE}`)
    expect(has(warnings, 'img-src', "'*'")).toBe(true)
  })

  it('does not flag a scoped wildcard like *.example.com', () => {
    const { warnings } = analyzeCSP(`img-src *.example.com; script-src 'self'; ${BASELINE}`)
    expect(warnings.some((finding) => finding.directive === 'img-src')).toBe(false)
  })

  it('flags a scheme-only source', () => {
    const { warnings } = analyzeCSP(`img-src https:; script-src 'self'; ${BASELINE}`)
    expect(has(warnings, 'img-src', 'https:')).toBe(true)
  })

  it('does not flag a full origin as scheme-only', () => {
    const { warnings } = analyzeCSP(`img-src https://example.com; script-src 'self'; ${BASELINE}`)
    expect(warnings.some((finding) => finding.directive === 'img-src')).toBe(false)
  })

  it('flags data: specifically in script-src', () => {
    const { warnings } = analyzeCSP(`script-src 'self' data:; ${BASELINE}`)
    expect(has(warnings, 'script-src', 'data: URIs')).toBe(true)
  })

  it('does not flag data: in a directive other than script-src', () => {
    const { warnings } = analyzeCSP(`img-src data:; script-src 'self'; ${BASELINE}`)
    expect(warnings.some((finding) => finding.message.includes('data: URIs'))).toBe(false)
  })

  it('flags a missing object-src directive', () => {
    const { warnings } = analyzeCSP("script-src 'self'; base-uri 'self'; frame-ancestors 'self'")
    expect(has(warnings, 'object-src', 'object-src')).toBe(true)
  })

  it('does not flag object-src when present', () => {
    const { warnings } = analyzeCSP(`script-src 'self'; ${BASELINE}`)
    expect(warnings.some((finding) => finding.directive === 'object-src')).toBe(false)
  })

  it('flags a missing base-uri directive', () => {
    const { warnings } = analyzeCSP("script-src 'self'; object-src 'none'; frame-ancestors 'self'")
    expect(has(warnings, 'base-uri', 'base-uri')).toBe(true)
  })

  it('does not flag base-uri when present', () => {
    const { warnings } = analyzeCSP(`script-src 'self'; ${BASELINE}`)
    expect(warnings.some((finding) => finding.directive === 'base-uri')).toBe(false)
  })

  it('flags a missing frame-ancestors directive', () => {
    const { warnings } = analyzeCSP("script-src 'self'; object-src 'none'; base-uri 'self'")
    expect(has(warnings, 'frame-ancestors', 'frame-ancestors')).toBe(true)
  })

  it('does not flag frame-ancestors when present', () => {
    const { warnings } = analyzeCSP(`script-src 'self'; ${BASELINE}`)
    expect(warnings.some((finding) => finding.directive === 'frame-ancestors')).toBe(false)
  })

  it('flags report-uri present without report-to', () => {
    const { warnings } = analyzeCSP(
      `script-src 'self'; ${BASELINE}; report-uri https://example.com/csp-report`,
    )
    expect(has(warnings, 'report-uri', 'report-to')).toBe(true)
  })

  it('does not flag report-uri when report-to is also present', () => {
    const { warnings } = analyzeCSP(
      `script-src 'self'; ${BASELINE}; report-uri https://example.com/csp-report; report-to default`,
    )
    expect(warnings.some((finding) => finding.directive === 'report-uri')).toBe(false)
  })

  it('does not flag anything when report-uri is absent', () => {
    const { warnings } = analyzeCSP(`script-src 'self'; ${BASELINE}`)
    expect(warnings.some((finding) => finding.message.includes('report-to'))).toBe(false)
  })
})

describe('analyzeCSP positives', () => {
  it('records a nonce source in script-src', () => {
    const { positives } = analyzeCSP(`script-src 'nonce-abc123'; ${BASELINE}`)
    expect(has(positives, 'script-src', 'nonce')).toBe(true)
  })

  it('records a nonce source in style-src', () => {
    const { positives } = analyzeCSP(`style-src 'nonce-abc123'; script-src 'self'; ${BASELINE}`)
    expect(has(positives, 'style-src', 'nonce')).toBe(true)
  })

  it('records sha256, sha384 and sha512 hash sources in script-src', () => {
    const { positives } = analyzeCSP(
      `script-src 'sha256-AAAA' 'sha384-BBBB' 'sha512-CCCC'; ${BASELINE}`,
    )
    expect(has(positives, 'script-src', 'sha256')).toBe(true)
    expect(has(positives, 'script-src', 'sha384')).toBe(true)
    expect(has(positives, 'script-src', 'sha512')).toBe(true)
  })

  it('records a hash source in style-src', () => {
    const { positives } = analyzeCSP(`style-src 'sha256-AAAA'; script-src 'self'; ${BASELINE}`)
    expect(has(positives, 'style-src', 'hash')).toBe(true)
  })

  it('does not record a nonce-shaped source outside script-src or style-src', () => {
    const { positives } = analyzeCSP(`img-src 'nonce-abc123'; script-src 'self'; ${BASELINE}`)
    expect(positives.some((finding) => finding.directive === 'img-src')).toBe(false)
  })
})

describe('a strong policy', () => {
  const STRONG =
    "default-src 'none'; script-src 'nonce-r4nd0m'; style-src 'nonce-r4nd0m'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; report-to default"

  it('produces zero warnings', () => {
    expect(analyzeCSP(STRONG).warnings).toEqual([])
  })

  it('produces at least one positive finding', () => {
    expect(analyzeCSP(STRONG).positives.length).toBeGreaterThan(0)
  })
})

describe('the csp Tool', () => {
  const run = (input: string) => csp.run(input, {}) as ReturnType<typeof csp.run> & { ok: boolean }

  it('returns ok: false and warning fields when the policy is weak', () => {
    const result = run("script-src 'unsafe-inline'")
    expect(result.ok).toBe(false)
    expect(result.fields?.some((field) => field.warn === true)).toBe(true)
    expect(result.output).toContain('unsafe-inline')
  })

  it('returns ok: true with no warning fields for a strong policy', () => {
    const result = run(
      "default-src 'none'; script-src 'nonce-r4nd0m'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; report-to default",
    )
    expect(result.ok).toBe(true)
    expect(result.fields?.some((field) => field.warn === true)).toBe(false)
    expect(result.fields?.length).toBeGreaterThan(0)
  })

  it('returns an empty result for empty input', () => {
    const result = run('')
    expect(result).toEqual({ ok: true, output: '' })
  })

  it('does not claim a clean policy with recognised directives has none', () => {
    const result = run("script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'")
    expect(result.ok).toBe(true)
    expect(result.output).not.toContain('no recognised directives')
    expect(result.output).toContain('looks clean')
  })

  it('detects a representative policy', () => {
    expect(csp.detect?.("default-src 'self'; script-src 'self'")).toBe(0.8)
  })

  it('does not detect input without both -src and a semicolon', () => {
    expect(csp.detect?.('just some text')).toBe(0)
    expect(csp.detect?.("default-src 'self'")).toBe(0)
  })
})
