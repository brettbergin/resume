import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
 *
 * The section collapses everything past the 3 most recent roles behind its
 * own toggle, independent of each entry's per-entry show-more toggle. Most of
 * the tests below therefore expand it first (`renderExpanded`) so the
 * existing "every role, in order" assertions still exercise the full,
 * unmodified render the page reproduces once a reader opts in; a dedicated
 * pair of tests covers the collapsed default and the toggle itself.
 */

const HEADING_ID = 'experience-heading'
const HEADING = 'Experience'
/** The section's 1-based place in src/data/sections.ts, which is the number
 * SectionHeading paints in front of the label. App.tsx passes it in. */
const HEADING_INDEX = 3
const VISIBLE_ROLES = 3
const HIDDEN_COUNT = experiences.length - VISIBLE_ROLES

function renderSection() {
  return render(
    <ExperienceSection headingId={HEADING_ID} heading={HEADING} index={HEADING_INDEX} />,
  )
}

/** The timeline: the one list that is not a role's bullet list. */
function timeline() {
  return screen.getByRole('list', { name: '' })
}

function toggleButton() {
  return screen.getByRole('button', { name: /earlier role/i })
}

/** The section, expanded to its full 8-role render. */
async function renderExpanded() {
  const utils = renderSection()
  await userEvent.click(toggleButton())
  return utils
}

function classesOf(element: Element | null | undefined) {
  return (element?.className ?? '').split(/\s+/)
}

describe('ExperienceSection', () => {
  it('renders the heading it is given, as an h2, and no h1', () => {
    renderSection()

    const headings = screen.getAllByRole('heading', { level: 2 })

    expect(headings).toHaveLength(1)
    // By accessible name: SectionHeading's `NN /` prefix and its scrambling
    // copy of the label are both aria-hidden, so the element's textContent is
    // no longer the label on its own.
    expect(headings[0]).toBe(
      screen.getByRole('heading', { level: 2, name: HEADING }),
    )
    // App.tsx labels the wrapping <section> with this id; the section owns it.
    expect(headings[0].id).toBe(HEADING_ID)
    // The hero owns the document's only <h1>.
    expect(screen.queryAllByRole('heading', { level: 1 })).toEqual([])
  })

  describe('the section-level toggle', () => {
    it('renders only the 3 most recent roles by default, and no more', () => {
      renderSection()

      expect(
        within(timeline())
          .getAllByRole('heading', { level: 3 })
          .map((heading) => heading.textContent),
      ).toEqual(
        experiences.slice(0, VISIBLE_ROLES).map((experience) => experience.title),
      )

      // The collapsed roles are absent from the DOM, not merely hidden.
      for (const experience of experiences.slice(VISIBLE_ROLES)) {
        expect(screen.queryByText(experience.title)).toBeNull()
      }
    })

    it('labels the toggle with the count of hidden roles, collapsed by default', () => {
      renderSection()

      const button = screen.getByRole('button', {
        name: `Show ${HIDDEN_COUNT} earlier roles`,
      })

      expect(button.getAttribute('aria-expanded')).toBe('false')
      // Points at the timeline itself — the list the revealed roles land in.
      const controlled = button.getAttribute('aria-controls')

      expect(controlled).not.toBeNull()
      expect(document.getElementById(controlled as string)).toBe(timeline())
    })

    it('reveals the remaining roles in order when activated, and hides them again', async () => {
      const user = userEvent.setup()
      renderSection()

      await user.click(toggleButton())

      const expandedButton = screen.getByRole('button', { name: 'Show less' })

      expect(expandedButton.getAttribute('aria-expanded')).toBe('true')
      expect(
        within(timeline())
          .getAllByRole('heading', { level: 3 })
          .map((heading) => heading.textContent),
      ).toEqual(experiences.map((experience) => experience.title))

      await user.click(expandedButton)

      expect(
        screen.getByRole('button', {
          name: `Show ${HIDDEN_COUNT} earlier roles`,
        }).getAttribute('aria-expanded'),
      ).toBe('false')
      expect(
        within(timeline())
          .getAllByRole('heading', { level: 3 })
          .map((heading) => heading.textContent),
      ).toEqual(
        experiences.slice(0, VISIBLE_ROLES).map((experience) => experience.title),
      )
    })

    it('inserts the revealed roles directly after the 3 always-visible ones', async () => {
      const { container } = await renderExpanded()

      const titles = [...container.querySelectorAll('ol > li h3')].map(
        (heading) => heading.textContent,
      )

      expect(titles).toEqual(experiences.map((experience) => experience.title))
    })

    it('gives the toggle the shared focus ring and tap-target floor', () => {
      renderSection()

      const classes = classesOf(toggleButton())

      expect(classes).toContain('min-h-11')
      expect(classes).toContain('focus-visible:outline-2')
      expect(classes).toContain('focus-visible:outline-offset-2')
      expect(classes).toContain('focus-visible:outline-accent')

      // The dark-mode halo rides alongside the ring, never in place of it.
      expect(classes).toContain('hover:glow-ring')
      expect(classes).toContain('focus-visible:glow-ring')
    })
  })

  it('renders one entry per role, in the data module`s order', async () => {
    await renderExpanded()

    // Equality against the array, not containment: a dropped role, an
    // invented one and a re-sorted list all fail here. The array is
    // most-recent-first, so this is the reverse-chronological order.
    expect(
      within(timeline())
        .getAllByRole('heading', { level: 3 })
        .map((heading) => heading.textContent),
    ).toEqual(experiences.map((experience) => experience.title))
  })

  it('renders every company, in the same order', async () => {
    const { container } = await renderExpanded()

    const companies = [...container.querySelectorAll('ol > li')].map(
      (entry) => entry.querySelector('h3')?.nextElementSibling?.textContent,
    )

    expect(companies).toEqual(
      experiences.map((experience) => experience.company),
    )
  })

  it('renders the dates and location of every role', async () => {
    const { container } = await renderExpanded()

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

  it('renders every highlight of every role as a bullet, in order', async () => {
    const { container } = await renderExpanded()

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

  it('gives every role heading a unique id its bullet list points at', async () => {
    const { container } = await renderExpanded()

    const ids = [...container.querySelectorAll('h3')].map((heading) => {
      expect(heading.id).not.toBe('')
      return heading.id
    })

    // Three eBay rows share a company and two rows share a title, so the ids
    // have to come from something unique per entry.
    expect(new Set(ids).size).toBe(experiences.length)
  })

  it('stacks the entries as one left-aligned column at every width, collapsed', () => {
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

  it('stacks the entries as one left-aligned column at every width, expanded', async () => {
    const { container } = await renderExpanded()
    const classes = classesOf(timeline())

    expect(classes).toContain('flex')
    expect(classes).toContain('flex-col')
    expect(classes.filter((name) => name.includes('gap-'))).toEqual([])

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

  it('adds no fixed width or sub-1rem text', async () => {
    const { container } = await renderExpanded()

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
