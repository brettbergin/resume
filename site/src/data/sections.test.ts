import { describe, expect, it } from 'vitest'

import { sections } from './sections.ts'

/*
 * Guard rails for the nav/section contract: the header nav builds its hrefs
 * from these ids and `App.tsx` puts the same ids on the DOM, so a duplicate or
 * a malformed id silently breaks anchor scrolling rather than failing loudly.
 */

/** Lowercase letters, digits and hyphens only — a bare fragment id, no `#`. */
const fragmentId = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

describe('page sections', () => {
  it('lists at least one section', () => {
    expect(sections).not.toHaveLength(0)
  })

  it('gives every section a unique id', () => {
    const ids = sections.map((section) => section.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('gives every section an id usable as an anchor fragment', () => {
    for (const section of sections) {
      expect(section.id, section.label).toMatch(fragmentId)
      expect(section.id.startsWith('#'), section.label).toBe(false)
    }
  })

  it('gives every section a label', () => {
    for (const section of sections) {
      expect(section.label, section.id).not.toBe('')
    }
  })
})
