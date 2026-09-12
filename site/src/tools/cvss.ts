/*
 * CVSS 3.1 and 4.0 vector parsing and scoring, as pure functions and data.
 *
 * `parseCvssVector` and `stringifyCvssVector` convert between the `CVSS:x.y/…`
 * wire format and a flat metric map so the tool UI (added separately) can
 * drive button groups off the map without re-parsing the string on every
 * click. `scoreCvss31` and `scoreCvss40` implement the FIRST scoring
 * algorithms directly from the specifications:
 *
 *   https://www.first.org/cvss/v3.1/specification-document
 *   https://www.first.org/cvss/v4.0/specification-document
 *
 * CVSS 4.0's Base score is not a standalone formula the way 3.1's is: the
 * spec's own reference algorithm folds Threat (E) and Environmental
 * (CR/IR/AR) into the same six-equivalence-class lookup used for every
 * score, defaulting E to its worst case (A) and CR/IR/AR to their worst
 * case (H) when unset. So `scoreCvss40`'s `base` is that lookup run with
 * only the eleven Base metrics supplied (E/CR/IR/AR at their defaults, no
 * Modified overrides); `threat` adds the actual E; `environmental` adds the
 * actual CR/IR/AR and Modified metrics on top of that. `CVSS40_LOOKUP` is
 * the ~270-entry mean-score table from the specification's reference
 * implementation, keyed by the six EQ levels as a six-digit string.
 */

import type {
  Tool,
  ToolField,
  ToolOption,
  ToolOptions,
  ToolResult,
} from './types.ts'

export type CvssVersion = '3.1' | '4.0'

type MetricValues = Record<string, readonly string[]>

const CVSS31_BASE_ORDER = ['AV', 'AC', 'PR', 'UI', 'S', 'C', 'I', 'A'] as const
const CVSS31_TEMPORAL_ORDER = ['E', 'RL', 'RC'] as const
const CVSS31_ENV_ORDER = [
  'CR', 'IR', 'AR',
  'MAV', 'MAC', 'MPR', 'MUI', 'MS', 'MC', 'MI', 'MA',
] as const

const CVSS31_REQUIRED_BASE = new Set<string>(CVSS31_BASE_ORDER)

const CVSS31_VALUES: MetricValues = {
  AV: ['N', 'A', 'L', 'P'],
  AC: ['L', 'H'],
  PR: ['N', 'L', 'H'],
  UI: ['N', 'R'],
  S: ['U', 'C'],
  C: ['N', 'L', 'H'],
  I: ['N', 'L', 'H'],
  A: ['N', 'L', 'H'],
  E: ['X', 'U', 'P', 'F', 'H'],
  RL: ['X', 'O', 'T', 'W', 'U'],
  RC: ['X', 'U', 'R', 'C'],
  CR: ['X', 'L', 'M', 'H'],
  IR: ['X', 'L', 'M', 'H'],
  AR: ['X', 'L', 'M', 'H'],
  MAV: ['X', 'N', 'A', 'L', 'P'],
  MAC: ['X', 'L', 'H'],
  MPR: ['X', 'N', 'L', 'H'],
  MUI: ['X', 'N', 'R'],
  MS: ['X', 'U', 'C'],
  MC: ['X', 'N', 'L', 'H'],
  MI: ['X', 'N', 'L', 'H'],
  MA: ['X', 'N', 'L', 'H'],
}

const CVSS40_BASE_ORDER = [
  'AV', 'AC', 'AT', 'PR', 'UI', 'VC', 'VI', 'VA', 'SC', 'SI', 'SA',
] as const
const CVSS40_THREAT_ORDER = ['E'] as const
const CVSS40_ENV_ORDER = [
  'CR', 'IR', 'AR',
  'MAV', 'MAC', 'MAT', 'MPR', 'MUI', 'MVC', 'MVI', 'MVA', 'MSC', 'MSI', 'MSA',
] as const
const CVSS40_SUPPLEMENTAL_ORDER = ['S', 'AU', 'R', 'V', 'RE', 'U'] as const

const CVSS40_REQUIRED_BASE = new Set<string>(CVSS40_BASE_ORDER)
const CVSS40_KNOWN_KEYS = new Set<string>([
  ...CVSS40_BASE_ORDER,
  ...CVSS40_THREAT_ORDER,
  ...CVSS40_ENV_ORDER,
  ...CVSS40_SUPPLEMENTAL_ORDER,
])

// The FIRST 4.0 spec gives Modified Subsequent Confidentiality/Integrity
// (MSI/MSA) an extra 'Safety' (S) value beyond the base H/L/N/X, used as a
// highest-severity override in the Base/Threat/Environmental algorithm below.
const CVSS40_VALUES: MetricValues = {
  AV: ['N', 'A', 'L', 'P'],
  AC: ['L', 'H'],
  AT: ['N', 'P'],
  PR: ['N', 'L', 'H'],
  UI: ['N', 'P', 'A'],
  VC: ['H', 'L', 'N'],
  VI: ['H', 'L', 'N'],
  VA: ['H', 'L', 'N'],
  SC: ['H', 'L', 'N'],
  SI: ['H', 'L', 'N'],
  SA: ['H', 'L', 'N'],
  E: ['X', 'A', 'P', 'U'],
  CR: ['X', 'H', 'M', 'L'],
  IR: ['X', 'H', 'M', 'L'],
  AR: ['X', 'H', 'M', 'L'],
  MAV: ['X', 'N', 'A', 'L', 'P'],
  MAC: ['X', 'L', 'H'],
  MAT: ['X', 'N', 'P'],
  MPR: ['X', 'N', 'L', 'H'],
  MUI: ['X', 'N', 'P', 'A'],
  MVC: ['X', 'H', 'L', 'N'],
  MVI: ['X', 'H', 'L', 'N'],
  MVA: ['X', 'H', 'L', 'N'],
  MSC: ['X', 'H', 'L', 'N'],
  MSI: ['X', 'S', 'H', 'L', 'N'],
  MSA: ['X', 'S', 'H', 'L', 'N'],
  S: ['X', 'N', 'P'],
  AU: ['X', 'N', 'Y'],
  R: ['X', 'A', 'U', 'I'],
  V: ['X', 'D', 'C'],
  RE: ['X', 'L', 'M', 'H'],
  U: ['X', 'Clear', 'Green', 'Amber', 'Red'],
}

/** Parses a `CVSS:3.1/…` or `CVSS:4.0/…` vector into its version and a flat
 * metric map. Returns `null` for a string with neither version prefix, a
 * malformed `key:value` segment, an unknown key in a 3.1 vector, or a known
 * key holding a value outside its defined choices. A 4.0 vector tolerates
 * keys it doesn't recognise — future Supplemental extensions — preserving
 * them unvalidated rather than failing the whole parse. Missing *required*
 * Base metrics do not cause a `null`: this only validates what's present: */
export function parseCvssVector(
  raw: string,
): { version: CvssVersion; metrics: Record<string, string> } | null {
  let version: CvssVersion
  if (raw.startsWith('CVSS:3.1/')) version = '3.1'
  else if (raw.startsWith('CVSS:4.0/')) version = '4.0'
  else return null

  const values = version === '3.1' ? CVSS31_VALUES : CVSS40_VALUES
  const body = raw.slice('CVSS:X.X/'.length)
  const metrics: Record<string, string> = {}

  for (const part of body.split('/')) {
    if (part === '') continue
    const sep = part.indexOf(':')
    if (sep <= 0) return null
    const key = part.slice(0, sep)
    const value = part.slice(sep + 1)
    const choices = values[key]
    if (!choices) {
      if (version === '4.0') {
        metrics[key] = value
        continue
      }
      return null
    }
    if (!choices.includes(value)) return null
    metrics[key] = value
  }

  return { version, metrics }
}

/** Produces `CVSS:3.1/AV:N/…` or `CVSS:4.0/AV:N/…` with metrics in the
 * canonical FIRST order for each group (Base, then Temporal/Threat, then
 * Environmental, then — 4.0 only — Supplemental). A metric holding the 'Not
 * Defined' sentinel `X` is omitted, since that's the wire format's way of
 * saying "unset", except a required Base metric always appears even if its
 * value is (incorrectly) `X`, so a malformed map can't silently lose one of
 * its eight or eleven mandatory metrics on the round trip. */
export function stringifyCvssVector(
  version: CvssVersion,
  metrics: Record<string, string>,
): string {
  const groups: readonly (readonly string[])[] =
    version === '3.1'
      ? [CVSS31_BASE_ORDER, CVSS31_TEMPORAL_ORDER, CVSS31_ENV_ORDER]
      : [CVSS40_BASE_ORDER, CVSS40_THREAT_ORDER, CVSS40_ENV_ORDER, CVSS40_SUPPLEMENTAL_ORDER]
  const required = version === '3.1' ? CVSS31_REQUIRED_BASE : CVSS40_REQUIRED_BASE

  const parts: string[] = []
  for (const group of groups) {
    for (const key of group) {
      const value = metrics[key]
      if (value === undefined) continue
      if (value === 'X' && !required.has(key)) continue
      parts.push(`${key}:${value}`)
    }
  }

  if (version === '4.0') {
    for (const key of Object.keys(metrics)) {
      if (CVSS40_KNOWN_KEYS.has(key)) continue
      const value = metrics[key]
      if (value === undefined || value === 'X') continue
      parts.push(`${key}:${value}`)
    }
  }

  return `CVSS:${version}/${parts.join('/')}`
}

/** 'None' (0.0), 'Low' (0.1–3.9), 'Medium' (4.0–6.9), 'High' (7.0–8.9) or
 * 'Critical' (9.0–10.0) — the same bands in both the 3.1 and 4.0 specs. */
export function severityLabel(score: number): string {
  if (score <= 0) return 'None'
  if (score < 4.0) return 'Low'
  if (score < 7.0) return 'Medium'
  if (score < 9.0) return 'High'
  return 'Critical'
}

// --- CVSS 3.1 ---------------------------------------------------------

const CVSS31_AV: Record<string, number> = { N: 0.85, A: 0.62, L: 0.55, P: 0.2 }
const CVSS31_AC: Record<string, number> = { L: 0.77, H: 0.44 }
const CVSS31_PR_UNCHANGED: Record<string, number> = { N: 0.85, L: 0.62, H: 0.27 }
const CVSS31_PR_CHANGED: Record<string, number> = { N: 0.85, L: 0.68, H: 0.5 }
const CVSS31_UI: Record<string, number> = { N: 0.85, R: 0.62 }
const CVSS31_CIA: Record<string, number> = { N: 0, L: 0.22, H: 0.56 }
const CVSS31_E: Record<string, number> = { X: 1, U: 0.91, P: 0.94, F: 0.97, H: 1 }
const CVSS31_RL: Record<string, number> = { X: 1, O: 0.95, T: 0.96, W: 0.97, U: 1 }
const CVSS31_RC: Record<string, number> = { X: 1, U: 0.92, R: 0.96, C: 1 }
const CVSS31_REQUIREMENT: Record<string, number> = { X: 1, L: 0.5, M: 1, H: 1.5 }

/** Appendix A's Roundup: ceil to one decimal place, not round-to-nearest —
 * scaling to an integer first sidesteps float error at the `.x5` boundary. */
function roundUp31(value: number): number {
  const scaled = Math.round(value * 100000)
  return scaled % 10000 === 0 ? scaled / 100000 : (Math.floor(scaled / 10000) + 1) / 10
}

/** CVSS 3.1 Base, Temporal and Environmental scores per sections 7.1–7.3 of
 * the specification. Environmental re-derives Impact and Exploitability from
 * the Modified base metrics (falling back to the un-modified value when a
 * Modified metric is `X`) and the CR/IR/AR requirement amplifiers, then
 * applies the same E/RL/RC factors as Temporal on top of that. */
export function scoreCvss31(
  metrics: Record<string, string>,
): { base: number; temporal: number; environmental: number } {
  const scope = metrics.S
  const prWeights = scope === 'C' ? CVSS31_PR_CHANGED : CVSS31_PR_UNCHANGED

  const c = CVSS31_CIA[metrics.C]
  const i = CVSS31_CIA[metrics.I]
  const a = CVSS31_CIA[metrics.A]
  const iss = 1 - (1 - c) * (1 - i) * (1 - a)
  const impact = scope === 'C'
    ? 7.52 * (iss - 0.029) - 3.25 * Math.pow(iss - 0.02, 15)
    : 6.42 * iss
  const exploitability =
    8.22 * CVSS31_AV[metrics.AV] * CVSS31_AC[metrics.AC] * prWeights[metrics.PR] * CVSS31_UI[metrics.UI]

  const base = impact <= 0
    ? 0
    : scope === 'C'
      ? roundUp31(Math.min(1.08 * (impact + exploitability), 10))
      : roundUp31(Math.min(impact + exploitability, 10))

  const e = CVSS31_E[metrics.E ?? 'X']
  const rl = CVSS31_RL[metrics.RL ?? 'X']
  const rc = CVSS31_RC[metrics.RC ?? 'X']
  const temporal = roundUp31(base * e * rl * rc)

  const mScope = metrics.MS && metrics.MS !== 'X' ? metrics.MS : scope
  const mPrWeights = mScope === 'C' ? CVSS31_PR_CHANGED : CVSS31_PR_UNCHANGED
  const mav = metrics.MAV && metrics.MAV !== 'X' ? metrics.MAV : metrics.AV
  const mac = metrics.MAC && metrics.MAC !== 'X' ? metrics.MAC : metrics.AC
  const mpr = metrics.MPR && metrics.MPR !== 'X' ? metrics.MPR : metrics.PR
  const mui = metrics.MUI && metrics.MUI !== 'X' ? metrics.MUI : metrics.UI
  const mc = metrics.MC && metrics.MC !== 'X' ? metrics.MC : metrics.C
  const mi = metrics.MI && metrics.MI !== 'X' ? metrics.MI : metrics.I
  const ma = metrics.MA && metrics.MA !== 'X' ? metrics.MA : metrics.A

  const cr = CVSS31_REQUIREMENT[metrics.CR ?? 'X']
  const ir = CVSS31_REQUIREMENT[metrics.IR ?? 'X']
  const ar = CVSS31_REQUIREMENT[metrics.AR ?? 'X']
  const miss = Math.min(
    1 - (1 - cr * CVSS31_CIA[mc]) * (1 - ir * CVSS31_CIA[mi]) * (1 - ar * CVSS31_CIA[ma]),
    0.915,
  )
  const modifiedImpact = mScope === 'C'
    ? 7.52 * (miss - 0.029) - 3.25 * Math.pow(miss * 0.9731 - 0.02, 13)
    : 6.42 * miss
  const modifiedExploitability =
    8.22 * CVSS31_AV[mav] * CVSS31_AC[mac] * mPrWeights[mpr] * CVSS31_UI[mui]

  const environmental = modifiedImpact <= 0
    ? 0
    : roundUp31(
        roundUp31(
          mScope === 'C'
            ? Math.min(1.08 * (modifiedImpact + modifiedExploitability), 10)
            : Math.min(modifiedImpact + modifiedExploitability, 10),
        ) * e * rl * rc,
      )

  return { base, temporal, environmental }
}

// --- CVSS 4.0 ---------------------------------------------------------

type PartialMetrics = Record<string, string>

/** The mean score for each reachable (EQ1,EQ2,EQ3,EQ4,EQ5,EQ6) combination, keyed
 * as a six-digit string, from the FIRST 4.0 specification's reference
 * implementation. Not every combination of levels is reachable (e.g. EQ3=2
 * requires VC, VI and VA all short of H, which makes EQ6=0 impossible), so
 * the table has ~270 entries rather than the full 3×2×3×3×3×2 = 324. */
const CVSS40_LOOKUP: Record<string, number> = {
    "000000": 10,
    "000001": 9.9,
    "000010": 9.8,
    "000011": 9.5,
    "000020": 9.5,
    "000021": 9.2,
    "000100": 10,
    "000101": 9.6,
    "000110": 9.3,
    "000111": 8.7,
    "000120": 9.1,
    "000121": 8.1,
    "000200": 9.3,
    "000201": 9,
    "000210": 8.9,
    "000211": 8,
    "000220": 8.1,
    "000221": 6.8,
    "001000": 9.8,
    "001001": 9.5,
    "001010": 9.5,
    "001011": 9.2,
    "001020": 9,
    "001021": 8.4,
    "001100": 9.3,
    "001101": 9.2,
    "001110": 8.9,
    "001111": 8.1,
    "001120": 8.1,
    "001121": 6.5,
    "001200": 8.8,
    "001201": 8,
    "001210": 7.8,
    "001211": 7,
    "001220": 6.9,
    "001221": 4.8,
    "002001": 9.2,
    "002011": 8.2,
    "002021": 7.2,
    "002101": 7.9,
    "002111": 6.9,
    "002121": 5,
    "002201": 6.9,
    "002211": 5.5,
    "002221": 2.7,
    "010000": 9.9,
    "010001": 9.7,
    "010010": 9.5,
    "010011": 9.2,
    "010020": 9.2,
    "010021": 8.5,
    "010100": 9.5,
    "010101": 9.1,
    "010110": 9,
    "010111": 8.3,
    "010120": 8.4,
    "010121": 7.1,
    "010200": 9.2,
    "010201": 8.1,
    "010210": 8.2,
    "010211": 7.1,
    "010220": 7.2,
    "010221": 5.3,
    "011000": 9.5,
    "011001": 9.3,
    "011010": 9.2,
    "011011": 8.5,
    "011020": 8.5,
    "011021": 7.3,
    "011100": 9.2,
    "011101": 8.2,
    "011110": 8,
    "011111": 7.2,
    "011120": 7,
    "011121": 5.9,
    "011200": 8.4,
    "011201": 7,
    "011210": 7.1,
    "011211": 5.2,
    "011220": 5,
    "011221": 3,
    "012001": 8.6,
    "012011": 7.5,
    "012021": 5.2,
    "012101": 7.1,
    "012111": 5.2,
    "012121": 2.9,
    "012201": 6.3,
    "012211": 2.9,
    "012221": 1.7,
    "100000": 9.8,
    "100001": 9.5,
    "100010": 9.4,
    "100011": 8.7,
    "100020": 9.1,
    "100021": 8.1,
    "100100": 9.4,
    "100101": 8.9,
    "100110": 8.6,
    "100111": 7.4,
    "100120": 7.7,
    "100121": 6.4,
    "100200": 8.7,
    "100201": 7.5,
    "100210": 7.4,
    "100211": 6.3,
    "100220": 6.3,
    "100221": 4.9,
    "101000": 9.4,
    "101001": 8.9,
    "101010": 8.8,
    "101011": 7.7,
    "101020": 7.6,
    "101021": 6.7,
    "101100": 8.6,
    "101101": 7.6,
    "101110": 7.4,
    "101111": 5.8,
    "101120": 5.9,
    "101121": 5,
    "101200": 7.2,
    "101201": 5.7,
    "101210": 5.7,
    "101211": 5.2,
    "101220": 5.2,
    "101221": 2.5,
    "102001": 8.3,
    "102011": 7,
    "102021": 5.4,
    "102101": 6.5,
    "102111": 5.8,
    "102121": 2.6,
    "102201": 5.3,
    "102211": 2.1,
    "102221": 1.3,
    "110000": 9.5,
    "110001": 9,
    "110010": 8.8,
    "110011": 7.6,
    "110020": 7.6,
    "110021": 7,
    "110100": 9,
    "110101": 7.7,
    "110110": 7.5,
    "110111": 6.2,
    "110120": 6.1,
    "110121": 5.3,
    "110200": 7.7,
    "110201": 6.6,
    "110210": 6.8,
    "110211": 5.9,
    "110220": 5.2,
    "110221": 3,
    "111000": 8.9,
    "111001": 7.8,
    "111010": 7.6,
    "111011": 6.7,
    "111020": 6.2,
    "111021": 5.8,
    "111100": 7.4,
    "111101": 5.9,
    "111110": 5.7,
    "111111": 5.7,
    "111120": 4.7,
    "111121": 2.3,
    "111200": 6.1,
    "111201": 5.2,
    "111210": 5.7,
    "111211": 2.9,
    "111220": 2.4,
    "111221": 1.6,
    "112001": 7.1,
    "112011": 5.9,
    "112021": 3,
    "112101": 5.8,
    "112111": 2.6,
    "112121": 1.5,
    "112201": 2.3,
    "112211": 1.3,
    "112221": 0.6,
    "200000": 9.3,
    "200001": 8.7,
    "200010": 8.6,
    "200011": 7.2,
    "200020": 7.5,
    "200021": 5.8,
    "200100": 8.6,
    "200101": 7.4,
    "200110": 7.4,
    "200111": 6.1,
    "200120": 5.6,
    "200121": 3.4,
    "200200": 7,
    "200201": 5.4,
    "200210": 5.2,
    "200211": 4,
    "200220": 4,
    "200221": 2.2,
    "201000": 8.5,
    "201001": 7.5,
    "201010": 7.4,
    "201011": 5.5,
    "201020": 6.2,
    "201021": 5.1,
    "201100": 7.2,
    "201101": 5.7,
    "201110": 5.5,
    "201111": 4.1,
    "201120": 4.6,
    "201121": 1.9,
    "201200": 5.3,
    "201201": 3.6,
    "201210": 3.4,
    "201211": 1.9,
    "201220": 1.9,
    "201221": 0.8,
    "202001": 6.4,
    "202011": 5.1,
    "202021": 2,
    "202101": 4.7,
    "202111": 2.1,
    "202121": 1.1,
    "202201": 2.4,
    "202211": 0.9,
    "202221": 0.4,
    "210000": 8.8,
    "210001": 7.5,
    "210010": 7.3,
    "210011": 5.3,
    "210020": 6,
    "210021": 5,
    "210100": 7.3,
    "210101": 5.5,
    "210110": 5.9,
    "210111": 4,
    "210120": 4.1,
    "210121": 2,
    "210200": 5.4,
    "210201": 4.3,
    "210210": 4.5,
    "210211": 2.2,
    "210220": 2,
    "210221": 1.1,
    "211000": 7.5,
    "211001": 5.5,
    "211010": 5.8,
    "211011": 4.5,
    "211020": 4,
    "211021": 2.1,
    "211100": 6.1,
    "211101": 5.1,
    "211110": 4.8,
    "211111": 1.8,
    "211120": 2,
    "211121": 0.9,
    "211200": 4.6,
    "211201": 1.8,
    "211210": 1.7,
    "211211": 0.7,
    "211220": 0.8,
    "211221": 0.2,
    "212001": 5.3,
    "212011": 2.4,
    "212021": 1.4,
    "212101": 2.4,
    "212111": 1.2,
    "212121": 0.5,
    "212201": 1,
    "212211": 0.3,
    "212221": 0.1,
};
const CVSS40_MAX_COMPOSED: {
  eq1: Record<number, PartialMetrics[]>
  eq2: Record<number, PartialMetrics[]>
  eq3: Record<number, Record<number, PartialMetrics[]>>
  eq4: Record<number, PartialMetrics[]>
  eq5: Record<number, PartialMetrics[]>
} = {
  eq1: {
    0: [{ AV: 'N', PR: 'N', UI: 'N' }],
    1: [{ AV: 'A', PR: 'N', UI: 'N' }, { AV: 'N', PR: 'L', UI: 'N' }, { AV: 'N', PR: 'N', UI: 'P' }],
    2: [{ AV: 'P', PR: 'N', UI: 'N' }, { AV: 'A', PR: 'L', UI: 'P' }],
  },
  eq2: {
    0: [{ AC: 'L', AT: 'N' }],
    1: [{ AC: 'H', AT: 'N' }, { AC: 'L', AT: 'P' }],
  },
  eq3: {
    0: {
      0: [{ VC: 'H', VI: 'H', VA: 'H', CR: 'H', IR: 'H', AR: 'H' }],
      1: [
        { VC: 'H', VI: 'H', VA: 'L', CR: 'M', IR: 'M', AR: 'H' },
        { VC: 'H', VI: 'H', VA: 'H', CR: 'M', IR: 'M', AR: 'M' },
      ],
    },
    1: {
      0: [
        { VC: 'L', VI: 'H', VA: 'H', CR: 'H', IR: 'H', AR: 'H' },
        { VC: 'H', VI: 'L', VA: 'H', CR: 'H', IR: 'H', AR: 'H' },
      ],
      1: [
        { VC: 'L', VI: 'H', VA: 'L', CR: 'H', IR: 'M', AR: 'H' },
        { VC: 'L', VI: 'H', VA: 'H', CR: 'H', IR: 'M', AR: 'M' },
        { VC: 'H', VI: 'L', VA: 'H', CR: 'M', IR: 'H', AR: 'M' },
        { VC: 'H', VI: 'L', VA: 'L', CR: 'M', IR: 'H', AR: 'H' },
        { VC: 'L', VI: 'L', VA: 'H', CR: 'H', IR: 'H', AR: 'M' },
      ],
    },
    2: {
      1: [{ VC: 'L', VI: 'L', VA: 'L', CR: 'H', IR: 'H', AR: 'H' }],
    },
  },
  eq4: {
    0: [{ SC: 'H', SI: 'S', SA: 'S' }],
    1: [{ SC: 'H', SI: 'H', SA: 'H' }],
    2: [{ SC: 'L', SI: 'L', SA: 'L' }],
  },
  eq5: {
    0: [{ E: 'A' }],
    1: [{ E: 'P' }],
    2: [{ E: 'U' }],
  },
}

const CVSS40_MAX_SEVERITY = {
  eq1: { 0: 1, 1: 4, 2: 5 } as Record<number, number>,
  eq2: { 0: 1, 1: 2 } as Record<number, number>,
  eq3eq6: { 0: { 0: 7, 1: 6 }, 1: { 0: 8, 1: 8 }, 2: { 1: 10 } } as Record<number, Record<number, number>>,
  eq4: { 0: 6, 1: 5, 2: 4 } as Record<number, number>,
}

const CVSS40_M_OVERRIDE: Record<string, string> = {
  AV: 'MAV', AC: 'MAC', AT: 'MAT', PR: 'MPR', UI: 'MUI',
  VC: 'MVC', VI: 'MVI', VA: 'MVA', SC: 'MSC', SI: 'MSI', SA: 'MSA',
}

/** A metric's effective value: Environmental Modified overrides its Base
 * counterpart when set to anything but `X`; E defaults to its worst case (A,
 * Attacked) and CR/IR/AR to theirs (H) when `X` or unset, per the spec's
 * "Metrics values" table for section 8.2. */
function m40(metrics: PartialMetrics, metric: string): string {
  const selected = metrics[metric]
  if (metric === 'E' && selected === 'X') return 'A'
  if ((metric === 'CR' || metric === 'IR' || metric === 'AR') && selected === 'X') return 'H'
  const modifiedKey = CVSS40_M_OVERRIDE[metric]
  if (modifiedKey !== undefined) {
    const modified = metrics[modifiedKey]
    if (modified !== undefined && modified !== 'X') return modified
  }
  return selected
}

/** The six Equivalence Class levels (section 8.2), as a six-digit string,
 * 0 being the highest-severity level in every class. */
function macroVector40(metrics: PartialMetrics): string {
  const av = m40(metrics, 'AV')
  const pr = m40(metrics, 'PR')
  const ui = m40(metrics, 'UI')
  let eq1: number
  if (av === 'N' && pr === 'N' && ui === 'N') eq1 = 0
  else if ((av === 'N' || pr === 'N' || ui === 'N') && av !== 'P') eq1 = 1
  else eq1 = 2

  const eq2 = m40(metrics, 'AC') === 'L' && m40(metrics, 'AT') === 'N' ? 0 : 1

  const vc = m40(metrics, 'VC')
  const vi = m40(metrics, 'VI')
  const va = m40(metrics, 'VA')
  let eq3: number
  if (vc === 'H' && vi === 'H') eq3 = 0
  else if (vc === 'H' || vi === 'H' || va === 'H') eq3 = 1
  else eq3 = 2

  const sc = m40(metrics, 'SC')
  const si = m40(metrics, 'SI')
  const sa = m40(metrics, 'SA')
  let eq4: number
  if (m40(metrics, 'MSI') === 'S' || m40(metrics, 'MSA') === 'S') eq4 = 0
  else if (sc === 'H' || si === 'H' || sa === 'H') eq4 = 1
  else eq4 = 2

  const e = m40(metrics, 'E')
  const eq5 = e === 'A' ? 0 : e === 'P' ? 1 : 2

  const cr = m40(metrics, 'CR')
  const ir = m40(metrics, 'IR')
  const ar = m40(metrics, 'AR')
  const eq6 =
    (cr === 'H' && vc === 'H') || (ir === 'H' && vi === 'H') || (ar === 'H' && va === 'H') ? 0 : 1

  return `${eq1}${eq2}${eq3}${eq4}${eq5}${eq6}`
}

const CVSS40_LEVELS: Record<string, Record<string, number>> = {
  AV: { N: 0, A: 0.1, L: 0.2, P: 0.3 },
  PR: { N: 0, L: 0.1, H: 0.2 },
  UI: { N: 0, P: 0.1, A: 0.2 },
  AC: { L: 0, H: 0.1 },
  AT: { N: 0, P: 0.1 },
  VC: { H: 0, L: 0.1, N: 0.2 },
  VI: { H: 0, L: 0.1, N: 0.2 },
  VA: { H: 0, L: 0.1, N: 0.2 },
  SC: { H: 0.1, L: 0.2, N: 0.3 },
  SI: { S: 0, H: 0.1, L: 0.2, N: 0.3 },
  SA: { S: 0, H: 0.1, L: 0.2, N: 0.3 },
  CR: { H: 0, M: 0.1, L: 0.2 },
  IR: { H: 0, M: 0.1, L: 0.2 },
  AR: { H: 0, M: 0.1, L: 0.2 },
}

const CVSS40_DISTANCE_KEYS = [
  'AV', 'PR', 'UI', 'AC', 'AT', 'VC', 'VI', 'VA', 'SC', 'SI', 'SA', 'CR', 'IR', 'AR',
]

function getEqMaxes(macro: string, eq: 1 | 2 | 3 | 4 | 5): PartialMetrics[] {
  if (eq === 1) return CVSS40_MAX_COMPOSED.eq1[Number(macro[0])]
  if (eq === 2) return CVSS40_MAX_COMPOSED.eq2[Number(macro[1])]
  if (eq === 3) return CVSS40_MAX_COMPOSED.eq3[Number(macro[2])][Number(macro[5])]
  if (eq === 4) return CVSS40_MAX_COMPOSED.eq4[Number(macro[3])]
  return CVSS40_MAX_COMPOSED.eq5[Number(macro[4])]
}

/** Section 8.2's scoring algorithm: locate the vector's MacroVector in
 * `CVSS40_LOOKUP`, then walk down from it by the weighted, distance-
 * normalised severity within each of the six Equivalence Classes. */
function cvssScore40(metrics: PartialMetrics, macro: string): number {
  if (['VC', 'VI', 'VA', 'SC', 'SI', 'SA'].every((k) => m40(metrics, k) === 'N')) return 0

  const value = CVSS40_LOOKUP[macro]
  const eq1 = Number(macro[0])
  const eq2 = Number(macro[1])
  const eq3 = Number(macro[2])
  const eq4 = Number(macro[3])
  const eq5 = Number(macro[4])
  const eq6 = Number(macro[5])

  const eq1LowerScore = CVSS40_LOOKUP[`${eq1 + 1}${eq2}${eq3}${eq4}${eq5}${eq6}`]
  const eq2LowerScore = CVSS40_LOOKUP[`${eq1}${eq2 + 1}${eq3}${eq4}${eq5}${eq6}`]
  const eq4LowerScore = CVSS40_LOOKUP[`${eq1}${eq2}${eq3}${eq4 + 1}${eq5}${eq6}`]
  const eq5LowerScore = CVSS40_LOOKUP[`${eq1}${eq2}${eq3}${eq4}${eq5 + 1}${eq6}`]

  let eq3eq6LowerScore: number
  if (eq3 === 1 && eq6 === 1) {
    eq3eq6LowerScore = CVSS40_LOOKUP[`${eq1}${eq2}${eq3 + 1}${eq4}${eq5}${eq6}`]
  } else if (eq3 === 0 && eq6 === 1) {
    eq3eq6LowerScore = CVSS40_LOOKUP[`${eq1}${eq2}${eq3 + 1}${eq4}${eq5}${eq6}`]
  } else if (eq3 === 1 && eq6 === 0) {
    eq3eq6LowerScore = CVSS40_LOOKUP[`${eq1}${eq2}${eq3}${eq4}${eq5}${eq6 + 1}`]
  } else if (eq3 === 0 && eq6 === 0) {
    const left = CVSS40_LOOKUP[`${eq1}${eq2}${eq3}${eq4}${eq5}${eq6 + 1}`]
    const right = CVSS40_LOOKUP[`${eq1}${eq2}${eq3 + 1}${eq4}${eq5}${eq6}`]
    eq3eq6LowerScore = left === undefined ? right : right === undefined ? left : Math.max(left, right)
  } else {
    eq3eq6LowerScore = CVSS40_LOOKUP[`${eq1}${eq2}${eq3 + 1}${eq4}${eq5}${eq6 + 1}`]
  }

  const maxVectors: PartialMetrics[] = []
  for (const v1 of getEqMaxes(macro, 1)) {
    for (const v2 of getEqMaxes(macro, 2)) {
      for (const v3 of getEqMaxes(macro, 3)) {
        for (const v4 of getEqMaxes(macro, 4)) {
          for (const v5 of getEqMaxes(macro, 5)) {
            maxVectors.push({ ...v1, ...v2, ...v3, ...v4, ...v5 })
          }
        }
      }
    }
  }

  let distances: Record<string, number> = {}
  for (const maxVector of maxVectors) {
    const candidate: Record<string, number> = {}
    for (const key of CVSS40_DISTANCE_KEYS) {
      candidate[key] = CVSS40_LEVELS[key][m40(metrics, key)] - CVSS40_LEVELS[key][maxVector[key]]
    }
    distances = candidate
    if (Object.values(candidate).every((d) => d >= 0)) break
  }

  const eq1Distance = distances.AV + distances.PR + distances.UI
  const eq2Distance = distances.AC + distances.AT
  const eq3eq6Distance =
    distances.VC + distances.VI + distances.VA + distances.CR + distances.IR + distances.AR
  const eq4Distance = distances.SC + distances.SI + distances.SA

  const step = 0.1
  const availableEq1 = value - eq1LowerScore
  const availableEq2 = value - eq2LowerScore
  const availableEq3eq6 = value - eq3eq6LowerScore
  const availableEq4 = value - eq4LowerScore
  const availableEq5 = value - eq5LowerScore

  const maxSeverityEq1 = CVSS40_MAX_SEVERITY.eq1[eq1] * step
  const maxSeverityEq2 = CVSS40_MAX_SEVERITY.eq2[eq2] * step
  const maxSeverityEq3eq6 = CVSS40_MAX_SEVERITY.eq3eq6[eq3][eq6] * step
  const maxSeverityEq4 = CVSS40_MAX_SEVERITY.eq4[eq4] * step

  let existingLower = 0
  let normalized = 0
  if (!Number.isNaN(availableEq1)) {
    existingLower += 1
    normalized += availableEq1 * (eq1Distance / maxSeverityEq1)
  }
  if (!Number.isNaN(availableEq2)) {
    existingLower += 1
    normalized += availableEq2 * (eq2Distance / maxSeverityEq2)
  }
  if (!Number.isNaN(availableEq3eq6)) {
    existingLower += 1
    normalized += availableEq3eq6 * (eq3eq6Distance / maxSeverityEq3eq6)
  }
  if (!Number.isNaN(availableEq4)) {
    existingLower += 1
    normalized += availableEq4 * (eq4Distance / maxSeverityEq4)
  }
  // EQ5's own severity distance is always 0: Threat has no metric within it
  // to be more or less severe than E itself, so it never adjusts the score,
  // but it still counts toward the number of EQs averaged over below.
  if (!Number.isNaN(availableEq5)) {
    existingLower += 1
  }

  const meanDistance = existingLower === 0 ? 0 : normalized / existingLower

  const score = Math.max(0, Math.min(10, value - meanDistance))
  // Guard against float error landing just under a .x5 boundary (e.g.
  // 8.6 - 7.15 = 1.4499999999999993), matching the epsilon reference
  // implementations (RedHat's cvss4.py `final_rounding()`) apply.
  return Math.round((score + 1e-9) * 10) / 10
}

function computeCvss40Score(rawMetrics: PartialMetrics): number {
  const metrics: PartialMetrics = { ...rawMetrics }
  if (metrics.E === undefined) metrics.E = 'X'
  if (metrics.CR === undefined) metrics.CR = 'X'
  if (metrics.IR === undefined) metrics.IR = 'X'
  if (metrics.AR === undefined) metrics.AR = 'X'
  return cvssScore40(metrics, macroVector40(metrics))
}

/** CVSS 4.0 Base, Threat and Environmental scores per section 8.2 of the
 * specification. `base` uses only the eleven Base metrics, with E and
 * CR/IR/AR at their worst-case defaults and no Modified overrides — the
 * spec's own algorithm has no separate Base-only formula, so this is that
 * same six-EQ lookup run with Threat and Environmental left unset. `threat`
 * adds the actual E; `environmental` adds the actual CR/IR/AR and any
 * Modified metrics on top of that. */
export function scoreCvss40(
  metrics: Record<string, string>,
): { base: number; threat: number; environmental: number } {
  const baseOnly: PartialMetrics = {}
  for (const key of CVSS40_BASE_ORDER) baseOnly[key] = metrics[key]

  const base = computeCvss40Score(baseOnly)

  const threatOnly: PartialMetrics = { ...baseOnly }
  if (metrics.E !== undefined) threatOnly.E = metrics.E
  const threat = computeCvss40Score(threatOnly)

  const environmental = computeCvss40Score({ ...metrics })

  return { base, threat, environmental }
}

// --- Tool ---------------------------------------------------------------

/*
 * The option keys below mirror the metric keys `parseCvssVector` and
 * `stringifyCvssVector` already use, *except* for two deliberate renames:
 *
 * - 3.1's bare `C`/`I`/`A` (Confidentiality/Integrity/Availability Impact)
 *   are exposed as `VC`/`VI`/`VA`, matching what 4.0 calls the same concept
 *   (Vulnerable System Impact) and letting the two versions share one
 *   button group per impact metric instead of two that mean the same thing.
 * - 4.0's Supplemental `S` (Safety) is exposed as `4_S`, because 3.1's own
 *   `S` (Scope) already claims that key and the two are unrelated metrics
 *   that happen to share a letter.
 *
 * Every other overlapping key (AV, AC, PR, CR, IR, AR, MAV, MAC, MPR) has an
 * identical choice set in both specifications, so one button group serves
 * both versions unmodified. `UI`/`MUI` are the one pair whose choice sets
 * genuinely differ (3.1: None/Required, 4.0: None/Passive/Active) — rather
 * than a second key, the button group offers the union of both and
 * `activeMetrics` below coerces a choice that is not valid in the active
 * version back to a value that is, since 'N' is valid in both.
 */

const NOT_DEFINED = { value: 'X', label: 'Not Defined' } as const

const AV_CHOICES = [
  { value: 'N', label: 'Network' },
  { value: 'A', label: 'Adjacent' },
  { value: 'L', label: 'Local' },
  { value: 'P', label: 'Physical' },
] as const
const AC_CHOICES = [
  { value: 'L', label: 'Low' },
  { value: 'H', label: 'High' },
] as const
const PR_CHOICES = [
  { value: 'N', label: 'None' },
  { value: 'L', label: 'Low' },
  { value: 'H', label: 'High' },
] as const
const UI_CHOICES = [
  { value: 'N', label: 'None' },
  { value: 'R', label: 'Required' },
  { value: 'P', label: 'Passive' },
  { value: 'A', label: 'Active' },
] as const
const CIA_CHOICES = [
  { value: 'N', label: 'None' },
  { value: 'L', label: 'Low' },
  { value: 'H', label: 'High' },
] as const
const REQUIREMENT_CHOICES = [
  NOT_DEFINED,
  { value: 'L', label: 'Low' },
  { value: 'M', label: 'Medium' },
  { value: 'H', label: 'High' },
] as const
function modified(
  choices: readonly { value: string; label: string }[],
): readonly { value: string; label: string }[] {
  return [NOT_DEFINED, ...choices]
}

const MODIFIED_CIA_CHOICES = modified(CIA_CHOICES)

const options: readonly ToolOption[] = [
  {
    key: 'version',
    label: 'Version',
    kind: 'select',
    default: '3.1',
    choices: [
      { value: '3.1', label: '3.1' },
      { value: '4.0', label: '4.0' },
    ],
  },

  // --- CVSS 3.1 Base ---
  { key: 'AV', label: 'Attack Vector', kind: 'button-group', default: 'P', choices: AV_CHOICES },
  { key: 'AC', label: 'Attack Complexity', kind: 'button-group', default: 'H', choices: AC_CHOICES },
  { key: 'PR', label: 'Privileges Required', kind: 'button-group', default: 'H', choices: PR_CHOICES },
  { key: 'UI', label: 'User Interaction', kind: 'button-group', default: 'R', choices: UI_CHOICES },
  {
    key: 'S',
    label: 'Scope',
    kind: 'button-group',
    default: 'U',
    choices: [
      { value: 'U', label: 'Unchanged' },
      { value: 'C', label: 'Changed' },
    ],
  },
  { key: 'VC', label: 'C', kind: 'button-group', default: 'N', choices: CIA_CHOICES },
  { key: 'VI', label: 'I', kind: 'button-group', default: 'N', choices: CIA_CHOICES },
  { key: 'VA', label: 'A', kind: 'button-group', default: 'N', choices: CIA_CHOICES },

  // --- CVSS 3.1 Temporal ---
  {
    key: 'E',
    label: 'Exploit Code Maturity',
    kind: 'button-group',
    default: 'X',
    choices: [
      NOT_DEFINED,
      { value: 'U', label: 'Unproven / Unreported' },
      { value: 'P', label: 'Proof-of-Concept' },
      { value: 'F', label: 'Functional' },
      { value: 'H', label: 'High' },
      { value: 'A', label: 'Attacked' },
    ],
  },
  {
    key: 'RL',
    label: 'Remediation Level',
    kind: 'button-group',
    default: 'X',
    choices: [
      NOT_DEFINED,
      { value: 'O', label: 'Official Fix' },
      { value: 'T', label: 'Temporary Fix' },
      { value: 'W', label: 'Workaround' },
      { value: 'U', label: 'Unavailable' },
    ],
  },
  {
    key: 'RC',
    label: 'Report Confidence',
    kind: 'button-group',
    default: 'X',
    choices: [
      NOT_DEFINED,
      { value: 'U', label: 'Unknown' },
      { value: 'R', label: 'Reasonable' },
      { value: 'C', label: 'Confirmed' },
    ],
  },

  // --- CVSS 3.1 Environmental ---
  { key: 'CR', label: 'Confidentiality Requirement', kind: 'button-group', default: 'X', choices: REQUIREMENT_CHOICES },
  { key: 'IR', label: 'Integrity Requirement', kind: 'button-group', default: 'X', choices: REQUIREMENT_CHOICES },
  { key: 'AR', label: 'Availability Requirement', kind: 'button-group', default: 'X', choices: REQUIREMENT_CHOICES },
  { key: 'MAV', label: 'Modified Attack Vector', kind: 'button-group', default: 'X', choices: modified(AV_CHOICES) },
  { key: 'MAC', label: 'Modified Attack Complexity', kind: 'button-group', default: 'X', choices: modified(AC_CHOICES) },
  { key: 'MPR', label: 'Modified Privileges Required', kind: 'button-group', default: 'X', choices: modified(PR_CHOICES) },
  { key: 'MUI', label: 'Modified User Interaction', kind: 'button-group', default: 'X', choices: [NOT_DEFINED, ...UI_CHOICES] },
  {
    key: 'MS',
    label: 'Modified Scope',
    kind: 'button-group',
    default: 'X',
    choices: [
      NOT_DEFINED,
      { value: 'U', label: 'Unchanged' },
      { value: 'C', label: 'Changed' },
    ],
  },
  { key: 'MC', label: 'Modified Confidentiality', kind: 'button-group', default: 'X', choices: MODIFIED_CIA_CHOICES },
  { key: 'MI', label: 'Modified Integrity', kind: 'button-group', default: 'X', choices: MODIFIED_CIA_CHOICES },
  { key: 'MA', label: 'Modified Availability', kind: 'button-group', default: 'X', choices: MODIFIED_CIA_CHOICES },

  // --- CVSS 4.0 Base (not already covered above) ---
  {
    key: 'AT',
    label: 'Attack Requirements',
    kind: 'button-group',
    default: 'P',
    choices: [
      { value: 'N', label: 'None' },
      { value: 'P', label: 'Present' },
    ],
  },
  { key: 'SC', label: 'Subsequent Confidentiality Impact', kind: 'button-group', default: 'N', choices: CIA_CHOICES },
  { key: 'SI', label: 'Subsequent Integrity Impact', kind: 'button-group', default: 'N', choices: CIA_CHOICES },
  { key: 'SA', label: 'Subsequent Availability Impact', kind: 'button-group', default: 'N', choices: CIA_CHOICES },

  // --- CVSS 4.0 Environmental (not already covered above) ---
  {
    key: 'MAT',
    label: 'Modified Attack Requirements',
    kind: 'button-group',
    default: 'X',
    choices: [
      NOT_DEFINED,
      { value: 'N', label: 'None' },
      { value: 'P', label: 'Present' },
    ],
  },
  { key: 'MVC', label: 'Modified Vulnerable Confidentiality', kind: 'button-group', default: 'X', choices: MODIFIED_CIA_CHOICES },
  { key: 'MVI', label: 'Modified Vulnerable Integrity', kind: 'button-group', default: 'X', choices: MODIFIED_CIA_CHOICES },
  { key: 'MVA', label: 'Modified Vulnerable Availability', kind: 'button-group', default: 'X', choices: MODIFIED_CIA_CHOICES },
  { key: 'MSC', label: 'Modified Subsequent Confidentiality', kind: 'button-group', default: 'X', choices: MODIFIED_CIA_CHOICES },
  {
    key: 'MSI',
    label: 'Modified Subsequent Integrity',
    kind: 'button-group',
    default: 'X',
    choices: [NOT_DEFINED, { value: 'S', label: 'Safety' }, ...CIA_CHOICES],
  },
  {
    key: 'MSA',
    label: 'Modified Subsequent Availability',
    kind: 'button-group',
    default: 'X',
    choices: [NOT_DEFINED, { value: 'S', label: 'Safety' }, ...CIA_CHOICES],
  },

  // --- CVSS 4.0 Supplemental (informational only; shown for 4.0) ---
  {
    key: '4_S',
    label: 'Safety',
    kind: 'button-group',
    default: 'X',
    choices: [
      NOT_DEFINED,
      { value: 'N', label: 'Negligible' },
      { value: 'P', label: 'Present' },
    ],
  },
  {
    key: 'AU',
    label: 'Automatable',
    kind: 'button-group',
    default: 'X',
    choices: [
      NOT_DEFINED,
      { value: 'N', label: 'No' },
      { value: 'Y', label: 'Yes' },
    ],
  },
  {
    key: 'R',
    label: 'Recovery',
    kind: 'button-group',
    default: 'X',
    choices: [
      NOT_DEFINED,
      { value: 'A', label: 'Automatic' },
      { value: 'U', label: 'User' },
      { value: 'I', label: 'Irrecoverable' },
    ],
  },
  {
    key: 'V',
    label: 'Value Density',
    kind: 'button-group',
    default: 'X',
    choices: [
      NOT_DEFINED,
      { value: 'D', label: 'Diffuse' },
      { value: 'C', label: 'Concentrated' },
    ],
  },
  {
    key: 'RE',
    label: 'Vulnerability Response Effort',
    kind: 'button-group',
    default: 'X',
    choices: REQUIREMENT_CHOICES,
  },
  {
    key: 'U',
    label: 'Provider Urgency',
    kind: 'button-group',
    default: 'X',
    choices: [
      NOT_DEFINED,
      { value: 'Clear', label: 'Clear' },
      { value: 'Green', label: 'Green' },
      { value: 'Amber', label: 'Amber' },
      { value: 'Red', label: 'Red' },
    ],
  },
]

/** The metric-map key (`CVSS31_VALUES`/`CVSS40_VALUES`) a metric holds an
 * out-of-range value in should fall back to, when the button group's union
 * of choices includes a value the active version does not accept. `'N'` is
 * valid in both `UI` domains; `'X'` (Not Defined) is valid everywhere else
 * a version mismatch can occur. */
function coerce(values: MetricValues, key: string, raw: string | undefined, fallback: string): string {
  const choices = values[key]
  if (choices !== undefined && raw !== undefined && choices.includes(raw)) return raw
  return fallback
}

/** The flat metric map `scoreCvss31`/`scoreCvss40`/`stringifyCvssVector`
 * expect, built from this tool's option values for whichever version is
 * currently active — translating the `VC`/`VI`/`VA` and `4_S` option keys
 * back to the wire keys they stand in for, and coercing `UI`/`MUI`/`E` back
 * into range if a button click left them holding a value only the other
 * version accepts. */
function activeMetrics(version: CvssVersion, options: ToolOptions): Record<string, string> {
  const values = version === '3.1' ? CVSS31_VALUES : CVSS40_VALUES
  const metrics: Record<string, string> = {
    AV: coerce(values, 'AV', options.AV, 'N'),
    AC: coerce(values, 'AC', options.AC, 'L'),
    PR: coerce(values, 'PR', options.PR, 'N'),
    UI: coerce(values, 'UI', options.UI, 'N'),
    E: coerce(values, 'E', options.E, 'X'),
    CR: coerce(values, 'CR', options.CR, 'X'),
    IR: coerce(values, 'IR', options.IR, 'X'),
    AR: coerce(values, 'AR', options.AR, 'X'),
    MAV: coerce(values, 'MAV', options.MAV, 'X'),
    MAC: coerce(values, 'MAC', options.MAC, 'X'),
    MPR: coerce(values, 'MPR', options.MPR, 'X'),
    MUI: coerce(values, 'MUI', options.MUI, 'X'),
  }

  if (version === '3.1') {
    metrics.S = options.S ?? 'U'
    metrics.C = options.VC ?? 'N'
    metrics.I = options.VI ?? 'N'
    metrics.A = options.VA ?? 'N'
    metrics.RL = options.RL ?? 'X'
    metrics.RC = options.RC ?? 'X'
    metrics.MS = options.MS ?? 'X'
    metrics.MC = options.MC ?? 'X'
    metrics.MI = options.MI ?? 'X'
    metrics.MA = options.MA ?? 'X'
  } else {
    metrics.AT = options.AT ?? 'N'
    metrics.VC = options.VC ?? 'N'
    metrics.VI = options.VI ?? 'N'
    metrics.VA = options.VA ?? 'N'
    metrics.SC = options.SC ?? 'N'
    metrics.SI = options.SI ?? 'N'
    metrics.SA = options.SA ?? 'N'
    metrics.MAT = options.MAT ?? 'X'
    metrics.MVC = options.MVC ?? 'X'
    metrics.MVI = options.MVI ?? 'X'
    metrics.MVA = options.MVA ?? 'X'
    metrics.MSC = options.MSC ?? 'X'
    metrics.MSI = options.MSI ?? 'X'
    metrics.MSA = options.MSA ?? 'X'
    metrics.S = options['4_S'] ?? 'X'
    metrics.AU = options.AU ?? 'X'
    metrics.R = options.R ?? 'X'
    metrics.V = options.V ?? 'X'
    metrics.RE = options.RE ?? 'X'
    metrics.U = options.U ?? 'X'
  }

  return metrics
}

/** The inverse of `activeMetrics`'s key translation: a parsed vector's
 * metric map (keyed exactly as `parseCvssVector` returns it) turned into
 * this tool's option keys, so a pasted vector can be merged straight into
 * `suggestedOptions`. */
function metricsToOptions(version: CvssVersion, metrics: Record<string, string>): ToolOptions {
  const out: ToolOptions = { version }
  for (const [key, value] of Object.entries(metrics)) {
    if (version === '3.1' && key === 'C') out.VC = value
    else if (version === '3.1' && key === 'I') out.VI = value
    else if (version === '3.1' && key === 'A') out.VA = value
    else if (version === '4.0' && key === 'S') out['4_S'] = value
    else out[key] = value
  }
  return out
}

const SEVERE = new Set(['Critical', 'High'])

function scoreFields(version: CvssVersion, metrics: Record<string, string>): ToolField[] {
  const severity = severityLabel(
    version === '3.1' ? scoreCvss31(metrics).base : scoreCvss40(metrics).base,
  )
  if (version === '3.1') {
    const { base, temporal, environmental } = scoreCvss31(metrics)
    return [
      { label: 'Base Score', value: base.toFixed(1), warn: base >= 9 },
      { label: 'Severity', value: severity, warn: SEVERE.has(severity) },
      { label: 'Temporal Score', value: temporal.toFixed(1), warn: temporal >= 7 },
      { label: 'Environmental Score', value: environmental.toFixed(1), warn: environmental >= 7 },
    ]
  }
  const { base, threat, environmental } = scoreCvss40(metrics)
  return [
    { label: 'Base Score', value: base.toFixed(1), warn: base >= 9 },
    { label: 'Severity', value: severity, warn: SEVERE.has(severity) },
    { label: 'Threat Score', value: threat.toFixed(1), warn: threat >= 7 },
    { label: 'Environmental Score', value: environmental.toFixed(1), warn: environmental >= 7 },
  ]
}

/** `CVSS:3.1/…` or `CVSS:4.0/…` at the very start of a paste, the same test
 * `parseCvssVector` uses to pick a version — confident enough to beat every
 * other tool's detector without a `parseCvssVector` call on every paste. */
function detect(input: string): number {
  const trimmed = input.trimStart()
  return trimmed.startsWith('CVSS:3.1/') || trimmed.startsWith('CVSS:4.0/') ? 0.95 : 0
}

function run(input: string, options: ToolOptions): ToolResult {
  const trimmed = input.trim()

  if (trimmed !== '') {
    const parsed = parseCvssVector(trimmed)
    if (parsed === null) {
      return { ok: false, output: '', error: 'Not a valid CVSS vector' }
    }
    return {
      ok: true,
      output: stringifyCvssVector(parsed.version, parsed.metrics),
      fields: scoreFields(parsed.version, parsed.metrics),
      suggestedOptions: metricsToOptions(parsed.version, parsed.metrics),
      suggestedInput: '',
    }
  }

  const version: CvssVersion = options.version === '4.0' ? '4.0' : '3.1'
  const metrics = activeMetrics(version, options)
  return {
    ok: true,
    output: stringifyCvssVector(version, metrics),
    fields: scoreFields(version, metrics),
  }
}

export const cvss = {
  id: 'cvss',
  name: 'CVSS',
  generates: false,
  sensitive: false,
  detect,
  options,
  run,
} satisfies Tool
