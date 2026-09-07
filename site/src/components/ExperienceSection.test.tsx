import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { experiences } from '../data/resume.ts'
import { ExperienceSection } from './ExperienceSection.tsx'

/*
 * Roles and bullets are asserted against the `experiences` export rather than
 * literals, so a company or a date typed into the component fails here — and
 * because the rendered order is compared for equality against the array's, a
 * component that sorted or reversed the data would fail too. The array is
 * stored most-recent-first (guarded in resume.test.ts), so rendering it in
 * array order *is* the reverse-chronological requirement.
 *
 * jsdom applies no stylesheet, so nothing below actually sits in a column:
 * the timeline's single-column behaviour is asserted as the class names that
 * produce it, plus the manual 320/375/768/1440 checklist in README — the same
 * split the existing suites use.
 */

const HEADING_ID = 'experience-heading'
const HEADING = 'Experience'

function renderSection() {
  return render(<ExperienceSection headingId={HEADING_ID} heading={HEADING} />)
}

/** The timeline: the one list that is not a role's bullet list. */
function timeline() {
  return screen.getByRole('list', { name: '' })
}

function classesOf(element: Element | null | undefined) {
  return (element?.className ?? '').split(/\s+/)
}

describe('ExperienceSection', () => {
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

  it('renders one entry per role, in the data module`s order', () => {
    renderSection()

    // Equality against the array, not containment: a dropped role, an
    // invented one and a re-sorted list all fail here. The array is
    // most-recent-first, so this is the reverse-chronological order.
    expect(
      within(timeline())
        .getAllByRole('heading', { level: 3 })
        .map((heading) => heading.textContent),
    ).toEqual(experiences.map((experience) => experience.title))
  })

  it('renders every company, in the same order', () => {
    const { container } = renderSection()

    const companies = [...container.querySelectorAll('ol > li')].map(
      (entry) => entry.querySelector('h3')?.nextElementSibling?.textContent,
    )

    expect(companies).toEqual(
      experiences.map((experience) => experience.company),
    )
  })

  it('renders the dates and location of every role', () => {
    const { container } = renderSection()

    // By position rather than by heading name: two roles share the title
    // "Senior Application Security Engineer", so a name lookup would be
    // ambiguous — and matching entry *n* against role *n* is the ordering
    // assertion anyway.
    const entries = [...container.querySelectorAll('ol > li')]

    expect(entries).toHaveLength(experiences.length)
    experiences.forEach((experience, index) => {
      expect(entries[index].textContent).toContain(experience.dates)
      expect(entries[index].textContent).toContain(experience.location)
    })
  })

  it('renders every highlight of every role as a bullet, in order', () => {
    const { container } = renderSection()

    const entries = [...container.querySelectorAll('ol > li')]

    experiences.forEach((experience, index) => {
      const bullets = within(entries[index] as HTMLElement).getByRole('list')

      expect(
        within(bullets)
          .getAllByRole('listitem')
          .map((bullet) => bullet.textContent),
      ).toEqual(experience.highlights)
    })
  })

  it('gives every role heading a unique id its bullet list points at', () => {
    const { container } = renderSection()

    const ids = [...container.querySelectorAll('h3')].map((heading) => {
      expect(heading.id).not.toBe('')
      return heading.id
    })

    // Three eBay rows share a company and two rows share a title, so the ids
    // have to come from something unique per entry.
    expect(new Set(ids).size).toBe(experiences.length)
  })

  it('stacks the entries as one left-aligned column at every width', () => {
    const { container } = renderSection()
    const classes = classesOf(timeline())

    expect(classes).toContain('flex')
    expect(classes).toContain('flex-col')
    // No flex gap: the connecting line is each entry's left border, and a gap
    // would cut it into segments — the entries pad themselves apart instead.
    expect(classes.filter((name) => name.includes('gap-'))).toEqual([])

    // Every entry sits on the same side of the same line at every breakpoint:
    // no alternating/two-sided variant, which needs width a phone lacks.
    for (const entry of container.querySelectorAll('ol > li')) {
      const entryClasses = classesOf(entry)

      expect(entryClasses).toContain('border-l')
      expect(entryClasses).toContain('relative')
      expect(entryClasses).toContain('pl-6')

      for (const name of entryClasses) {
        expect(name).not.toMatch(/^(odd|even|md|lg|xl):/)
      }
    }
  })

  it('adds no fixed width or sub-1rem text', () => {
    const { container } = renderSection()

    // The width comes from the shared content column in App.tsx; anything
    // pinned here could be wider than a 320px viewport. Clipped overflow is
    // the other half of that rule, and test/layout-contract.test.ts already
    // checks the source of every file in this directory for it — including
    // this one, which is why the class is not named here.
    for (const element of container.querySelectorAll('[class]')) {
      for (const name of classesOf(element)) {
        expect(name).not.toMatch(/^(min-)?w-\[/)
        expect(name).not.toMatch(/^text-(xs|sm)$/)
      }
    }
  })
})
