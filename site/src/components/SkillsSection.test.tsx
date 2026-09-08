import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { competencies, technicalSkills } from '../data/resume.ts'
import { SkillsSection } from './SkillsSection.tsx'

/*
 * Groups and items are asserted against the data exports rather than literals,
 * so a skill typed into the component fails here — and because the rendered
 * chip set is compared for equality, a dropped item and an invented one fail
 * the same way.
 *
 * jsdom applies no stylesheet, so nothing below actually sits in a grid or
 * wraps: the responsive behaviour is asserted as the class names that produce
 * it (one column of groups that becomes two at `md` and three at `lg`, chips
 * in a wrapping row) plus the manual 320/375/768/1440 checklist in README —
 * the same split the existing suites use.
 */

const HEADING_ID = 'skills-heading'
const HEADING = 'Skills'

/** Every group of both exports, in the order the component renders them. */
const allGroups = [...competencies, ...technicalSkills]

/** Every skill of every group, flattened. */
const allItems = allGroups.flatMap((group) => group.items)

function renderSection() {
  return render(<SkillsSection headingId={HEADING_ID} heading={HEADING} />)
}

/** The chips: every group renders its items as list items and nothing else
 * in the section is one. */
function chips() {
  return screen.getAllByRole('listitem')
}

function classesOf(element: Element | null | undefined) {
  return (element?.className ?? '').split(/\s+/)
}

describe('SkillsSection', () => {
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

  it('titles the two sub-blocks', () => {
    renderSection()

    expect(
      screen
        .getAllByRole('heading', { level: 3 })
        .map((heading) => heading.textContent),
    ).toEqual(['Core Competencies', 'Technical Skills'])
  })

  it('renders every skill group from the data, in order, as a heading', () => {
    renderSection()

    expect(
      screen
        .getAllByRole('heading', { level: 4 })
        .map((heading) => heading.textContent),
    ).toEqual(allGroups.map((group) => group.label))
  })

  it('renders exactly the skills the data lists, as chips', () => {
    renderSection()

    // Equality, not containment: an item dropped from a group and one invented
    // in the component both fail.
    expect(chips().map((chip) => chip.textContent)).toEqual(allItems)
  })

  it('labels each chip list with its own group heading', () => {
    renderSection()

    for (const group of allGroups) {
      const heading = screen.getByRole('heading', {
        level: 4,
        name: group.label,
      })
      const list = screen.getByRole('list', { name: group.label })

      // A screen reader announces which group a chip belongs to.
      expect(heading.id).not.toBe('')
      expect(list.getAttribute('aria-labelledby')).toBe(heading.id)
      expect(
        [...list.querySelectorAll('li')].map((item) => item.textContent),
      ).toEqual(group.items)
    }
  })

  it('renders no proficiency level, rating or bar', () => {
    const { container } = renderSection()

    // The source resume has none, so any figure here would be invented.
    expect(screen.queryAllByRole('progressbar')).toEqual([])
    expect(screen.queryAllByRole('meter')).toEqual([])
    expect(container.innerHTML).not.toContain('%')
    expect(container.textContent ?? '').not.toMatch(
      /proficien|rating|beginner|intermediate|advanced|expert/i,
    )
  })

  it('stacks the groups in one column and adds columns from md and lg up', () => {
    renderSection()

    const grids = screen
      .getAllByRole('heading', { level: 4 })
      .map((heading) => heading.parentElement?.parentElement)

    expect(grids).toHaveLength(allGroups.length)

    for (const grid of grids) {
      const classes = classesOf(grid)

      expect(classes).toContain('grid')
      expect(classes).toContain('grid-cols-1')
      expect(classes).toContain('md:grid-cols-2')
      expect(classes).toContain('lg:grid-cols-3')
    }
  })

  it('wraps the chips of a group over as many lines as they need', () => {
    renderSection()

    for (const group of allGroups) {
      const classes = classesOf(screen.getByRole('list', { name: group.label }))

      expect(classes).toContain('flex')
      // Without this, the longest group (Specializations) would be clipped or
      // would widen the page at 320px.
      expect(classes).toContain('flex-wrap')
      // 0.5rem or more, so the chips do not read as one run-on block.
      expect(classes.filter((name) => name.startsWith('gap-'))).toEqual([
        'gap-2',
      ])
    }
  })

  it('tilts every group card toward the pointer', () => {
    renderSection()

    for (const group of allGroups) {
      const card = screen.getByRole('heading', {
        level: 4,
        name: group.label,
      }).parentElement

      // `tilt-card` is the index.css utility that owns the perspective, the
      // settle-back transition and the specular gradient; src/useTilt.ts
      // writes the custom properties it reads, and no-ops on a touch screen
      // or under reduced motion, where the utility's own rest values keep the
      // card flat.
      expect(classesOf(card)).toContain('tilt-card')
    }
  })

  it('sizes every chip as a comfortable future tap target', () => {
    renderSection()

    for (const chip of chips()) {
      const classes = classesOf(chip)

      // Tailwind's 8 = 2rem tall, 3 = 0.75rem either side.
      expect(classes).toContain('min-h-8')
      expect(classes).toContain('px-3')
      expect(classes).toContain('rounded-pill')
      expect(classes).toContain('border-border')
      expect(classes).toContain('bg-surface')
    }
  })
})
