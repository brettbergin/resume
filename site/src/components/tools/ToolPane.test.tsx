import { useState } from 'react'

import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FOCUS_RING, TAP_TARGET_HEIGHT } from '../../styles.ts'
import type { Tool, ToolOptions, ToolResult } from '../../tools/types.ts'
import { ToolPane, type ToolPaneState } from './ToolPane.tsx'

/*
 * Every tool here is a stub defined in this file, never one out of
 * src/tools/registry.ts. The pane's contract is the `Tool` interface, so
 * testing it through a real tool would tie these assertions to that tool's
 * own output and let a change in either break the other. The stubs also do
 * what no real tool does: hand back a promise this file resolves by hand,
 * which is the only way to prove the stale-result guard fires at all.
 *
 * Timers are faked throughout, because the two behaviours worth pinning — the
 * 150ms debounce and the once-a-second live re-run — are otherwise assertable
 * only by sleeping. `flush()` drains the microtask queue inside `act`, which
 * is what a run's promise settles on.
 */

/** The pane's debounce, restated so each assertion says what it is waiting
 * for. ToolPane keeps its own copy private, and this file would rather fail
 * loudly than import a constant it is meant to be checking. */
const DEBOUNCE = 150

/** The drop zone's text, which is how the file controls are found. */
const FILE_ZONE_LABEL = 'Drop a file here, or choose one'

/** The pane is controlled, so it needs an owner. This is the smallest one:
 * store the state the pane hands back and hand it straight back in. */
function Harness({
  tool,
  initialInput = '',
  initialOptions = {},
}: {
  tool: Tool
  initialInput?: string
  initialOptions?: ToolOptions
}) {
  const [state, setState] = useState<ToolPaneState>({
    input: initialInput,
    options: initialOptions,
  })

  return (
    <ToolPane
      tool={tool}
      input={state.input}
      options={state.options}
      onChange={setState}
    />
  )
}

/** Let every pending promise settle, and React re-render off the back of it. */
const flush = () => act(async () => {})

/** Advance the clock, then settle whatever that started. */
const advance = (ms: number) =>
  act(async () => {
    vi.advanceTimersByTime(ms)
  })

/** Mount and let the first run — which the pane starts at once rather than
 * after the debounce, so a shared link is not blank for 150ms — settle. */
async function mount(tool: Tool, props: { input?: string } = {}) {
  const utils = render(<Harness tool={tool} initialInput={props.input} />)
  await flush()
  return utils
}

const type = (value: string) => {
  fireEvent.change(screen.getByLabelText('Input'), { target: { value } })
}

const output = () =>
  screen.getByText('Output').parentElement?.querySelector('pre')

const copyLinkButton = () => screen.getByRole('button', { name: 'Copy link' })

/** A synchronous tool echoing its input and options, with one plain field and
 * one warn field. Overrides replace any part of it. */
function makeStub(overrides: Partial<Tool> = {}): Tool {
  return {
    id: 'stub',
    name: 'stub',
    run: vi.fn(
      (input: string, options: ToolOptions): ToolResult => ({
        ok: true,
        output: `ran:${input}:${JSON.stringify(options)}`,
        fields: [
          { label: 'Length', value: String(input.length) },
          { label: 'Expired', value: 'yes', warn: true },
        ],
      }),
    ),
    ...overrides,
  }
}

const SELECT_OPTION = {
  key: 'mode',
  label: 'Mode',
  kind: 'select',
  default: 'decode',
  choices: [
    { value: 'decode', label: 'decode' },
    { value: 'encode', label: 'encode' },
  ],
} as const

const SECRET_OPTION = {
  key: 'hmacKey',
  label: 'HMAC key',
  kind: 'text',
  default: '',
  placeholder: 'optional',
  secret: true,
} as const

let clipboardWrites: ReturnType<typeof vi.fn>

/** jsdom has no clipboard, and the pane guards for exactly that, so a stub
 * has to be installed for the copy assertions to see anything at all. */
function stubClipboard(value: unknown) {
  Object.defineProperty(navigator, 'clipboard', {
    value,
    configurable: true,
    writable: true,
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  clipboardWrites = vi.fn(() => Promise.resolve())
  stubClipboard({ writeText: clipboardWrites })
})

afterEach(() => {
  vi.useRealTimers()
  Reflect.deleteProperty(navigator, 'clipboard')
})

describe('ToolPane', () => {
  it('renders a labelled input, an output, a fields table and both copy buttons', async () => {
    const { container } = await mount(makeStub(), { input: 'abc' })

    const textarea = screen.getByLabelText('Input')
    expect(textarea.tagName).toBe('TEXTAREA')
    // The width is the container's, and the text sits at the 1rem floor, so
    // mobile Safari does not zoom the page when the box takes focus.
    expect(textarea.className).toContain('w-full')
    expect(textarea.className).toContain('text-base')

    const pre = output()
    expect(pre?.textContent).toBe('ran:abc:{}')
    // Not a live region: a live tool re-runs every second, and a screen
    // reader would read the whole payload out each time.
    expect(pre?.getAttribute('aria-live')).toBeNull()

    const rows = container.querySelectorAll('tbody tr')
    expect(rows).toHaveLength(2)
    expect(rows[0].querySelector('th')?.getAttribute('scope')).toBe('row')
    expect(rows[0].querySelector('th')?.textContent).toBe('Length')
    expect(rows[0].querySelector('td')?.textContent).toBe('3')
    expect(rows[0].className).not.toContain('text-accent')
    expect(rows[1].className).toContain('text-accent')

    expect(screen.getByRole('button', { name: 'Copy output' })).toBeDefined()
    expect(copyLinkButton()).toBeDefined()
  })

  it('runs once after 150ms of quiet rather than on every keystroke', async () => {
    const tool = makeStub()
    const run = vi.mocked(tool.run)
    await mount(tool)

    // An empty pane runs nothing: there is no result to show for no input.
    expect(run).not.toHaveBeenCalled()

    type('j')
    await advance(50)
    type('jw')
    await advance(50)
    type('jwt')
    expect(run).not.toHaveBeenCalled()

    await advance(DEBOUNCE)

    expect(run).toHaveBeenCalledTimes(1)
    expect(run.mock.calls[0][0]).toBe('jwt')
    expect(output()?.textContent).toBe('ran:jwt:{}')

    await advance(1000)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('re-runs immediately when an option changes', async () => {
    const tool = makeStub({ options: [SELECT_OPTION] })
    const run = vi.mocked(tool.run)
    await mount(tool, { input: 'abc' })

    expect(run).toHaveBeenCalledTimes(1)
    expect(run.mock.calls[0][1]).toEqual({ mode: 'decode' })

    fireEvent.change(screen.getByLabelText('Mode'), {
      target: { value: 'encode' },
    })

    // No clock advance: an option change is a deliberate click, and the
    // reader is already waiting to see what it did.
    expect(run).toHaveBeenCalledTimes(2)
    expect(run.mock.calls[1][1]).toEqual({ mode: 'encode' })

    await flush()
    expect(output()?.textContent).toBe('ran:abc:{"mode":"encode"}')
  })

  it('discards a stale async result', async () => {
    const settle: ((result: ToolResult) => void)[] = []
    const tool = makeStub({
      run: vi.fn(
        () =>
          new Promise<ToolResult>((resolve) => {
            settle.push(resolve)
          }),
      ),
    })

    await mount(tool)

    type('slow')
    await advance(DEBOUNCE)
    type('fast')
    await advance(DEBOUNCE)
    expect(settle).toHaveLength(2)

    // The newest run lands first, then the superseded one: the pane keeps
    // what belongs to the input that is actually in the box.
    await act(async () => {
      settle[1]({ ok: true, output: 'fast result' })
    })
    expect(output()?.textContent).toBe('fast result')

    await act(async () => {
      settle[0]({ ok: true, output: 'slow result' })
    })
    expect(output()?.textContent).toBe('fast result')
  })

  it('re-runs a live tool once a second and clears the interval on unmount', async () => {
    const tool = makeStub({ live: true })
    const run = vi.mocked(tool.run)
    const { unmount } = await mount(tool, { input: 'abc' })

    expect(run).toHaveBeenCalledTimes(1)

    await advance(1000)
    expect(run).toHaveBeenCalledTimes(2)

    await advance(1000)
    expect(run).toHaveBeenCalledTimes(3)

    unmount()

    expect(vi.getTimerCount()).toBe(0)
    await advance(3000)
    expect(run).toHaveBeenCalledTimes(3)
  })

  it('clears the live interval when the tool changes', async () => {
    const live = makeStub({ id: 'live', live: true })
    const still = makeStub({ id: 'still' })
    const liveRun = vi.mocked(live.run)
    const stillRun = vi.mocked(still.run)

    const { rerender } = render(<Harness tool={live} initialInput="abc" />)
    await flush()
    await advance(1000)
    expect(liveRun).toHaveBeenCalledTimes(2)

    rerender(<Harness tool={still} initialInput="abc" />)
    await flush()

    // The new tool runs at once — a different tool over the same input is a
    // new answer, not a keystroke — and the old tool's timer is gone.
    expect(stillRun).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)

    await advance(3000)
    expect(liveRun).toHaveBeenCalledTimes(2)
    expect(stillRun).toHaveBeenCalledTimes(1)
  })

  it('offers a file zone only for a tool that declares runFile', async () => {
    const { container, unmount } = await mount(makeStub())

    expect(screen.queryByText(FILE_ZONE_LABEL)).toBeNull()
    expect(container.querySelector('input[type="file"]')).toBeNull()

    unmount()

    const runFile = vi.fn(
      async (file: File): Promise<ToolResult> => ({
        ok: true,
        output: `hashed ${file.name}`,
      }),
    )
    const { container: hashing } = await mount(makeStub({ runFile }))

    const zone = screen.getByText(FILE_ZONE_LABEL)
    expect(hashing.querySelector('input[type="file"]')).not.toBeNull()

    const file = new File(['contents'], 'notes.txt', { type: 'text/plain' })
    await act(async () => {
      fireEvent.drop(zone, { dataTransfer: { files: [file] } })
    })

    expect(runFile).toHaveBeenCalledTimes(1)
    expect(output()?.textContent).toBe('hashed notes.txt')
  })

  it('renders a secret option as a password input and labels every control', async () => {
    const tool = makeStub({ options: [SELECT_OPTION, SECRET_OPTION] })
    const { container } = await mount(tool)

    expect(screen.getByLabelText('Mode').tagName).toBe('SELECT')
    expect(screen.getByLabelText('HMAC key').getAttribute('type')).toBe(
      'password',
    )

    // Every control the pane draws is reachable by its label, not only the
    // two these assertions name.
    const controls = Array.from(
      container.querySelectorAll('input, select, textarea'),
    )
    expect(controls.length).toBeGreaterThan(2)
    for (const control of controls) {
      expect(control.id).not.toBe('')
      expect(
        container.querySelector(`label[for="${control.id}"]`),
      ).not.toBeNull()
    }
  })

  it('disables the copy-link button above the hash ceiling', async () => {
    await mount(makeStub(), { input: 'short' })

    expect(copyLinkButton().hasAttribute('disabled')).toBe(false)
    expect(copyLinkButton().getAttribute('title')).toBeNull()

    // The ceiling is measured in UTF-8 bytes, so two-byte characters reach it
    // at half the character count.
    type('é'.repeat(2049))
    await advance(DEBOUNCE)

    expect(copyLinkButton().hasAttribute('disabled')).toBe(true)
    expect(copyLinkButton().getAttribute('title')).toContain('4 KB')

    type('a'.repeat(4096))
    await advance(DEBOUNCE)
    expect(copyLinkButton().hasAttribute('disabled')).toBe(false)
  })

  it('gives both copy buttons the shared focus ring and tap target', async () => {
    await mount(makeStub(), { input: 'abc' })

    for (const name of ['Copy output', 'Copy link']) {
      const className = screen.getByRole('button', { name }).className
      expect(className).toContain(FOCUS_RING)
      expect(className).toContain(TAP_TARGET_HEIGHT)
    }
  })

  it('copies the output and a link to the state, and does nothing without a clipboard', async () => {
    await mount(makeStub(), { input: 'abc' })

    fireEvent.click(screen.getByRole('button', { name: 'Copy output' }))
    expect(clipboardWrites).toHaveBeenCalledWith('ran:abc:{}')

    fireEvent.click(copyLinkButton())
    expect(clipboardWrites).toHaveBeenCalledTimes(2)
    const link = String(clipboardWrites.mock.calls[1][0])
    expect(link).toContain('#/tools/stub?i=')
    expect(link.startsWith(window.location.origin)).toBe(true)

    stubClipboard(undefined)
    expect(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy output' }))
    }).not.toThrow()
  })

  it('keeps a secret option value out of the copied link', async () => {
    const tool = makeStub({ options: [SELECT_OPTION, SECRET_OPTION] })
    await mount(tool, { input: 'abc' })

    fireEvent.change(screen.getByLabelText('HMAC key'), {
      target: { value: 'topsecret' },
    })
    await advance(DEBOUNCE)

    fireEvent.click(copyLinkButton())

    const link = String(clipboardWrites.mock.calls[0][0])
    // The options that may travel still do; the secret does not, in either
    // spelling — `o=` carries base64url, so a raw copy would show up too.
    expect(link).toContain('#/tools/stub?i=')
    expect(link).toContain('o=')
    expect(link).not.toContain('topsecret')
    expect(link).not.toContain(btoa('topsecret').replace(/=+$/, ''))
  })

  it('renders a failure inline in a polite live region, never as an alert', async () => {
    const tool = makeStub({
      run: vi.fn(
        (): ToolResult => ({
          ok: false,
          output: 'header decoded',
          error: 'signature is not three segments',
        }),
      ),
    })
    const { container } = await mount(tool, { input: 'not.a.token' })

    const live = container.querySelector('[aria-live="polite"]')
    expect(live?.tagName).toBe('P')
    expect(live?.textContent).toBe('signature is not three segments')
    expect(live?.className).toContain('text-accent')

    // A partial result still shows: a token whose header decoded tells the
    // reader more than an empty pane does.
    expect(output()?.textContent).toBe('header decoded')

    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('reports a thrown error rather than leaving the pane blank', async () => {
    const tool = makeStub({
      run: vi.fn(() => {
        throw new TypeError('cannot read properties of undefined')
      }),
    })
    const { container } = await mount(tool, { input: 'abc' })

    expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe(
      'cannot read properties of undefined',
    )
  })
})
