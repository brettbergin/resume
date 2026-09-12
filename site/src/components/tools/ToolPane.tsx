/*
 * The one pane every tool on the `~/tools` page is drawn in: a labelled input,
 * the tool's own option controls, an output, the structured rows beside it and
 * the two copy buttons. Nothing here knows what any particular tool does — the
 * whole surface comes from the `Tool` contract in src/tools/types.ts, so a new
 * tool is a module plus a registry line and never a change to this file.
 *
 * CONTROLLED, not stateful. The pane owns exactly one piece of state: the
 * result of the newest run. `input` and `options` arrive as props and every
 * edit leaves through `onChange`, carrying the complete next state:
 *
 *   <ToolPane tool={tool} input={input} options={options} onChange={setState} />
 *   // onChange({ input, options }) — both values, on every change
 *
 * That shape is not incidental. The page keeps its state in the URL fragment
 * (see src/tools/fragment.ts), so the owner has to be able to write the input
 * and the options into the hash as they change; a pane holding its own copy
 * would mean a shared link and the pane it opens disagreeing about what is
 * being decoded. The whole state goes out rather than a patch so the caller
 * can hand it straight to a `useState` setter or to the hash builder.
 *
 * Option values are resolved against `ToolOption.default` on the way in, so a
 * caller may pass `{}` — a link that names no options — and every control
 * still renders with a value. Keys the tool does not declare are dropped: the
 * options map comes off a URL, which is attacker-supplied text.
 *
 * Timing, which is most of the behaviour worth knowing:
 *
 * - Typing is debounced 150ms into `run`. Parsing a certificate or hashing a
 *   long paste on every keystroke is visibly slow, and the intermediate
 *   results are meaningless anyway.
 * - An option change re-runs at once: it is a deliberate click and the reader
 *   is already waiting to see what it did.
 * - `run` may be async, so every run carries a sequence number and a result
 *   is dropped unless it belongs to the newest one. Without that, a slow parse
 *   of a long input lands after a fast parse of a short one and the pane shows
 *   output for text that is no longer in the box.
 * - `tool.live` asks for a re-run once a second (the JWT tool's countdown to
 *   `exp`). The interval belongs to the pane rather than the tool, and is
 *   cleared on unmount and whenever the tool changes.
 * - An empty input shows nothing rather than running: every tool answers an
 *   empty string with an empty result, and rendering that is output nobody
 *   asked for. `tool.generates` is the exception — a generator has no input to
 *   be empty, so it runs anyway, is drawn without an input box, and gets a
 *   Generate button for the times the reader wants another value without
 *   changing an option.
 *
 * A failure is inline text in `text-accent` inside an `aria-live="polite"`
 * region: pasting half a token *is* the expected way to get one, so it is
 * never a `role="alert"` and never a dialog. The output `<pre>` is
 * deliberately not a live region — with `tool.live` on, a screen reader would
 * otherwise read the entire payload out once a second.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react'

import { FOCUS_RING, TAP_TARGET_HEIGHT } from '../../styles.ts'
import {
  MAX_HASH_INPUT_BYTES,
  buildToolHash,
  exceedsHashLimit,
} from '../../tools/fragment.ts'
import type { Tool, ToolOptions, ToolResult } from '../../tools/types.ts'

/** How quiet the input has to go before a run. Short enough that a paste feels
 * instant, long enough that typing a CIDR does not parse nine times. */
const DEBOUNCE_MS = 150

/** How often a `live` tool re-runs, matching the one-second granularity of the
 * countdown that needs it. */
const LIVE_INTERVAL_MS = 1000

/** Every button in the pane: the two copy buttons and a generator's Generate.
 * One constant so the 44px floor and the focus ring are declared once for the
 * set, the way the shell's other controls do it. */
const PANE_BUTTON = `inline-flex ${TAP_TARGET_HEIGHT} items-center justify-center rounded-pill border border-border-strong px-4 text-base text-text hover:text-accent disabled:border-border disabled:text-muted ${FOCUS_RING}`

/** The progress ring's own geometry: a 32px circle with a 4px stroke, sized
 * to sit beside a line of body text rather than dominate the pane. */
const RING_SIZE = 32
const RING_STROKE = 4
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

/** Every text box, select and file control in the pane. */
const CONTROL =
  'w-full min-h-11 rounded-card border border-border bg-surface p-3 font-mono text-base text-text'

/** The caption above each region of the pane. */
const CAPTION = 'text-base text-muted'

/** The drop zone's own text, which is both the instruction a reader sees and
 * the accessible name of the file input inside it. */
const FILE_ZONE_LABEL = 'Drop a file here, or choose one'

/** Why the share button is disabled. Derived from the ceiling itself so the
 * number in the tooltip cannot drift from the number that is enforced. */
const SHARE_LIMIT_TITLE = `This input is over ${MAX_HASH_INPUT_BYTES / 1024} KB, which is too long to carry in a link — shorten it to share it.`

/** The state the pane is given and hands back. */
export interface ToolPaneState {
  input: string
  options: ToolOptions
}

export interface ToolPaneProps extends ToolPaneState {
  tool: Tool
  onChange: (next: ToolPaneState) => void
  /** Told about each new result, for an owner that has to render something
   * outside the pane from it — the page's "detected as JWT, switch" chip,
   * which is a link out of the pane and so cannot live inside it. Optional,
   * and called with `null` when a run is cleared by an empty input. */
  onResult?: (result: ToolResult | null) => void
}

/** The options a run is given: every option the tool declares, at the value
 * the caller supplied or the option's own default, and nothing else. */
function resolveOptions(tool: Tool, options: ToolOptions): ToolOptions {
  const resolved: ToolOptions = {}
  for (const definition of tool.options ?? []) {
    resolved[definition.key] = options[definition.key] ?? definition.default
  }
  return resolved
}

/** What to show when a tool throws instead of returning `ok: false`. A tool
 * reports its own failures, so this is the backstop for a bug — a `TypeError`
 * out of a parser handed input it never considered. */
function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Copy, where the clipboard exists. Guarded rather than assumed: the API is
 * absent outside a secure context and in jsdom, and the button doing nothing
 * is a better answer there than the pane throwing. A denied permission is the
 * reader's own answer, so it is swallowed too. */
function copyToClipboard(text: string): void {
  const clipboard = navigator.clipboard as Clipboard | undefined
  if (clipboard === undefined) return
  void Promise.resolve(clipboard.writeText(text)).catch(() => {})
}

export function ToolPane({
  tool,
  input,
  options,
  onChange,
  onResult,
}: ToolPaneProps) {
  const [result, setResult] = useState<ToolResult | null>(null)

  const resolved = resolveOptions(tool, options)
  const optionsKey = JSON.stringify(resolved)

  /* The props as of the last commit, for the two callers that fire outside of
   * a render: the debounce timeout and the live interval. Both want the newest
   * values rather than whatever was captured when they were scheduled.
   *
   * Written in an effect rather than in the render body, and declared above
   * the effects that read it so it is already up to date by the time they run:
   * a render React discards must not leave its values behind in a ref. */
  const latest = useRef({ tool, input, options: resolved })
  useEffect(() => {
    latest.current = { tool, input, options: resolved }
  })

  /* The result listener, held in a ref and fired only when the result itself
   * changes: an owner passing an inline arrow — the ordinary way to write it —
   * would otherwise be called on every render of the pane, and a `live` tool
   * re-rendering once a second would turn that into a loop through whatever
   * state the owner keeps. */
  const resultListener = useRef(onResult)
  useEffect(() => {
    resultListener.current = onResult
  })
  useEffect(() => {
    resultListener.current?.(result)
  }, [result])

  /* `onChange` as of the last commit, for the same reason `latest` exists: a
   * run's result can suggest an input/option update (a pasted CVSS vector
   * turning into button-group selections) after an `await`, by which point a
   * `start()` closure captured at an earlier render must not call a stale
   * `onChange`. */
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  })

  /* The newest run's number. A result whose number is no longer this one
   * belongs to a superseded run and is dropped. */
  const sequence = useRef(0)

  /* What the last run was given, which is how the effect below tells an input
   * change (debounced) from a tool or option change (immediate). */
  const lastRun = useRef<{
    toolId: string
    input: string
    optionsKey: string
  } | null>(null)

  const start = useCallback(() => {
    const { tool: current, input: value, options: runOptions } = latest.current
    lastRun.current = {
      toolId: current.id,
      input: value,
      optionsKey: JSON.stringify(runOptions),
    }

    const id = ++sequence.current
    // Empty in, nothing shown: every tool returns an empty result for an
    // empty input, and rendering that is output the reader did not ask for.
    // A generator is the exception — it has no input to be empty, and the
    // whole reason it is on the page is the value it produces from nothing.
    if (value === '' && current.generates !== true) {
      setResult(null)
      return
    }

    void (async () => {
      try {
        const next = await current.run(value, runOptions)
        if (id === sequence.current) {
          setResult(next)
          // A run may suggest a replacement input and/or options — a pasted
          // CVSS vector turning into button-group selections. Applied at
          // most once per result, and only when it would actually change
          // something: otherwise a generator or a tool that never suggests
          // anything would re-fire `onChange` on every run.
          if (
            next.suggestedOptions !== undefined ||
            next.suggestedInput !== undefined
          ) {
            const updatedInput = next.suggestedInput ?? value
            const updatedOptions =
              next.suggestedOptions !== undefined
                ? { ...runOptions, ...next.suggestedOptions }
                : runOptions
            if (
              updatedInput !== value ||
              JSON.stringify(updatedOptions) !== JSON.stringify(runOptions)
            ) {
              onChangeRef.current({
                input: updatedInput,
                options: updatedOptions,
              })
            }
          }
        }
      } catch (error) {
        if (id === sequence.current) {
          setResult({ ok: false, output: '', error: failureMessage(error) })
        }
      }
    })()
  }, [])

  useEffect(() => {
    const previous = lastRun.current
    // The first render, a new tool and an option change all run immediately;
    // only the input waits for the box to go quiet.
    if (
      previous === null ||
      previous.toolId !== tool.id ||
      previous.optionsKey !== optionsKey
    ) {
      start()
      return
    }
    if (previous.input === input) return

    const timer = setTimeout(start, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [tool, input, optionsKey, start])

  useEffect(() => {
    if (tool.live !== true) return
    const interval = setInterval(() => {
      if (latest.current.input !== '') start()
    }, LIVE_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [tool, start])

  /** A dropped or chosen file, straight to `runFile` under the same sequence
   * number as a text run so a slow file and a fast keystroke cannot overwrite
   * each other. */
  const runFile = useCallback((file: File) => {
    const { tool: current } = latest.current
    if (current.runFile === undefined) return

    const id = ++sequence.current
    void current.runFile(file).then(
      (next) => {
        if (id === sequence.current) setResult(next)
      },
      (error: unknown) => {
        if (id === sequence.current) {
          setResult({ ok: false, output: '', error: failureMessage(error) })
        }
      },
    )
  }, [])

  /** The link this pane's state travels in. Secret option values are left out
   * — an HMAC key or a passphrase has no business riding along in a URL
   * somebody pastes into chat — and the button is disabled outright above the
   * hash ceiling rather than quietly copying a link with the input missing.
   * A `sensitive` tool's input is itself the secret, so it is dropped the
   * same way ToolsPage's auto-write path drops it: only the tool id travels,
   * matching the empty-box-on-reload contract everywhere else in this file. */
  function shareUrl(): string {
    const { origin, pathname, search } = window.location
    if (tool.sensitive === true) {
      const hash = buildToolHash({ tool: tool.id, input: '', options: {} })
      return `${origin}${pathname}${search}${hash}`
    }
    const shareable: ToolOptions = {}
    for (const definition of tool.options ?? []) {
      if (definition.secret !== true) {
        shareable[definition.key] = resolved[definition.key]
      }
    }
    const hash = buildToolHash({ tool: tool.id, input, options: shareable })
    return `${origin}${pathname}${search}${hash}`
  }

  const baseId = useId()
  const inputId = `${baseId}-input`
  const fileId = `${baseId}-file`

  const fields = result?.fields ?? []
  const error = result?.ok === false ? (result.error ?? '') : ''
  const tooLongToShare = exceedsHashLimit(input)

  return (
    <div className="flex flex-col gap-4">
      {/* A generator ignores whatever is in the box, so it is drawn without
          one: an Input control whose contents change nothing is a promise the
          tool does not keep, and typing into it would silently reroll the
          value already on show. */}
      {tool.generates !== true && (
        <div className="flex flex-col gap-2">
          <label htmlFor={inputId} className={CAPTION}>
            Input
          </label>
          <textarea
            id={inputId}
            value={input}
            rows={8}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => {
              onChange({ input: event.target.value, options: resolved })
            }}
            className={CONTROL}
          />
        </div>
      )}

      {(tool.options ?? []).length > 0 && (
        <div className="flex flex-wrap gap-4">
          {(tool.options ?? []).map((definition) => {
            const controlId = `${baseId}-${definition.key}`
            const change = (value: string) => {
              onChange({
                input,
                options: { ...resolved, [definition.key]: value },
              })
            }

            return (
              <div
                key={definition.key}
                className="flex min-w-0 grow flex-col gap-2"
              >
                {definition.kind === 'button-group' ? (
                  <fieldset className="flex min-w-0 grow flex-col gap-2">
                    <legend className={CAPTION}>{definition.label}</legend>
                    <div className="flex flex-wrap gap-2">
                      {(definition.choices ?? []).map((choice) => {
                        const active = resolved[definition.key] === choice.value
                        return (
                          <button
                            key={choice.value}
                            type="button"
                            aria-pressed={active}
                            onClick={() => change(choice.value)}
                            className={`${TAP_TARGET_HEIGHT} rounded-sm px-3 text-base ${FOCUS_RING} ${
                              active
                                ? 'bg-accent text-background'
                                : 'border border-border-strong text-text hover:text-accent'
                            }`}
                          >
                            {choice.label}
                          </button>
                        )
                      })}
                    </div>
                  </fieldset>
                ) : (
                  <>
                    <label htmlFor={controlId} className={CAPTION}>
                      {definition.label}
                    </label>
                    {definition.kind === 'select' ? (
                      <select
                        id={controlId}
                        value={resolved[definition.key]}
                        onChange={(event) => change(event.target.value)}
                        className={CONTROL}
                      >
                        {(definition.choices ?? []).map((choice) => (
                          <option key={choice.value} value={choice.value}>
                            {choice.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        id={controlId}
                        // A secret is a secret from the reader's shoulder too,
                        // not only from the URL.
                        type={definition.secret === true ? 'password' : 'text'}
                        value={resolved[definition.key]}
                        placeholder={definition.placeholder}
                        autoComplete="off"
                        onChange={(event) => change(event.target.value)}
                        className={CONTROL}
                      />
                    )}
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}

      {tool.runFile !== undefined && (
        /* The zone is the <label>, so the same element that takes the drop
         * also opens the picker on a click and names the input for a screen
         * reader — one control, three ways in. */
        <label
          htmlFor={fileId}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault()
            const [file] = Array.from(event.dataTransfer?.files ?? [])
            if (file !== undefined) runFile(file)
          }}
          className="flex flex-col gap-2 rounded-card border border-dashed border-border-strong p-4 text-base text-muted"
        >
          {FILE_ZONE_LABEL}
          <input
            id={fileId}
            type="file"
            onChange={(event) => {
              const [file] = Array.from(event.target.files ?? [])
              if (file !== undefined) runFile(file)
            }}
            className="text-base text-text"
          />
        </label>
      )}

      {tool.generates === true && (
        /* Another value, without having to change an option to get one. The
           run is the same `start()` an option change performs, so the newest
           result wins by sequence number exactly as it does everywhere else. */
        <div>
          <button type="button" onClick={start} className={PANE_BUTTON}>
            Generate
          </button>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <span className={CAPTION}>Output</span>
        <pre className="w-full overflow-x-auto whitespace-pre-wrap break-all rounded-card border border-border bg-surface p-3 font-mono text-base text-text">
          {result?.output ?? ''}
        </pre>
      </div>

      <p aria-live="polite" className="text-base text-accent empty:hidden">
        {error}
      </p>

      {result?.progress !== undefined && (
        /* Decorative only — `aria-hidden`, since the fraction it draws is
         * also a `field` row (TOTP's "Seconds remaining") with the number a
         * screen reader can actually announce. The transition is a plain
         * CSS one, so the page's single reduced-motion block already
         * collapses it along with every other transition on the page. */
        <svg
          aria-hidden="true"
          width={RING_SIZE}
          height={RING_SIZE}
          viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
          className="shrink-0"
        >
          <circle
            cx={RING_SIZE / 2}
            cy={RING_SIZE / 2}
            r={RING_RADIUS}
            fill="none"
            strokeWidth={RING_STROKE}
            className="stroke-border"
          />
          <circle
            cx={RING_SIZE / 2}
            cy={RING_SIZE / 2}
            r={RING_RADIUS}
            fill="none"
            strokeWidth={RING_STROKE}
            strokeLinecap="round"
            strokeDasharray={RING_CIRCUMFERENCE}
            strokeDashoffset={
              RING_CIRCUMFERENCE * (1 - result.progress.fraction)
            }
            transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
            className="stroke-accent transition-[stroke-dashoffset] duration-1000 ease-linear"
          />
        </svg>
      )}

      {fields.length > 0 && (
        <table className="w-full table-auto border-collapse text-base">
          <caption className={`text-left ${CAPTION}`}>Details</caption>
          <tbody>
            {fields.map((field, index) => (
              <tr
                // Labels repeat across tools but not within one result; the
                // index keeps the key unique even so.
                key={`${field.label}-${index}`}
                className={field.warn === true ? 'text-accent' : 'text-text'}
              >
                <th
                  scope="row"
                  className="border-b border-border py-2 pr-4 text-left align-top font-normal"
                >
                  {field.label}
                </th>
                <td className="border-b border-border py-2 align-top break-all font-mono">
                  {field.value}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => copyToClipboard(result?.output ?? '')}
          className={PANE_BUTTON}
        >
          Copy output
        </button>
        <button
          type="button"
          disabled={tooLongToShare}
          title={tooLongToShare ? SHARE_LIMIT_TITLE : undefined}
          onClick={() => copyToClipboard(shareUrl())}
          className={PANE_BUTTON}
        >
          Copy link
        </button>
      </div>
    </div>
  )
}
