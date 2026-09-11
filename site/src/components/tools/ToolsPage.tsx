/*
 * The `~/tools` page: the list of tools down the side, and one `ToolPane` for
 * the active one. `App.tsx` renders it inside the shell's existing `<main>`
 * when `location.hash` names the route, so the header, the footer and the skip
 * link are the resume's — this file owns the page's content, not its chrome.
 *
 * THE URL IS THE STATE. Everything the page holds — which tool, what is in the
 * box, which options — is read out of the fragment on mount and written back
 * to it on every run (see src/tools/fragment.ts for the encoding). That is
 * what makes a link share a decoded thing without a server ever seeing it, and
 * it is why the pane below is controlled rather than stateful.
 *
 * The write is `replaceState`, never `pushState`: a run happens on every
 * keystroke, and pushing would fill the back button with the reader's typing
 * so that leaving the page took forty presses. `replaceState` also fires no
 * `hashchange`, which is what keeps this from being a feedback loop — the
 * listener below is only ever reached by navigation the reader performed (a
 * sidebar link, a pasted link, Back), and that path reloads tool, input and
 * options from the hash.
 *
 * Secrets: option values marked `secret` are kept in memory and left out of
 * the URL, exactly as `ToolPane`'s own share button leaves them out. The
 * address bar is a place people screenshot and paste from, so an HMAC key
 * typed into the page must not appear in it. A tool marked `sensitive` goes
 * further still: its input and every option are left out too, since for a
 * tool like TOTP the input itself is the secret — only the tool id is written,
 * so a reload selects the tool without restoring what was typed into it.
 */

import { useCallback, useEffect, useState } from 'react'

import { FOCUS_RING, TAP_TARGET_HEIGHT } from '../../styles.ts'
import {
  DEFAULT_TOOL_ID,
  buildToolHash,
  parseToolHash,
  type ToolHashState,
} from '../../tools/fragment.ts'
import { findTool, tools } from '../../tools/registry.ts'
import type { Tool, ToolOptions, ToolResult } from '../../tools/types.ts'
import { ToolPane, type ToolPaneState } from './ToolPane.tsx'

/** The page's own heading, and the label of the route that reaches it. */
const TITLE = '~/tools'

/** One tool in the sidebar. The active one is the only place on the page with
 * an unprefixed `glow-text`: unlike the header's nav, this *is* a state the
 * page computes, so lighting it is a claim that holds. */
const TOOL_LINK = `flex items-center rounded-pill px-3 text-base ${FOCUS_RING}`
const TOOL_LINK_ACTIVE = 'text-accent glow-text'
const TOOL_LINK_IDLE = 'text-muted hover:text-accent'

/** The magic-paste switch chip: a link, not a button, because it goes
 * somewhere — the same fragment a shared link to that tool would carry. */
const CHIP = `inline-flex ${TAP_TARGET_HEIGHT} items-center rounded-pill border border-border-strong px-4 text-base text-accent hover:glow-text ${FOCUS_RING}`

/** The tool a hash state names, falling back to magic paste for an id no
 * longer in the registry — a link from an older version of the page. */
function activeTool(id: string): Tool {
  return findTool(id) ?? findTool(DEFAULT_TOOL_ID) ?? tools[0]
}

/** The options that may travel in the URL: everything the tool declares that
 * is not marked `secret`. Keys the tool does not declare are dropped with it,
 * which also keeps a hand-edited fragment from growing the URL. */
function shareableOptions(tool: Tool, options: ToolOptions): ToolOptions {
  const shareable: ToolOptions = {}
  for (const definition of tool.options ?? []) {
    const value = options[definition.key]
    if (definition.secret !== true && value !== undefined) {
      shareable[definition.key] = value
    }
  }
  return shareable
}

export function ToolsPage() {
  const [state, setState] = useState<ToolHashState>(() =>
    parseToolHash(window.location.hash),
  )
  /* Which tool magic paste dispatched the newest run to, or null. Only the id
   * is kept rather than the whole result: a `live` tool hands back a fresh
   * result object every second, and storing that here would re-render the page
   * on each tick for a chip whose text never changed. */
  const [detectedId, setDetectedId] = useState<string | null>(null)

  const tool = activeTool(state.tool)

  // Navigation the reader performed: a sidebar link, the switch chip, a pasted
  // link, or Back. `replaceState` does not come through here, so the page's own
  // writes cannot re-enter.
  useEffect(() => {
    function handleHashChange() {
      setState(parseToolHash(window.location.hash))
    }

    window.addEventListener('hashchange', handleHashChange)
    return () => {
      window.removeEventListener('hashchange', handleHashChange)
    }
  }, [])

  const handleChange = useCallback(
    (next: ToolPaneState) => {
      const current = activeTool(state.tool)
      const nextState: ToolHashState = {
        tool: current.id,
        input: next.input,
        options: next.options,
      }
      setState(nextState)

      // A sensitive tool's input *is* the secret — an HMAC key on its own can
      // be dropped from the options, but a TOTP secret or a provisioning URI
      // is what the reader typed into the box. Only the tool id travels, so
      // `#/tools/totp` still selects the tool on reload without restoring it.
      const hash = buildToolHash(
        current.sensitive === true
          ? { tool: current.id, input: '', options: {} }
          : { ...nextState, options: shareableOptions(current, next.options) },
      )
      const { pathname, search } = window.location
      window.history.replaceState(null, '', `${pathname}${search}${hash}`)
    },
    [state.tool],
  )

  const handleResult = useCallback((result: ToolResult | null) => {
    setDetectedId(result?.detected?.toolId ?? null)
  }, [])

  const detected = detectedId === null ? undefined : findTool(detectedId)

  return (
    <div className="flex flex-col gap-8 py-8 md:flex-row">
      <div className="md:w-48 md:shrink-0">
        <h1 className="glow-text font-mono text-2xl font-medium">{TITLE}</h1>
        <p className="mt-2 text-base text-muted">
          Everything here runs in this browser tab. Nothing you paste is sent
          anywhere.
        </p>

        {/* A list, not a second <nav>: the page already has the header's
            Primary landmark, and two links to the same place read as one more
            thing to step past rather than as help. `role="list"` because
            Tailwind's preflight strips the implicit one. */}
        <h2 className="mt-6 text-base text-muted">Tools</h2>
        <ul role="list" className="mt-2 flex flex-col gap-2">
          {tools.map((entry) => {
            const active = entry.id === tool.id
            return (
              <li key={entry.id}>
                <a
                  href={`#/tools/${entry.id}`}
                  aria-current={active ? 'page' : undefined}
                  className={`${TAP_TARGET_HEIGHT} ${TOOL_LINK} ${
                    active ? TOOL_LINK_ACTIVE : TOOL_LINK_IDLE
                  }`}
                >
                  {entry.name}
                </a>
              </li>
            )
          })}
        </ul>
      </div>

      <div className="flex min-w-0 grow flex-col gap-4">
        {detected !== undefined && detected.id !== tool.id && (
          /* The input rides along in the href, so the switch decodes the same
             paste rather than opening an empty pane. Above the fragment's size
             ceiling `buildToolHash` leaves it out, and the switch lands on the
             tool with an empty box — the alternative is a link nothing can
             open. A detected *sensitive* tool (e.g. a pasted otpauth:// URI
             scored by totp.detect) never gets its input into the href at
             all — the anchor's href is visible via hover/inspect and is a
             live navigation, not the guarded replaceState path below. */
          <p>
            <a
              href={buildToolHash(
                detected.sensitive === true
                  ? { tool: detected.id, input: '', options: {} }
                  : { tool: detected.id, input: state.input, options: {} },
              )}
              className={CHIP}
            >
              detected as {detected.name}, switch
            </a>
          </p>
        )}

        <ToolPane
          /* Keyed by tool so a switch remounts the pane rather than showing
             the previous tool's output against the new tool's name for the
             length of one run. */
          key={tool.id}
          tool={tool}
          input={state.input}
          options={state.options}
          onChange={handleChange}
          onResult={handleResult}
        />
      </div>
    </div>
  )
}
