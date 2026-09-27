import { describe, expect, it } from 'vitest'

import { findTool, tools } from './registry.ts'

/*
 * Guard rails for the registry contract. Tool ids appear in URLs people
 * share, so they have to be stable, unique and traceable to a module; and the
 * sidebar order is pinned rather than emergent, so a tool appended in the
 * wrong place has to fail here rather than quietly reshuffle the page.
 *
 * The pinned order is written out again here on purpose. A test that read the
 * order from the registry it is checking would assert nothing.
 */

/** Every id the feature will ship, in sidebar order. Tools appear in the
 * registry as their tasks land, so the assertion is that the registered ids
 * are this list's subsequence — not that they are the whole list. */
const PINNED_ORDER = [
  'magic',
  'base64',
  'hex',
  'url',
  'html',
  'json',
  'jwt',
  'hash',
  'cert',
  'gpg',
  'cidr',
  'csp',
  'headers',
  'cookie',
  'cvss',
  'saml',
  'epoch',
  'secret',
  'totp',
  'aes',
  'pkce',
] as const

/** The module file names in this directory, minus the tests, so a tool's id
 * can be checked against the file it actually lives in. */
const moduleNames = Object.keys(import.meta.glob('./*.ts'))
  .map((path) => path.replace('./', '').replace('.ts', ''))
  .filter((name) => !name.endsWith('.test'))

const ids = tools.map((tool) => tool.id)

describe('the tool registry', () => {
  it('has tools to check', () => {
    // Guards the suite itself: an empty registry must not pass vacuously.
    expect(tools.length).toBeGreaterThan(0)
    expect(moduleNames).toContain('registry')
  })

  it('gives every tool a unique, non-empty id', () => {
    for (const tool of tools) {
      expect(tool.id, tool.name).not.toBe('')
      expect(tool.id, tool.name).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    }
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('gives every tool a non-empty name for the sidebar', () => {
    for (const tool of tools) expect(tool.name, tool.id).not.toBe('')
  })

  it('names each tool after the module it lives in', () => {
    for (const id of ids) expect(moduleNames).toContain(id)
  })

  it('registers only ids the feature has pinned a position for', () => {
    for (const id of ids) expect(PINNED_ORDER).toContain(id)
  })

  it('lists the registered tools in the pinned sidebar order', () => {
    const expected = PINNED_ORDER.filter((id) => ids.includes(id))
    expect(ids).toEqual(expected)
  })
})

/** The option kinds `ToolPane` has a branch for. A tool that declares
 * anything else gets a control the pane renders as a plain text box, or none
 * at all — a mismatch that only shows up in the browser, so it is asserted
 * against the registry here instead. Extending it means extending the pane
 * first. */
const RENDERABLE_KINDS = ['text', 'select', 'button-group']

describe('the option contract', () => {
  it('declares only option kinds the pane renders', () => {
    for (const tool of tools) {
      for (const option of tool.options ?? []) {
        expect(RENDERABLE_KINDS, `${tool.id}.${option.key}`).toContain(
          option.kind,
        )
      }
    }
  })

  it('gives every option a unique key and a label', () => {
    for (const tool of tools) {
      const keys = (tool.options ?? []).map((option) => option.key)
      expect(new Set(keys).size, tool.id).toBe(keys.length)
      for (const option of tool.options ?? []) {
        expect(option.label, `${tool.id}.${option.key}`).not.toBe('')
      }
    }
  })

  it('defaults every choice-based option to one of its own choices', () => {
    // A default outside the list renders as no button pressed and no option
    // selected, which reads as a broken control rather than an unset one.
    for (const tool of tools) {
      for (const option of tool.options ?? []) {
        if (option.kind === 'text') continue
        const values = (option.choices ?? []).map((choice) => choice.value)
        expect(values.length, `${tool.id}.${option.key}`).toBeGreaterThan(0)
        expect(values, `${tool.id}.${option.key}`).toContain(option.default)
      }
    }
  })
})

describe('findTool', () => {
  it('finds every registered tool by id', () => {
    for (const tool of tools) expect(findTool(tool.id)).toBe(tool)
  })

  it('returns undefined for an id nothing is registered under', () => {
    expect(findTool('no-such-tool')).toBeUndefined()
    expect(findTool('')).toBeUndefined()
  })
})
