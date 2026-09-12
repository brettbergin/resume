import { describe, expect, it } from 'vitest'

import { cvss, parseCvssVector, scoreCvss31, scoreCvss40, severityLabel, stringifyCvssVector } from './cvss.ts'

/*
 * The 3.1 and 4.0 vectors below are FIRST's own published examples (spec
 * sections 8/8.2 and the two specifications' worked examples), except the
 * 3.1 "Low" vector: FIRST does not publish a low-severity worked example, so
 * `AV:L/AC:H/PR:H/UI:R/S:U/C:L/I:L/A:L` is hand-derived from the 3.1 spec's
 * own Base equations (section 7.1) instead —
 *   Exploitability = 8.22 * 0.55(AV:L) * 0.44(AC:H) * 0.27(PR:H, unchanged) * 0.62(UI:R) = 0.333
 *   ISS = 1 - (1-0.22)^3 = 0.525448; Impact = 6.42 * ISS = 3.373
 *   Base = RoundUp(3.373 + 0.333) = RoundUp(3.706) = 3.8
 * which lands in the Low band (0.1-3.9), confirmed against this file's own
 * `scoreCvss31` run below.
 *
 * Round-trips are checked against every vector this file scores, so a
 * canonical-order or X-omission regression in `stringifyCvssVector` fails
 * the same tests that would catch a scoring regression.
 */

function expectRoundTrip(raw: string): void {
  const parsed = parseCvssVector(raw)
  expect(parsed, raw).not.toBeNull()
  if (parsed === null) return
  const restringified = stringifyCvssVector(parsed.version, parsed.metrics)
  expect(restringified, raw).toBe(raw)
  expect(parseCvssVector(restringified)).toEqual(parsed)
}

describe('scoreCvss31', () => {
  it('scores AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H as 9.8 Critical', () => {
    const raw = 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H'
    const parsed = parseCvssVector(raw)
    expect(parsed?.version).toBe('3.1')
    const { base } = scoreCvss31(parsed!.metrics)
    expect(base).toBeCloseTo(9.8, 5)
    expect(severityLabel(base)).toBe('Critical')
    expectRoundTrip(raw)
  })

  it('scores AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H as 10.0 Critical', () => {
    const raw = 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H'
    const parsed = parseCvssVector(raw)
    const { base } = scoreCvss31(parsed!.metrics)
    expect(base).toBeCloseTo(10.0, 5)
    expect(severityLabel(base)).toBe('Critical')
    expectRoundTrip(raw)
  })

  it('scores AV:L/AC:H/PR:H/UI:R/S:U/C:L/I:L/A:L as 3.8 Low', () => {
    const raw = 'CVSS:3.1/AV:L/AC:H/PR:H/UI:R/S:U/C:L/I:L/A:L'
    const parsed = parseCvssVector(raw)
    const { base } = scoreCvss31(parsed!.metrics)
    expect(base).toBeCloseTo(3.8, 5)
    expect(severityLabel(base)).toBe('Low')
    expectRoundTrip(raw)
  })

  it('scores a Temporal vector no higher than its Base score', () => {
    const raw = 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H/E:F/RL:O/RC:C'
    const parsed = parseCvssVector(raw)
    const { base, temporal } = scoreCvss31(parsed!.metrics)
    expect(temporal).toBeLessThanOrEqual(base)
    expect(temporal).toBeLessThan(base)
    expectRoundTrip(raw)
  })

  it('scores an Environmental vector differently from its Base score', () => {
    const raw = 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N/CR:H'
    const parsed = parseCvssVector(raw)
    const { base, environmental } = scoreCvss31(parsed!.metrics)
    expect(environmental).not.toBeCloseTo(base, 5)
    expectRoundTrip(raw)
  })
})

describe('scoreCvss40', () => {
  it('scores AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:H/SI:H/SA:H as 10.0 Critical', () => {
    const raw = 'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:H/SI:H/SA:H'
    const parsed = parseCvssVector(raw)
    expect(parsed?.version).toBe('4.0')
    const { base } = scoreCvss40(parsed!.metrics)
    expect(base).toBeCloseTo(10.0, 5)
    expect(severityLabel(base)).toBe('Critical')
    expectRoundTrip(raw)
  })

  it('scores AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N as 9.3 Critical', () => {
    const raw = 'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N'
    const parsed = parseCvssVector(raw)
    const { base } = scoreCvss40(parsed!.metrics)
    expect(base).toBeCloseTo(9.3, 5)
    expect(severityLabel(base)).toBe('Critical')
    expectRoundTrip(raw)
  })

  it('scores AV:N/AC:L/AT:N/PR:N/UI:N/VC:L/VI:N/VA:N/SC:N/SI:N/SA:N as 6.9 Medium', () => {
    const raw = 'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:L/VI:N/VA:N/SC:N/SI:N/SA:N'
    const parsed = parseCvssVector(raw)
    const { base } = scoreCvss40(parsed!.metrics)
    expect(base).toBeCloseTo(6.9, 5)
    expect(severityLabel(base)).toBe('Medium')
    expectRoundTrip(raw)
  })

  it('lowers the Threat score below Base when E reduces severity', () => {
    const raw = 'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:H/SI:H/SA:H/E:U'
    const parsed = parseCvssVector(raw)
    const { base, threat } = scoreCvss40(parsed!.metrics)
    expect(base).toBeCloseTo(10.0, 5)
    expect(threat).toBeLessThan(base)
    expectRoundTrip(raw)
  })

  it('rounds a score that lands just under a .x5 boundary in float up, not down', () => {
    // value - meanDistance evaluates to 5.6499999999999995 in JS float
    // arithmetic; the mathematically exact 5.65 rounds up to 5.7, matching
    // RedHat's cvss4.py and ae-cvss-calculator's Cvss4P0 reference scores.
    const raw = 'CVSS:4.0/AV:N/AC:H/AT:N/PR:H/UI:A/VC:H/VI:N/VA:L/SC:L/SI:L/SA:L'
    const parsed = parseCvssVector(raw)
    const { base } = scoreCvss40(parsed!.metrics)
    expect(base).toBeCloseTo(5.7, 5)
    expectRoundTrip(raw)
  })

  it('increments only EQ3 (not EQ6) when locating the next-lower macrovector for EQ3=1/EQ6=1', () => {
    // Macrovector 111001: EQ6 only has levels 0-1, so the lower macrovector
    // must be 112001 (EQ3 incremented alone), not the out-of-range 112002.
    const raw =
      'CVSS:4.0/AV:N/AC:H/AT:P/PR:H/UI:N/VC:L/VI:L/VA:L/SC:H/SI:H/SA:L/E:A/CR:M/IR:H/AR:H/MUI:P/MVC:H/MVI:N/MVA:N/MSC:H/MSI:L/MSA:S'
    const parsed = parseCvssVector(raw)
    const { environmental } = scoreCvss40(parsed!.metrics)
    expect(environmental).toBeCloseTo(7.3, 5)
    expectRoundTrip(raw)
  })
})

describe('parseCvssVector', () => {
  it('returns null for an empty string', () => {
    expect(parseCvssVector('')).toBeNull()
  })

  it('returns null for a string with no CVSS prefix', () => {
    expect(parseCvssVector('notcvss')).toBeNull()
  })

  it('returns null for an unsupported CVSS version', () => {
    expect(parseCvssVector('CVSS:2.0/AV:N')).toBeNull()
  })

  it('returns null for a 3.1 vector with an invalid metric value', () => {
    expect(parseCvssVector('CVSS:3.1/AV:Z/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H')).toBeNull()
  })

  it('parses a valid 3.1 vector', () => {
    expect(parseCvssVector('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H')).toEqual({
      version: '3.1',
      metrics: { AV: 'N', AC: 'L', PR: 'N', UI: 'N', S: 'U', C: 'H', I: 'H', A: 'H' },
    })
  })

  it('parses a valid 4.0 vector including supplemental metrics', () => {
    const raw = 'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:H/SI:H/SA:H/S:P/AU:Y'
    expect(parseCvssVector(raw)).toEqual({
      version: '4.0',
      metrics: {
        AV: 'N', AC: 'L', AT: 'N', PR: 'N', UI: 'N',
        VC: 'H', VI: 'H', VA: 'H', SC: 'H', SI: 'H', SA: 'H',
        S: 'P', AU: 'Y',
      },
    })
    expectRoundTrip(raw)
  })
})

describe('cvss.detect', () => {
  it('detects a 3.1 vector', () => {
    expect(cvss.detect?.('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H')).toBe(0.95)
  })

  it('detects a 4.0 vector', () => {
    expect(cvss.detect?.('CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:H/SI:H/SA:H')).toBe(0.95)
  })

  it('does not detect a JWT', () => {
    expect(
      cvss.detect?.(
        'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dQw4w9WgXcQ_rNVXmGiUw-tD4-5wRhoDzGWLTdRHkBs',
      ),
    ).toBe(0)
  })

  it('does not detect an empty string', () => {
    expect(cvss.detect?.('')).toBe(0)
  })
})

describe('cvss.run', () => {
  it('parses a pasted 3.1 vector into suggested options and clears the input', () => {
    const result = cvss.run('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H', {})
    expect(result.ok).toBe(true)
    expect(result.suggestedInput).toBe('')
    expect(result.suggestedOptions).toMatchObject({
      version: '3.1',
      AV: 'N',
      AC: 'L',
      PR: 'N',
      UI: 'N',
      S: 'U',
      VC: 'H',
      VI: 'H',
      VA: 'H',
    })
  })

  it('computes scores from explicit options when input is empty', () => {
    const result = cvss.run('', {
      version: '3.1',
      AV: 'N',
      AC: 'L',
      PR: 'N',
      UI: 'N',
      S: 'U',
      VC: 'H',
      VI: 'H',
      VA: 'H',
    })
    expect(result.ok).toBe(true)
    expect(result.output.startsWith('CVSS:3.1/')).toBe(true)
    const baseField = result.fields?.find((field) => field.label === 'Base Score')
    expect(baseField?.value).toContain('9.8')
  })

  it('rejects a string that is not a CVSS vector', () => {
    const result = cvss.run('not-a-vector', {})
    expect(result.ok).toBe(false)
  })

  it('produces a valid vector from empty input and default options', () => {
    const result = cvss.run('', {})
    expect(result.ok).toBe(true)
    expect(result.output.startsWith('CVSS:3.1/')).toBe(true)
  })
})

describe('severityLabel', () => {
  it('labels 0 as None', () => {
    expect(severityLabel(0)).toBe('None')
  })

  it('labels 0.1-3.9 as Low', () => {
    expect(severityLabel(0.1)).toBe('Low')
    expect(severityLabel(3.9)).toBe('Low')
  })

  it('labels 4.0-6.9 as Medium', () => {
    expect(severityLabel(4.0)).toBe('Medium')
    expect(severityLabel(6.9)).toBe('Medium')
  })

  it('labels 7.0-8.9 as High', () => {
    expect(severityLabel(7.0)).toBe('High')
    expect(severityLabel(8.9)).toBe('High')
  })

  it('labels 9.0-10.0 as Critical', () => {
    expect(severityLabel(9.0)).toBe('Critical')
    expect(severityLabel(10.0)).toBe('Critical')
  })
})
