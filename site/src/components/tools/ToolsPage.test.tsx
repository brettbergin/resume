import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildToolHash } from '../../tools/fragment.ts'
import { tools } from '../../tools/registry.ts'
import { ToolsPage } from './ToolsPage.tsx'

/*
 * The page's own subject is the URL: which tool the fragment selects, what a
 * run writes back, and how a link the reader follows re-enters. The tools
 * themselves are covered next to their modules and the input/output/copy
 * surface next to ToolPane, so the real registry is used here rather than
 * stubs — the point of these assertions is that a *shared link* opens the tool
 * the sender saw, which a stub registry could not show.
 *
 * jsdom's `location.hash =` fires `hashchange` asynchronously, which is
 * exactly what a browser does; `navigate()` below drives it explicitly so the
 * assertions do not race the event loop.
 */

/** RFC 7515 A.1's HS256 token, the same vector jwt.test.ts uses. */
const JWT =
  'eyJ0eXAiOiJKV1QiLA0KICJhbGciOiJIUzI1NiJ9' +
  '.eyJpc3MiOiJqb2UiLA0KICJleHAiOjEzMDA4MTkzODAsDQogImh0dHA6Ly9leGFtcGxlLmNvbS9pc19yb290Ijp0cnVlfQ' +
  '.dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'

/** The pane's debounce, restated rather than imported: this file waits on the
 * behaviour, it does not own the number. */
const DEBOUNCE = 150

/** Put a hash in the address bar before a render, without firing an event —
 * the mount reads `location.hash` itself. */
function setHash(hash: string) {
  window.history.replaceState(null, '', `${window.location.pathname}${hash}`)
}

/** Follow a link the way a browser does: the address bar changes, then
 * `hashchange` fires. */
async function navigate(hash: string) {
  await act(async () => {
    window.location.hash = hash
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  })
}

const input = () => screen.getByLabelText('Input') as HTMLTextAreaElement

const output = () =>
  screen.getByText('Output').parentElement?.querySelector('pre')

const toolList = () => screen.getByRole('list')

beforeEach(() => {
  setHash('')
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  setHash('')
})

describe('ToolsPage', () => {
  it('renders one h1 for the route', () => {
    render(<ToolsPage />)

    const headings = screen.getAllByRole('heading', { level: 1 })

    expect(headings).toHaveLength(1)
    expect(headings[0].textContent).toBe('~/tools')
  })

  it('opens on magic paste when the fragment names no tool', () => {
    setHash('#/tools')
    render(<ToolsPage />)

    const active = within(toolList()).getByRole('link', { current: 'page' })

    expect(active.textContent).toBe('magic paste')
    expect(active.getAttribute('href')).toBe('#/tools/magic')
  })

  it('falls back to magic paste for a tool id the registry does not know', () => {
    setHash('#/tools/enigma')
    render(<ToolsPage />)

    expect(
      within(toolList()).getByRole('link', { current: 'page' }).textContent,
    ).toBe('magic paste')
  })

  it('lists every registry tool as a link to its own fragment', () => {
    render(<ToolsPage />)

    const links = within(toolList()).getAllByRole('link')

    expect(links.map((link) => link.textContent)).toEqual(
      tools.map((tool) => tool.name),
    )
    expect(links.map((link) => link.getAttribute('href'))).toEqual(
      tools.map((tool) => `#/tools/${tool.id}`),
    )
  })

  it('marks exactly one tool link as the current page', () => {
    setHash('#/tools/base64')
    render(<ToolsPage />)

    const current = within(toolList())
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page')

    expect(current).toHaveLength(1)
    expect(current[0].getAttribute('href')).toBe('#/tools/base64')
  })

  it('renders exactly one tool pane', () => {
    render(<ToolsPage />)

    expect(screen.getAllByLabelText('Input')).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Copy output' })).toHaveLength(
      1,
    )
  })

  it('restores the tool, the input and the output from the fragment', async () => {
    setHash(buildToolHash({ tool: 'jwt', input: JWT, options: {} }))
    render(<ToolsPage />)

    expect(
      within(toolList()).getByRole('link', { current: 'page' }).textContent,
    ).toBe('jwt')
    expect(input().value).toBe(JWT)

    // The pane runs on mount rather than after the debounce, so a shared link
    // is never blank; the payload's `iss` claim is the proof it really ran.
    await waitFor(() => {
      expect(output()?.textContent).toContain('joe')
    })
  })

  it('writes a run back to the fragment with replaceState, never pushState', async () => {
    vi.useFakeTimers()
    const replace = vi.spyOn(window.history, 'replaceState')
    const push = vi.spyOn(window.history, 'pushState')
    setHash('#/tools/base64')
    render(<ToolsPage />)

    fireEvent.change(input(), { target: { value: 'hello' } })
    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE)
    })
    vi.useRealTimers()

    expect(push).not.toHaveBeenCalled()
    expect(replace).toHaveBeenCalled()

    const written = replace.mock.calls.at(-1)?.[2] as string
    expect(written).toContain('#/tools/base64?i=')
    expect(written.startsWith(window.location.pathname)).toBe(true)
    // The address bar now carries the state, options included: the pane
    // resolves every option to its default before handing the state back, so
    // the link reproduces the settings the sender was looking at.
    expect(window.location.hash).toBe(written.slice(written.indexOf('#')))
    expect(window.location.hash).toContain('&o=')
  })

  it('keeps a secret option out of the fragment it writes', async () => {
    const replace = vi.spyOn(window.history, 'replaceState')
    setHash('#/tools/hash')
    render(<ToolsPage />)

    // The HMAC key is a `secret` option; typing one must not put it in the
    // address bar, where it would ride along in anything the reader copies.
    fireEvent.change(screen.getByLabelText(/hmac key/i), {
      target: { value: 'hunter2' },
    })

    await waitFor(() => {
      expect(replace).toHaveBeenCalled()
    })
    for (const call of replace.mock.calls) {
      expect(String(call[2])).not.toContain('hunter2')
    }
    expect(decodeURIComponent(window.location.hash)).not.toContain('hunter2')
  })

  it('does not re-enter its own hash write as a navigation', async () => {
    vi.useFakeTimers()
    setHash('#/tools/base64')
    render(<ToolsPage />)

    fireEvent.change(input(), { target: { value: 'hello' } })
    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE)
    })
    vi.useRealTimers()

    // `replaceState` fires no hashchange, so the input the reader typed is
    // still there rather than having been re-parsed out of the URL mid-run.
    expect(input().value).toBe('hello')
  })

  it('switches tool, input and options when the hash changes under it', async () => {
    setHash('#/tools/base64')
    render(<ToolsPage />)

    await navigate(buildToolHash({ tool: 'jwt', input: JWT, options: {} }))

    expect(
      within(toolList()).getByRole('link', { current: 'page' }).textContent,
    ).toBe('jwt')
    expect(input().value).toBe(JWT)
  })

  it('removes its hashchange listener on unmount', async () => {
    const add = vi.spyOn(window, 'addEventListener')
    const remove = vi.spyOn(window, 'removeEventListener')
    const { unmount } = render(<ToolsPage />)

    const added = add.mock.calls.filter(([type]) => type === 'hashchange')
    expect(added).toHaveLength(1)

    unmount()

    expect(
      remove.mock.calls.filter(([type]) => type === 'hashchange'),
    ).toHaveLength(1)
  })

  it('offers magic’s detection as a link to that tool carrying the input', async () => {
    setHash(buildToolHash({ tool: 'magic', input: JWT, options: {} }))
    render(<ToolsPage />)

    const chip = await screen.findByRole('link', { name: /detected as jwt/i })

    expect(chip.getAttribute('href')).toBe(
      buildToolHash({ tool: 'jwt', input: JWT, options: {} }),
    )

    // And following it lands on the tool with the paste intact, which is the
    // whole point of carrying the input in the href.
    await navigate(chip.getAttribute('href')!)

    expect(
      within(toolList()).getByRole('link', { current: 'page' }).textContent,
    ).toBe('jwt')
    expect(input().value).toBe(JWT)
    expect(screen.queryByRole('link', { name: /detected as/i })).toBeNull()
  })

  it('shows no detection chip when magic recognised nothing', async () => {
    setHash(
      buildToolHash({ tool: 'magic', input: 'the quick brown fox', options: {} }),
    )
    render(<ToolsPage />)

    await waitFor(() => {
      expect(output()?.textContent).not.toBe('')
    })
    expect(screen.queryByRole('link', { name: /detected as/i })).toBeNull()
  })
})
