import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { projects } from '../data/resume.ts'
import { ProjectsSection } from './ProjectsSection.tsx'

/*
 * Cards are asserted against the `projects` export rather than literals, so a
 * project retyped into the component fails here — and because the rendered
 * card set is compared for equality, a dropped project and an invented one
 * fail the same way, in the data's own order.
 *
 * jsdom applies no stylesheet, so nothing below actually sits in a grid: the
 * responsive behaviour is asserted as the class names that produce it (one
 * column of cards that becomes two at `md` and three at `lg`) plus the manual
 * 320/375/768/1440 checklist in README — the same split the existing suites
 * use.
 */

const HEADING_ID = 'projects-heading'
const HEADING = 'Open Source Projects'

function renderSection() {
  return render(<ProjectsSection headingId={HEADING_ID} heading={HEADING} />)
}

/** The cards: every project is one link, and the link is the whole card. */
function cards() {
  return screen.getAllByRole('link')
}

function classesOf(element: Element | null | undefined) {
  return (element?.className ?? '').split(/\s+/)
}

describe('ProjectsSection', () => {
  it('renders the heading it is given, as an h2, and no h1', () => {
    renderSection()

    const headings = screen.getAllByRole('heading', { level: 2 })

    expect(headings).toHaveLength(1)
    expect(headings[0].textContent).toBe(HEADING)
    // App.tsx labels the wrapping <section> with this id; the section owns it.
    expect(headings[0].id).toBe(HEADING_ID)
    // The hero owns the document's only <h1>.
    expect(screen.queryAllByRole('heading', { level: 1 })).toEqual([])
  })

  it('renders exactly the projects the data lists, in order, as cards', () => {
    renderSection()

    // Equality, not containment: a project dropped from the data's order and
    // one invented in the component both fail.
    expect(cards().map((card) => card.getAttribute('href'))).toEqual(
      projects.map((project) => project.url),
    )
    expect(
      screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent),
    ).toEqual(projects.map((project) => project.name))
  })

  it('shows every project its description, from the data', () => {
    renderSection()

    expect(cards().map((card) => card.textContent)).toEqual(
      projects.map((project) => `${project.name}${project.description}`),
    )
  })

  it('collects the cards in a single list, one item each', () => {
    renderSection()

    const lists = screen.getAllByRole('list')

    expect(lists).toHaveLength(1)
    expect(lists[0].querySelectorAll('li')).toHaveLength(projects.length)
    // The card is the list item's whole content, not a link tucked inside it.
    for (const item of lists[0].querySelectorAll('li')) {
      expect(item.querySelectorAll('a')).toHaveLength(1)
    }
  })

  it('opens every card in a new tab, safely', () => {
    renderSection()

    for (const card of cards()) {
      expect(card.getAttribute('target')).toBe('_blank')
      expect(card.getAttribute('rel')).toBe('noopener noreferrer')
    }
  })

  it('stacks the cards in one column and adds columns from md and lg up', () => {
    renderSection()

    const classes = classesOf(screen.getByRole('list'))

    expect(classes).toContain('grid')
    expect(classes).toContain('grid-cols-1')
    expect(classes).toContain('md:grid-cols-2')
    expect(classes).toContain('lg:grid-cols-3')
  })

  it('makes each card a comfortable tap target filling its cell', () => {
    renderSection()

    for (const card of cards()) {
      const classes = classesOf(card)

      // 44px minimum touch size, and the card — not something inside it —
      // is what fills the grid cell.
      expect(classes).toContain('min-h-11')
      expect(classes).toContain('h-full')
      expect(classes).toContain('flex')
    }
  })

  it('gives every card the same surface the achievements cards use', () => {
    renderSection()

    for (const card of cards()) {
      const classes = classesOf(card)

      expect(classes).toContain('rounded-card')
      expect(classes).toContain('border-border')
      expect(classes).toContain('bg-surface')
      expect(classes).toContain('p-4')
    }
  })
})
