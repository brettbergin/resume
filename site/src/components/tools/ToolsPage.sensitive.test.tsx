import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { Tool } from '../../tools/types.ts'
import { ToolsPage } from './ToolsPage.tsx'

/*
 * The `sensitive` contract (see `Tool.sensitive` in types.ts) is exercised
 * against a stub tool rather than a real registry entry: nothing in the
 * shipped registry is sensitive yet, and this file's whole point is the fact
 * that `ToolsPage` never hands a sensitive tool's input or options to
 * `buildToolHash`, which is independent of which tool actually sets the flag.
 * The real registry's own tools keep their existing (non-sensitive) coverage
 * in `ToolsPage.test.tsx`.
 */

const { SENSITIVE_TOOL, MAGIC_TOOL } = vi.hoisted(() => ({
  SENSITIVE_TOOL: {
    id: 'stub-sensitive',
    name: 'stub sensitive',
    sensitive: true,
    options: [
      {
        key: 'digits',
        label: 'Digits',
        kind: 'text',
        default: '6',
      },
    ],
    run: (input: string) => ({ ok: true, output: input }),
  } satisfies Tool,
  // Stands in for the real magic-paste tool: it dispatches to the sensitive
  // stub for any non-empty input, the way `totp.detect` scores a pasted
  // `otpauth://` URI highly enough to win the sweep.
  MAGIC_TOOL: {
    id: 'magic',
    name: 'magic paste',
    run: (input: string) => ({
      ok: true,
      output: input,
      ...(input === ''
        ? {}
        : { detected: { toolId: 'stub-sensitive', confidence: 0.9 } }),
    }),
  } satisfies Tool,
}))

vi.mock('../../tools/registry.ts', () => ({
  tools: [MAGIC_TOOL, SENSITIVE_TOOL],
  findTool: (id: string) =>
    [MAGIC_TOOL, SENSITIVE_TOOL].find((tool) => tool.id === id),
}))

function setHash(hash: string) {
  window.history.replaceState(null, '', `${window.location.pathname}${hash}`)
}

const input = () => screen.getByLabelText('Input') as HTMLTextAreaElement

describe('ToolsPage with a sensitive tool', () => {
  it('never writes the input or options of a sensitive tool into the fragment', async () => {
    const replace = vi.spyOn(window.history, 'replaceState')
    setHash('#/tools/stub-sensitive')
    render(<ToolsPage />)

    fireEvent.change(input(), { target: { value: 'JBSWY3DPEHPK3PXP' } })
    fireEvent.change(screen.getByLabelText('Digits'), {
      target: { value: '8' },
    })

    await waitFor(() => {
      expect(replace).toHaveBeenCalled()
    })

    for (const call of replace.mock.calls) {
      const written = String(call[2])
      expect(written).not.toContain('i=')
      expect(written).not.toContain('o=')
      expect(written).not.toContain('JBSWY3DPEHPK3PXP')
    }

    expect(window.location.hash).toBe('#/tools/stub-sensitive')
  })

  it('never puts a detected sensitive tool\'s input into the switch chip href', async () => {
    setHash('#/tools/magic')
    render(<ToolsPage />)

    fireEvent.change(input(), {
      target: {
        value: 'otpauth://totp/Example:alice@example.com?secret=JBSWY3DPEHPK3PXP',
      },
    })

    const chip = await screen.findByRole('link', {
      name: 'detected as stub sensitive, switch',
    })
    const href = chip.getAttribute('href') ?? ''

    expect(href).not.toContain('i=')
    expect(href).not.toContain('JBSWY3DPEHPK3PXP')
    expect(href).toBe('#/tools/stub-sensitive')
  })
})
