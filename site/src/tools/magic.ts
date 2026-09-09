/*
 * Magic paste: the landing state of the `~/tools` page.
 *
 * The reader arrives with something in their clipboard, not with a tool in
 * mind. So the default pane runs every registered tool's `detect`, takes the
 * most confident guess and shows that tool's own result, with a row naming
 * what it decided and how sure it was. The chip that offers to switch to the
 * real tool is built from `ToolResult.detected`, which carries the tool id
 * rather than its display name — a link is a URL, and the URL wants the id.
 *
 * Nothing here fails loudly. A paste nothing recognises, a paste that is
 * empty, and a `detect` that throws are all ordinary `ok: true` states or a
 * score of zero: this is the first thing a reader sees, and a landing page
 * that renders an error because one tool's sniffer was handed input it did
 * not expect is worse than one that says "no idea, pick a tool".
 *
 * ## The registry cycle, and why this is a factory
 *
 * Magic needs the registry (to sweep every detector, and to settle ties by
 * sidebar order) and the registry needs magic (it is the first entry). A pair
 * of static imports would be a cycle whose outcome depends on which module is
 * loaded first: entering through `registry.ts` happens to work, entering
 * through `magic.ts` — which is exactly what `magic.test.ts` does — evaluates
 * the registry's `tools` array while `magic` is still uninitialised and dies
 * with a temporal-dead-zone `ReferenceError`.
 *
 * So this module imports no tools at all. It exports a factory, and
 * `registry.ts` hands it a `() => tools` accessor that is only ever called
 * from inside `run`, long after both modules have finished evaluating. The
 * dependency then points one way — registry to magic — and the tests get the
 * same seam for free: `createMagic` over a list of stubs is how tie-breaking
 * and throwing detectors are asserted without inventing fake tools that the
 * real registry would have to carry.
 */

import type { Tool, ToolField, ToolOptions, ToolResult } from './types.ts'

/** The tool's own id, which the detection sweep skips: magic declares no
 * `detect` of its own, but this also stops a future one being counted. */
const MAGIC_ID = 'magic'

/**
 * The confidence a guess has to beat — strictly — before magic acts on it.
 *
 * The tools' scores are calibrated against this number: base64 caps itself at
 * 0.7, hex scores all-digit input 0.5 so an epoch outranks it, and the
 * formats that are unmistakable (a JWT, a PEM block) sit at 0.95. Anything at
 * or below the line is reported as a guess rather than run.
 */
export const DETECTION_THRESHOLD = 0.6

/** What the empty pane says. The reader has not pasted anything yet, so this
 * is documentation, not an error. */
const INSTRUCTIONS = [
  'Paste anything.',
  '',
  'Magic paste runs every tool in the list against it and shows the best',
  'match: a JWT, a PEM certificate or CSR, an SSH public key, a base64 or hex',
  'blob, percent- or HTML-encoded text, a CIDR block, a unix timestamp.',
  '',
  'Everything runs in this tab. Nothing is uploaded.',
].join('\n')

/** One tool's opinion of the current input. */
interface Candidate {
  tool: Tool
  confidence: number
}

/** A confidence as the page shows it. Two digits of a 0..1 score reads like a
 * measurement it is not; a percentage reads like the guess it is. */
const percent = (confidence: number): string =>
  `${Math.round(confidence * 100)}%`

/**
 * One tool's score for `input`, clamped into 0..1.
 *
 * A `detect` that throws scores 0 rather than propagating: the detectors run
 * over whatever is in the clipboard, and one of them mishandling a hostile
 * paste must not take out the landing state. A non-finite score is treated
 * the same way — `NaN` sorts unpredictably and would poison the ranking.
 */
function score(tool: Tool, input: string): number {
  if (tool.detect === undefined) return 0
  try {
    const value = tool.detect(input)
    if (!Number.isFinite(value)) return 0
    return Math.min(1, Math.max(0, value))
  } catch {
    return 0
  }
}

/**
 * Every tool that can recognise something, best guess first.
 *
 * `Array.prototype.sort` is stable, so tools that score identically keep the
 * order the registry listed them in — which is the documented tie-break, and
 * the reason the registry's order is pinned rather than alphabetical.
 */
function rank(tools: readonly Tool[], input: string): Candidate[] {
  return tools
    .filter((tool) => tool.id !== MAGIC_ID && tool.detect !== undefined)
    .map((tool) => ({ tool, confidence: score(tool, input) }))
    .sort((left, right) => right.confidence - left.confidence)
}

/** The row that opens a dispatched result: what magic decided, and how sure
 * it was. The machine-readable half of the same statement travels in
 * `ToolResult.detected`. */
const detectionField = (candidate: Candidate): ToolField => ({
  label: 'Detected as',
  value: `${candidate.tool.name} — ${percent(candidate.confidence)} confidence`,
})

/**
 * The result for input nothing recognised confidently.
 *
 * `ok: true`: the tools all ran, and none of them claiming the input is a
 * fact about the input, not a failure. The near misses are named so the
 * reader can see *why* — a bare `deadbeef` scoring hex at 50% explains itself
 * better than silence — and capped at two, because a wall of zero-scoring
 * tools is the sidebar with extra steps.
 */
function noConfidentMatch(ranked: Candidate[]): ToolResult {
  const candidates = ranked.filter((candidate) => candidate.confidence > 0).slice(0, 2)

  if (candidates.length === 0) {
    return {
      ok: true,
      output: [
        'No tool recognised this input.',
        '',
        'Pick a tool from the list to run it anyway.',
      ].join('\n'),
    }
  }

  const lines = candidates.map(
    (candidate) => `  ${candidate.tool.name} — ${percent(candidate.confidence)}`,
  )

  return {
    ok: true,
    output: [
      `No tool recognised this input confidently (nothing scored above ${percent(
        DETECTION_THRESHOLD,
      )}).`,
      '',
      candidates.length === 1 ? 'Closest guess:' : 'Closest guesses:',
      ...lines,
      '',
      'Pick a tool from the list to run it anyway.',
    ].join('\n'),
    fields: candidates.map((candidate, index) => ({
      label: index === 0 ? 'Closest guess' : 'Runner-up',
      value: `${candidate.tool.id} — ${percent(candidate.confidence)}`,
    })),
  }
}

/**
 * Build the magic paste tool over a lazily-read tool list.
 *
 * `getTools` is called once per run, not once per module load: see the cycle
 * note at the top of the file. It is expected to return the registry, magic
 * included — the sweep filters magic out itself so the caller does not have
 * to hand over a doctored list.
 */
export function createMagic(getTools: () => readonly Tool[]): Tool {
  async function run(
    input: string,
    toolOptions: ToolOptions,
  ): Promise<ToolResult> {
    if (input.trim() === '') return { ok: true, output: INSTRUCTIONS }

    const ranked = rank(getTools(), input)
    const best = ranked[0]
    if (best === undefined || best.confidence <= DETECTION_THRESHOLD) {
      return noConfidentMatch(ranked)
    }

    // Awaited: `run` is allowed to be async — cert and jwt both are, because
    // they go through `crypto.subtle` — and magic has to return the resolved
    // result, not a promise wearing a detection row.
    //
    // The options are passed straight through. Magic declares none of its
    // own, so this is normally `{}`; when a shared link carries the delegated
    // tool's options, honouring them is what makes that link reproduce what
    // the sender saw.
    const result = await best.tool.run(input, toolOptions)

    return {
      ...result,
      fields: [detectionField(best), ...(result.fields ?? [])],
      detected: { toolId: best.tool.id, confidence: best.confidence },
    }
  }

  return {
    id: MAGIC_ID,
    name: 'magic paste',
    // No `detect` on purpose: magic recognises nothing itself, it asks. A
    // score here would enter its own sweep and rank against the tools it is
    // dispatching to.
    run,
  }
}
