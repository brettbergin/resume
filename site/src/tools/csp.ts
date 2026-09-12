/*
 * Content-Security-Policy evaluator: parse a policy string into its
 * directives and flag the sources and gaps that make a CSP weaker than it
 * looks, alongside the sources that make it stronger.
 *
 * `analyzeCSP` is exported on its own, separate from the `Tool` object,
 * because the HTTP header grader (a later tool in this same toolbox) needs to
 * run the same analysis over whatever `content-security-policy` header it
 * finds — duplicating the directive parsing there would drift the moment
 * either copy changed a rule.
 *
 * The parse itself is the one the spec describes: split on `;` for
 * directives, then on whitespace for the directive name and its source list.
 * Nothing here fetches a policy or resolves a host; it only ever looks at the
 * string it was given.
 */

import type {
  Tool,
  ToolField,
  ToolOptions,
  ToolResult,
} from './types.ts'

/** One thing `analyzeCSP` noticed, positive or negative. `directive` is the
 * directive it concerns — including a directive that is entirely absent from
 * the policy, named as itself rather than left to a generic label — so a
 * caller can group or link findings back to the part of the policy that
 * produced them. */
export interface CSPFinding {
  directive: string
  message: string
}

/** The whole verdict on a policy: what to fix, and what is already doing its
 * job. Kept separate rather than one flat list because the pane (and the
 * header grader) show them differently — warnings drive the "is this policy
 * OK" verdict, positives do not. */
export interface CSPAnalysis {
  warnings: CSPFinding[]
  positives: CSPFinding[]
}

/** A source that is nothing but a scheme, `https:` or `blob:` or `data:`: it
 * allows any host reachable over that scheme, which is rarely what whoever
 * wrote the policy meant. A source like `https://example.com` does not match
 * — the colon has to be the last character. */
const SCHEME_ONLY = /^[a-z][a-z0-9+.-]*:$/i

/** `'nonce-…'`, quoted the way a policy actually writes it. */
const NONCE_SOURCE = /^'nonce-[^']+'$/i

/** `'sha256-…'`, `'sha384-…'` or `'sha512-…'`, quoted. */
const HASH_SOURCE = /^'sha(?:256|384|512)-[^']+'$/i

/** Directives whose source list is worth checking for a nonce or a hash. Any
 * other directive can carry one too, but a nonce on `img-src` is not doing
 * the job a CSP nonce exists for. */
const NONCE_HASH_DIRECTIVES = new Set(['script-src', 'style-src'])

interface Directive {
  name: string
  sources: string[]
}

/** The policy split into directives, each split into a lowercased name and
 * its raw source list. Directive names are case-insensitive in the spec;
 * sources are left as written, since `'unsafe-inline'` and a scheme are
 * compared against known literal forms rather than reformatted. */
function parseDirectives(policy: string): Directive[] {
  return policy
    .split(';')
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk !== '')
    .map((chunk) => {
      const tokens = chunk.split(/\s+/)
      return { name: tokens[0].toLowerCase(), sources: tokens.slice(1) }
    })
}

function checkSource(
  directive: Directive,
  source: string,
  warnings: CSPFinding[],
  positives: CSPFinding[],
): void {
  const lower = source.toLowerCase()

  if (lower === "'unsafe-inline'") {
    warnings.push({
      directive: directive.name,
      message: "'unsafe-inline' allows inline scripts or styles to run, defeating the point of a CSP",
    })
  }
  if (lower === "'unsafe-eval'") {
    warnings.push({
      directive: directive.name,
      message: "'unsafe-eval' allows eval() and similar string-to-code execution",
    })
  }
  if (source === '*') {
    warnings.push({
      directive: directive.name,
      message: "a bare '*' allows sources from any origin",
    })
  }
  if (SCHEME_ONLY.test(source)) {
    warnings.push({
      directive: directive.name,
      message: `'${source}' is a scheme with no host, allowing any origin reachable over it`,
    })
  }
  if (directive.name === 'script-src' && lower === 'data:') {
    warnings.push({
      directive: directive.name,
      message: "'data:' in script-src allows script execution from data: URIs",
    })
  }

  if (NONCE_HASH_DIRECTIVES.has(directive.name)) {
    if (NONCE_SOURCE.test(source)) {
      positives.push({
        directive: directive.name,
        message: `uses a nonce source (${source})`,
      })
    }
    if (HASH_SOURCE.test(source)) {
      positives.push({
        directive: directive.name,
        message: `uses a hash source (${source})`,
      })
    }
  }
}

/** Parse and evaluate a Content-Security-Policy header value. Pure: no
 * network access, no knowledge of where the policy came from. */
export function analyzeCSP(policy: string): CSPAnalysis {
  const directives = parseDirectives(policy)
  const names = new Set(directives.map((directive) => directive.name))

  const warnings: CSPFinding[] = []
  const positives: CSPFinding[] = []

  for (const directive of directives) {
    for (const source of directive.sources) {
      checkSource(directive, source, warnings, positives)
    }
  }

  if (!names.has('object-src')) {
    warnings.push({
      directive: 'object-src',
      message: 'no object-src directive — plugin content falls back to default-src or is unrestricted',
    })
  }
  if (!names.has('base-uri')) {
    warnings.push({
      directive: 'base-uri',
      message: 'no base-uri directive — an injected <base> tag can hijack every relative URL on the page',
    })
  }
  if (!names.has('frame-ancestors')) {
    warnings.push({
      directive: 'frame-ancestors',
      message: 'no frame-ancestors directive — the page can be framed by any site, which is clickjacking',
    })
  }
  if (names.has('report-uri') && !names.has('report-to')) {
    warnings.push({
      directive: 'report-uri',
      message: 'report-uri with no report-to — report-uri is deprecated and ignored by newer browsers',
    })
  }

  return { warnings, positives }
}

/** A representative policy contains both a directive name — every real one
 * ends in `-src` — and the `;` that separates directives, which is enough to
 * outrank formats that merely share a character or two with a CSP. */
export function detect(input: string): number {
  const trimmed = input.trim()
  return trimmed.includes('-src') && trimmed.includes(';') ? 0.8 : 0
}

function describe(analysis: CSPAnalysis): string {
  if (analysis.warnings.length === 0 && analysis.positives.length === 0) {
    /* Reaching here means the policy declares object-src, base-uri and
     * frame-ancestors (each is warned on when absent) and none of its
     * sources tripped a warning check — a clean, if unremarkable, policy.
     * It is not a parse failure and should not read like one. */
    return 'No issues found — the policy looks clean, though it has no nonce or hash sources to report as a positive finding.'
  }

  const lines: string[] = []
  if (analysis.warnings.length > 0) {
    lines.push(`Warnings (${analysis.warnings.length}):`)
    for (const finding of analysis.warnings) {
      lines.push(`  ${finding.directive}: ${finding.message}`)
    }
  }
  if (analysis.positives.length > 0) {
    if (lines.length > 0) lines.push('')
    lines.push(`Positive findings (${analysis.positives.length}):`)
    for (const finding of analysis.positives) {
      lines.push(`  ${finding.directive}: ${finding.message}`)
    }
  }
  return lines.join('\n')
}

function run(input: string, _options: ToolOptions): ToolResult {
  if (input.trim() === '') return { ok: true, output: '' }

  const analysis = analyzeCSP(input)
  const fields: ToolField[] = [
    ...analysis.warnings.map((finding) => ({
      label: finding.directive,
      value: finding.message,
      warn: true,
    })),
    ...analysis.positives.map((finding) => ({
      label: finding.directive,
      value: finding.message,
    })),
  ]

  return {
    ok: analysis.warnings.length === 0,
    output: describe(analysis),
    fields,
  }
}

export const csp = {
  id: 'csp',
  name: 'CSP Evaluator',
  detect,
  run,
} satisfies Tool
