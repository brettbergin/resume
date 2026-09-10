/*
 * JSON, four ways: is it valid and where exactly does it break, print it so a
 * human can read it, print it so a machine can eat it, and pull one value out
 * of a large document.
 *
 * The interesting half is the error location. `JSON.parse` throws a
 * `SyntaxError` whose message is engine-specific and the only place the offset
 * lives, so the location is recovered from the text of the message: V8 says
 * `... in JSON at position 18 (line 3 column 7)`, SpiderMonkey says
 * `... at line 3 column 7 of the JSON data`, and V8 drops the offset entirely
 * for its "unexpected token" form. Each shape gets a branch, and the offset is
 * turned into a line and column against the input the reader actually pasted —
 * "line 3, column 7" is the whole reason to paste a 400-line config in here,
 * and "Unexpected token" on its own is not that.
 *
 * Sorting keys is deep rather than top-level: the reason to sort is to diff
 * two documents that agree on content and disagree on key order, and a
 * top-level sort leaves every nested object still unaligned.
 *
 * The query language is a deliberate subset of JSONPath — dot properties,
 * bracket indexes and quoted keys, and `..` recursive descent. No filters, no
 * wildcards, no slices, no expression syntax: those are where JSONPath
 * implementations start evaluating parts of their input, and a tool whose
 * promise is that pasting a real secret into it is safe should not own an
 * expression evaluator. Everything here is `JSON.parse` and property lookup.
 */

import type {
  Tool,
  ToolField,
  ToolOption,
  ToolOptions,
  ToolResult,
} from './types.ts'

const options: readonly ToolOption[] = [
  {
    key: 'mode',
    label: 'Mode',
    kind: 'select',
    default: 'format',
    choices: [
      { value: 'validate', label: 'validate' },
      { value: 'format', label: 'format' },
      { value: 'minify', label: 'minify' },
      { value: 'sort-keys', label: 'sort keys' },
      { value: 'query', label: 'query' },
    ],
  },
  {
    key: 'indent',
    label: 'Indent',
    kind: 'select',
    default: '2',
    choices: [
      { value: '2', label: '2 spaces' },
      { value: '4', label: '4 spaces' },
      { value: 'tab', label: 'tab' },
    ],
  },
  {
    key: 'query',
    label: 'Query',
    kind: 'text',
    default: '$',
    placeholder: '$.store.book[0].title',
  },
]

const utf8 = new TextEncoder()

/** A JSON object, as far as this tool needs to know: a value that can be
 * indexed by key and is not an array. */
type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/* ------------------------------------------------------------------ parsing */

/** SpiderMonkey, and the parenthesised tail V8 has appended since Node 20 —
 * either way the engine has already done the counting. */
const LINE_COLUMN = /line (\d+) column (\d+)/

/** V8's offset, in the older form and inside the newer message alike. */
const POSITION = /at position (\d+)/

/** V8's "unexpected token" form, which carries the offending character and a
 * window of the input but no offset: `Unexpected token 'o', "[1, 2, nope" ...
 * is not valid JSON`. */
const UNEXPECTED_TOKEN = /Unexpected token '(.)'(?:, "(.*?)"(?:\.\.\.)?)?/s

/** Message tails that only exist to carry the location, stripped so the
 * composed error does not state it twice. */
const LOCATION_TAIL = [
  /\s*(?:in JSON )?at position \d+(?: \(line \d+ column \d+\))?\.?$/,
  /\s*at line \d+ column \d+ of the JSON data\.?$/,
]

interface Location {
  line: number
  column: number
}

/** Where `offset` falls in `input`, one-based in both axes. */
function locationOf(input: string, offset: number): Location {
  const head = input.slice(0, Math.max(0, offset))
  const lines = head.split('\n')
  return { line: lines.length, column: lines[lines.length - 1].length + 1 }
}

/** The offset V8 refuses to print for its "unexpected token" form, recovered
 * from the two things it does print: the window of input it quoted, and the
 * character it choked on. The window is matched back against the input to
 * find where it starts, then the character is found from there — for
 * `[1, 2, nope]` that is the `o` of `nope`, which is exactly the offset the
 * structured form would have reported. A best effort by construction: if
 * either lookup fails the caller falls back to the start of the input. */
function offsetFromToken(input: string, message: string): number | null {
  const match = UNEXPECTED_TOKEN.exec(message)
  if (match === null) return null
  const [, token, window] = match
  const start = window === undefined ? 0 : input.indexOf(window)
  if (start < 0) return null
  const offset = input.indexOf(token, start)
  return offset < 0 ? null : offset
}

/** The line and column a parse failure happened at. Every branch is an
 * engine's way of saying the same thing, tried best-first; the final fallback
 * is the start of the input, which is honest about being a guess in that it is
 * where a reader would start looking anyway. */
function errorLocation(input: string, error: SyntaxError): Location {
  const message = error.message
  const lineColumn = LINE_COLUMN.exec(message)
  if (lineColumn !== null) {
    return { line: Number(lineColumn[1]), column: Number(lineColumn[2]) }
  }

  const position = POSITION.exec(message)
  if (position !== null) return locationOf(input, Number(position[1]))

  // Not standard, but SpiderMonkey has historically carried the offset here
  // and reading it costs a property access.
  const carried = (error as SyntaxError & { position?: unknown }).position
  if (typeof carried === 'number') return locationOf(input, carried)

  // `Unexpected end of JSON input` is a truncated document: the failure is at
  // the point the input ran out.
  if (/end of (?:JSON )?input/i.test(message)) {
    return locationOf(input, input.length)
  }

  const fromToken = offsetFromToken(input, message)
  return locationOf(input, fromToken ?? 0)
}

/** The engine's message with any location tail removed, so
 * `Expected ':' after property name in JSON at position 18 (line 3 column 7)`
 * reduces to the part that says what was wrong. */
function reason(message: string): string {
  let text = message.replace(/^JSON\.parse:\s*/, '')
  for (const tail of LOCATION_TAIL) text = text.replace(tail, '')
  return text.trim()
}

/** `Invalid JSON at line 3, column 7: Expected ':' after property name`. */
function parseError(input: string, error: SyntaxError): string {
  const { line, column } = errorLocation(input, error)
  return `Invalid JSON at line ${line}, column ${column}: ${reason(error.message)}`
}

type Parsed = { ok: true; value: unknown } | { ok: false; error: string }

/** `JSON.parse` with the failure turned into the message every mode reports.
 * The one place in the file that catches, so the located error reads the same
 * whether the reader was validating, formatting or querying. */
function parseJson(input: string): Parsed {
  try {
    return { ok: true, value: JSON.parse(input) as unknown }
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof SyntaxError
          ? parseError(input, error)
          : `Invalid JSON: ${String(error)}`,
    }
  }
}

/* -------------------------------------------------------------- validate */

/** What the document is, at the top level, with the count that makes an
 * object or an array worth a second look. `null` is its own answer because
 * `typeof null` is not. */
function describeType(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) {
    return `array (${value.length} ${value.length === 1 ? 'item' : 'items'})`
  }
  if (isRecord(value)) {
    const keys = Object.keys(value).length
    return `object (${keys} ${keys === 1 ? 'key' : 'keys'})`
  }
  return typeof value
}

/** Does it parse, and if not, where does it break. The success rows are the
 * two facts a reader checks next: what the top-level value turned out to be —
 * an API that returned `[]` where an object was expected is a whole class of
 * bug — and how big the document is in UTF-8 bytes rather than characters,
 * since a size limit is always counted in bytes. */
export function validateJSON(input: string): ToolResult {
  const parsed = parseJson(input)
  if (!parsed.ok) return { ok: false, output: '', error: parsed.error }

  const fields: ToolField[] = [
    { label: 'Type', value: describeType(parsed.value) },
    { label: 'Size', value: `${utf8.encode(input).length} bytes` },
  ]
  return { ok: true, output: 'Valid JSON', fields }
}

/* -------------------------------------------------------------- formatting */

/** The `indent` option as `JSON.stringify` wants it: a string for tabs, a
 * width for spaces. An unknown value falls back to the option's own default
 * rather than throwing — the pane can only offer the three choices, but a
 * shared fragment carries whatever it carries. */
function indentOf(indent: string | undefined): string | number {
  if (indent === 'tab') return '\t'
  const width = Number.parseInt(indent ?? '', 10)
  return Number.isNaN(width) ? 2 : width
}

export function formatJSON(input: string, indent: string): ToolResult {
  const parsed = parseJson(input)
  if (!parsed.ok) return { ok: false, output: '', error: parsed.error }
  return { ok: true, output: JSON.stringify(parsed.value, null, indentOf(indent)) }
}

export function minifyJSON(input: string): ToolResult {
  const parsed = parseJson(input)
  if (!parsed.ok) return { ok: false, output: '', error: parsed.error }
  const output = JSON.stringify(parsed.value)
  const saved = utf8.encode(input).length - utf8.encode(output).length
  return {
    ok: true,
    output,
    fields: [{ label: 'Saved', value: `${saved} bytes` }],
  }
}

/** Every object's keys, sorted lexicographically, at every depth. Arrays keep
 * their order — an array's index is part of its meaning — but their elements
 * are still walked, so an object inside an array is sorted too. Primitives
 * pass through untouched.
 *
 * `Object.entries` rather than a `for ... in` so inherited keys cannot appear
 * in the output, and the sort is the default lexicographic one on purpose:
 * this exists to make two documents diffable, so the order only has to be the
 * same one every time, not a locale's idea of alphabetical. */
export function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep)
  if (!isRecord(value)) return value

  const sorted: JsonRecord = {}
  for (const key of Object.keys(value).sort()) {
    sorted[key] = sortKeysDeep(value[key])
  }
  return sorted
}

export function sortKeysJSON(input: string, indent: string): ToolResult {
  const parsed = parseJson(input)
  if (!parsed.ok) return { ok: false, output: '', error: parsed.error }
  return {
    ok: true,
    output: JSON.stringify(sortKeysDeep(parsed.value), null, indentOf(indent)),
  }
}

/* ------------------------------------------------------------- JSONPath-lite */

/** One navigation step. `prop` and `index` move one level; `descent` is
 * `..key`, which searches the whole subtree rather than one level. */
export type PathStep =
  | { type: 'prop'; key: string }
  | { type: 'index'; idx: number }
  | { type: 'descent'; key: string }

/** A dot-notation property name: anything up to the next step. Permissive
 * because JSON keys are, and `$.content-type` should work without the reader
 * reaching for quotes; a key containing `.`, `[` or `]` needs the bracket
 * form, which is what it is for. */
const DOT_NAME = /^[^.[\]]+/

/** `[0]`, `['key']`, `["key"]`. An integer is an array index and a quoted
 * string is a property, which is the only place this subset needs to tell
 * them apart. */
const BRACKET = /^\[(?:(\d+)|'([^']*)'|"([^"]*)")\]/

/** A path as the steps it names, or `null` when it is not one — an empty
 * string, a missing `$`, `$.`, `$[a]`, a trailing `.`. `null` rather than a
 * thrown error because an unparseable query is the normal state of a text box
 * someone is halfway through typing into, and the pane shows it as an error
 * on the option, not a crash. */
export function parsePath(path: string): PathStep[] | null {
  let rest = path.trim()
  if (!rest.startsWith('$')) return null
  rest = rest.slice(1)

  const steps: PathStep[] = []
  while (rest.length > 0) {
    if (rest.startsWith('..')) {
      const name = DOT_NAME.exec(rest.slice(2))
      if (name === null) return null
      steps.push({ type: 'descent', key: name[0] })
      rest = rest.slice(2 + name[0].length)
      continue
    }
    if (rest.startsWith('.')) {
      const name = DOT_NAME.exec(rest.slice(1))
      if (name === null) return null
      steps.push({ type: 'prop', key: name[0] })
      rest = rest.slice(1 + name[0].length)
      continue
    }
    const bracket = BRACKET.exec(rest)
    if (bracket === null) return null
    const [matched, index, single, double] = bracket
    if (index === undefined) {
      steps.push({ type: 'prop', key: single ?? double ?? '' })
    } else {
      steps.push({ type: 'index', idx: Number(index) })
    }
    rest = rest.slice(matched.length)
  }
  return steps
}

/** Every value under `value` held at `key`, depth-first, including matches
 * nested inside a match — `$..name` on a tree of named nodes should find the
 * children as well as the parents. Arrays are transparent: they are containers
 * on the way to objects, not something a key can live on. */
function descend(value: unknown, key: string, found: unknown[]): void {
  if (Array.isArray(value)) {
    for (const element of value) descend(element, key, found)
    return
  }
  if (!isRecord(value)) return
  for (const [name, child] of Object.entries(value)) {
    if (name === key) found.push(child)
    descend(child, key, found)
  }
}

/** The values a path selects, in document order. A step that does not apply —
 * a property on an array, an index past the end — drops the candidate rather
 * than failing, which is what makes `$.a.b` on a document without `a` a "no
 * match" and not an error.
 *
 * `Object.hasOwn` rather than a bare lookup so `$.constructor` selects nothing
 * on an object that has no such key, instead of reaching the prototype and
 * reporting a function as a match. */
export function queryPath(value: unknown, steps: readonly PathStep[]): unknown[] {
  let current: unknown[] = [value]
  for (const step of steps) {
    const next: unknown[] = []
    for (const candidate of current) {
      if (step.type === 'prop') {
        if (isRecord(candidate) && Object.hasOwn(candidate, step.key)) {
          next.push(candidate[step.key])
        }
      } else if (step.type === 'index') {
        if (Array.isArray(candidate) && step.idx < candidate.length) {
          next.push(candidate[step.idx])
        }
      } else {
        descend(candidate, step.key, next)
      }
    }
    current = next
  }
  return current
}

export function queryJSON(input: string, path: string): ToolResult {
  const parsed = parseJson(input)
  if (!parsed.ok) return { ok: false, output: '', error: parsed.error }

  const steps = parsePath(path)
  if (steps === null) {
    return {
      ok: false,
      output: '',
      error: `Invalid path: ${path.trim() || '(empty)'} — try $.a.b[0] or $..name`,
    }
  }

  const matches = queryPath(parsed.value, steps)
  if (matches.length === 0) return { ok: true, output: 'No match' }
  return {
    ok: true,
    output: JSON.stringify(matches, null, 2),
    fields: [{ label: 'Matches', value: String(matches.length) }],
  }
}

/* ------------------------------------------------------------------- tool */

function run(input: string, toolOptions: ToolOptions): ToolResult {
  if (input.trim() === '') return { ok: true, output: '' }

  switch (toolOptions.mode) {
    case 'validate':
      return validateJSON(input)
    case 'minify':
      return minifyJSON(input)
    case 'sort-keys':
      return sortKeysJSON(input, toolOptions.indent ?? '2')
    case 'query':
      return queryJSON(input, toolOptions.query ?? '$')
    default:
      return formatJSON(input, toolOptions.indent ?? '2')
  }
}

/** Anything `JSON.parse` accepts is JSON, but most of what it accepts is
 * something else first: `1699999999` is a valid JSON document and is always an
 * epoch, `"abc"` is a valid JSON document and is a string someone forgot to
 * unquote. So an object or an array — a document with structure, which no
 * other tool's format is — scores high enough to win magic paste outright,
 * and a bare scalar scores under the hex tool's 0.5 for all-digit input on
 * purpose, so it stays a near miss rather than the guess magic paste offers. */
function detect(input: string): number {
  const trimmed = input.trim()
  if (trimmed === '') return 0
  try {
    JSON.parse(trimmed)
  } catch {
    return 0
  }
  return trimmed.startsWith('{') || trimmed.startsWith('[') ? 0.85 : 0.4
}

export const json = {
  id: 'json',
  name: 'json',
  options,
  detect,
  run,
} satisfies Tool
