import { describe, expect, it } from 'vitest'

import { isToolsRoute } from '../tools/fragment.ts'
import { routes } from './routes.ts'
import { sections } from './sections.ts'

/*
 * Guard rails for the route/section split. A route link looks like a section
 * link in the nav and behaves nothing like one: it is a hash *path* the router
 * in `App.tsx` reads, not an anchor to an element on the page. These pin the
 * facts that keep the two from being confused for each other.
 */

describe('page routes', () => {
  it('lists the tools route', () => {
    expect(routes).toEqual([
      { id: 'tools', label: '~/tools', href: '#/tools' },
    ])
  })

  it('gives every route a unique id and a label', () => {
    const ids = routes.map((route) => route.id)

    expect(new Set(ids).size).toBe(ids.length)
    for (const route of routes) {
      expect(route.label, route.id).not.toBe('')
    }
  })

  it('writes every href as a hash path, not a bare anchor', () => {
    // `#/tools`, not `#tools`: the leading slash is what tells the router this
    // is a route rather than an id somewhere on the page.
    for (const route of routes) {
      expect(route.href, route.id).toMatch(/^#\//)
    }
  })

  it('points every route at a hash the router recognises', () => {
    for (const route of routes) {
      expect(isToolsRoute(route.href), route.href).toBe(true)
    }
  })

  it('shares no id with a section', () => {
    // A route id colliding with a section id would make the nav ambiguous and
    // give `#tools` two meanings.
    const sectionIds = new Set(sections.map((section) => section.id))

    for (const route of routes) {
      expect(sectionIds.has(route.id), route.id).toBe(false)
    }
  })
})
