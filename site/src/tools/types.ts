/*
 * The contract every tool on the `~/tools` page implements, and the only
 * thing the shared UI knows about a tool. `ToolPane` renders an input, an
 * output and an options row purely from these shapes, so a new tool is one
 * module plus one line in `registry.ts` — never a change to the pane.
 *
 * Types only, no data: `registry.ts` owns the list. Keeping the contract in
 * its own module lets `fragment.ts` and the individual tools import it
 * without pulling in every tool implementation behind the registry.
 *
 * Everything here runs in the browser. No tool takes a network dependency —
 * the whole point of the page is that a real token, certificate or secret can
 * be pasted into it — and `test/tools-no-network.test.ts` enforces that over
 * the source of every module in this directory.
 */

/** One labelled row in a result's structured table. `warn` marks a row the
 * reader should look at twice — an expired certificate, `alg: none`, a
 * signature that did not verify — and is styled, not just coloured. */
export interface ToolField {
  label: string
  value: string
  warn?: boolean
}

/** Which tool magic paste dispatched a run to, and how confident its `detect`
 * was. The id rather than the name because the page turns it into a link to
 * `#/tools/<id>` — the "detected as JWT, switch" chip — and a display name is
 * not a URL segment. */
export interface ToolDetection {
  toolId: string
  confidence: number
}

/** What a run produces. `output` is the primary text, rendered in a `<pre>`;
 * `fields` are the structured rows shown beside it. A failed run sets
 * `ok: false` and `error`, which renders inline rather than as an alert, and
 * may still carry a partial `output` — a malformed JWT whose header decoded
 * is more useful than an empty pane.
 *
 * `detected` is set only by the magic paste tool, and only when it dispatched
 * to another tool: everything else in the result then belongs to *that* tool,
 * which is what makes the switch chip worth offering. */
export interface ToolResult {
  ok: boolean
  output: string
  fields?: ToolField[]
  error?: string
  detected?: ToolDetection
}

/** One control in the pane's options row. Values are always strings, so the
 * pane needs no per-tool widget: `kind: 'select'` renders `choices`, and
 * `kind: 'text'` renders an input using `placeholder`.
 *
 * `secret: true` marks a value that is **never** written into the URL
 * fragment. An HMAC secret, a private key or a passphrase typed into a tool
 * must not travel in a link the reader then pastes into chat — the fragment
 * is the page's whole state-sharing mechanism, so the exclusion has to live
 * on the option itself rather than in whichever component happens to build
 * the URL. */
export interface ToolOption {
  key: string
  label: string
  kind: 'text' | 'select'
  default: string
  choices?: readonly { value: string; label: string }[]
  placeholder?: string
  secret?: boolean
}

/** An option map, keyed by `ToolOption.key`. String values throughout so the
 * whole map survives a round trip through the URL fragment unchanged. */
export type ToolOptions = Record<string, string>

/**
 * A single tool.
 *
 * `detect` returns a 0..1 confidence that the input is this tool's format.
 * The `magic` tool runs every registered `detect` and picks the highest score
 * above its threshold, so scores are comparable across tools and a format
 * that is a strict superset of another (a 10-digit epoch also being a valid
 * base64 alphabet string) has to be able to outrank it.
 *
 * `runFile` is part of the contract rather than something bolted onto the one
 * tool that needs it: the hash tool accepts a dropped file, and the pane only
 * offers a drop zone when this is present, which keeps the pane generic.
 *
 * `live: true` asks the pane to re-run the tool once a second — the JWT
 * tool's countdown to `exp` — so a tool never owns a timer itself.
 */
export interface Tool {
  id: string
  name: string
  options?: readonly ToolOption[]
  detect?: (input: string) => number
  run: (input: string, options: ToolOptions) => ToolResult | Promise<ToolResult>
  runFile?: (file: File) => Promise<ToolResult>
  live?: boolean
}
