import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { experiences } from '../data/resume.ts'
import type { Experience } from '../data/types.ts'
import { ExperienceEntry } from './ExperienceEntry.tsx'

/*
 * The entry takes its role as a prop, so most of this renders a fixture: it is
 * the entry's job to render whatever `Experience` it is handed, and a fixture
 * proves it reads the prop instead of any particular resume string. The last
 * describe block then runs every real role through it, which is what catches a
 * heading id that two rows would collide on.
 *
 * jsdom applies no stylesheet, so nothing below actually sits in a column or
 * wraps: the timeline and its responsive behaviour are asserted as the class
 * names that produce them (the connecting line as a left border, the marker
 * absolutely positioned on it, the meta line as a wrapping flex row), plus the
 * manual 320/375/768/1440 checklist in README — the same split the existing
 * suites use.
 */

const fixture: Experience = {
  company: 'Fixture Corp.',
  title: 'Staff Fixture Engineer',
  dates: 'January 2020 - March 2021',
  location: 'Remote',
  highlights: [
    'First fixture highlight',
    'Second fixture highlight',
    'Third fixture highlight',
  ],
}

/** The threshold the component collapses past, restated here rather than
 * imported: these tests should fail if the component quietly moves it. */
const VISIBLE_HIGHLIGHTS = 4

/** A role with `count` distinct bullets. The show-more behaviour is driven by
 * how many highlights an entry has, and no role in `resume.ts` has more than
 * three, so it is exercised against fixtures — asserting it against the real
 * data would mean either padding the resume or a test that passes vacuously. */
function fixtureWithHighlights(count: number): Experience {
  return {
    ...fixture,
    highlights: Array.from(
      { length: count },
      (_unused, index) => `Fixture highlight ${index + 1}`,
    ),
  }
}

/** Entries are <li> elements, so they are rendered in the <ol> the section
 * gives them. */
function renderEntry(experience: Experience = fixture) {
  return render(
    <ol>
      <ExperienceEntry experience={experience} />
    </ol>,
  )
}

/** The entry itself: the only child of the wrapping list. */
function entryOf(container: HTMLElement) {
  const entry = container.querySelector('ol > li')

  expect(entry).not.toBeNull()
  return entry as HTMLElement
}

function classesOf(element: Element | null | undefined) {
  return (element?.className ?? '').split(/\s+/)
}

describe('ExperienceEntry', () => {
  it('renders the company, title, dates and location it is given', () => {
    renderEntry()

    expect(screen.getByText(fixture.company)).toBeDefined()
    expect(screen.getByText(fixture.title)).toBeDefined()
    expect(screen.getByText(fixture.dates)).toBeDefined()
    expect(screen.getByText(fixture.location)).toBeDefined()
  })

  it('heads the role with an h3 and no h1 or h2', () => {
    renderEntry()

    const headings = screen.getAllByRole('heading', { level: 3 })

    expect(headings).toHaveLength(1)
    expect(headings[0].textContent).toBe(fixture.title)
    // The hero owns the document's only <h1>; the section owns the <h2>.
    expect(screen.queryAllByRole('heading', { level: 1 })).toEqual([])
    expect(screen.queryAllByRole('heading', { level: 2 })).toEqual([])
  })

  it('renders exactly the highlights it is given, as bullets', () => {
    renderEntry()

    // Equality, not containment: a dropped bullet and an invented one both
    // fail.
    const bullets = within(
      screen.getByRole('list', { name: fixture.title }),
    ).getAllByRole('listitem')

    expect(bullets.map((bullet) => bullet.textContent)).toEqual(
      fixture.highlights,
    )
  })

  it('labels the bullet list with the role heading', () => {
    renderEntry()

    const heading = screen.getByRole('heading', { level: 3 })
    const bullets = screen.getByRole('list', { name: fixture.title })

    // A screen reader announces which role a bullet belongs to.
    expect(heading.id).not.toBe('')
    expect(bullets.getAttribute('aria-labelledby')).toBe(heading.id)
    expect(bullets.tagName).toBe('UL')
  })

  it('draws the timeline as one left-aligned column: line, then content', () => {
    const { container } = renderEntry()
    const entry = entryOf(container)
    const classes = classesOf(entry)

    // The connecting line is the entry's own left border, so consecutive
    // entries draw one unbroken line...
    expect(classes).toContain('border-l')
    expect(classes).toContain('border-border')
    // ...and the content clears the gutter it runs in.
    expect(classes).toContain('pl-6')
    expect(classes).toContain('relative')

    // Nothing flips the entry to the other side at a wider breakpoint: a
    // two-sided timeline needs width a phone does not have.
    for (const name of classes) {
      expect(name).not.toMatch(/^(odd|even|md|lg|xl):/)
      expect(name).not.toContain('flex-row-reverse')
    }
  })

  it('positions the marker on the line, and hides it from assistive tech', () => {
    const { container } = renderEntry()
    const marker = entryOf(container).querySelector('[aria-hidden="true"]')
    const classes = classesOf(marker)

    expect(classes).toContain('absolute')
    expect(classes).toContain('left-0')
    // Straddles the border rather than sitting beside it.
    expect(classes).toContain('-translate-x-1/2')
    expect(classes).toContain('rounded-pill')
    expect(classes).toContain('bg-accent')
  })

  it('lets the meta line wrap instead of clipping it', () => {
    const { container } = renderEntry()
    const meta = screen.getByText(fixture.dates).parentElement
    const classes = classesOf(meta)

    // At 375px the dates and the location fall onto separate lines rather
    // than widening the page.
    expect(classes).toContain('flex')
    expect(classes).toContain('flex-wrap')
    // 0.5rem or more, so the two do not read as one string.
    expect(classes.filter((name) => name.startsWith('gap-'))).toEqual(['gap-2'])

    // Company, title and dates wrap onto a second line rather than clip.
    expect(container.innerHTML).not.toContain('truncate')
    expect(container.innerHTML).not.toContain('whitespace-nowrap')
  })

  it('sets no text below 1rem anywhere in the entry', () => {
    const { container } = renderEntry()

    // Below 16px, mobile Safari zooms on focus and the layout jumps. The
    // entry's own text is `text-base` and `text-lg`.
    for (const element of container.querySelectorAll('[class]')) {
      for (const name of classesOf(element)) {
        expect(name).not.toMatch(/^text-(xs|sm)$/)
      }
    }
  })

  describe('a long bullet list', () => {
    /** The bullets currently in the DOM, in order. Collapsed bullets are
     * expected to be absent rather than merely hidden with a class, so this
     * reads the list itself and not a subset of it. */
    function visibleHighlights() {
      return within(screen.getByRole('list', { name: fixture.title }))
        .getAllByRole('listitem')
        .map((bullet) => bullet.textContent)
    }

    it('renders every bullet, and no button, at the threshold', () => {
      const experience = fixtureWithHighlights(VISIBLE_HIGHLIGHTS)
      const { container } = renderEntry(experience)

      expect(visibleHighlights()).toEqual(experience.highlights)
      expect(screen.queryByRole('button')).toBeNull()
      // No empty wrapper left behind either: the list is the last thing in the
      // entry, so a short role's layout is exactly what it was.
      expect(entryOf(container).lastElementChild?.tagName).toBe('UL')
    })

    it('collapses the surplus bullets past the threshold, collapsed first', () => {
      const experience = fixtureWithHighlights(VISIBLE_HIGHLIGHTS + 3)
      renderEntry(experience)

      expect(visibleHighlights()).toEqual(
        experience.highlights.slice(0, VISIBLE_HIGHLIGHTS),
      )
      // The hidden bullets are out of the document, not clipped: a screen
      // reader and a sighted reader see the same list.
      for (const highlight of experience.highlights.slice(
        VISIBLE_HIGHLIGHTS,
      )) {
        expect(screen.queryByText(highlight)).toBeNull()
      }

      const button = screen.getByRole('button', { name: 'Show 3 more' })

      expect(button.getAttribute('aria-expanded')).toBe('false')
    })

    it('points the toggle at the bullet list it controls', () => {
      renderEntry(fixtureWithHighlights(VISIBLE_HIGHLIGHTS + 1))

      const button = screen.getByRole('button')
      const controlled = button.getAttribute('aria-controls')
      const list = screen.getByRole('list', { name: fixture.title })

      expect(controlled).not.toBeNull()
      // The id resolves to the list itself, not to a wrapper around it.
      expect(document.getElementById(controlled as string)).toBe(list)
    })

    it('reveals the rest when the toggle is pressed, and hides them again', async () => {
      const user = userEvent.setup()
      const experience = fixtureWithHighlights(VISIBLE_HIGHLIGHTS + 3)
      renderEntry(experience)

      await user.click(screen.getByRole('button', { name: 'Show 3 more' }))

      const expanded = screen.getByRole('button', { name: 'Show less' })

      expect(visibleHighlights()).toEqual(experience.highlights)
      expect(expanded.getAttribute('aria-expanded')).toBe('true')

      await user.click(expanded)

      // Back to the state it started in, label included.
      expect(visibleHighlights()).toEqual(
        experience.highlights.slice(0, VISIBLE_HIGHLIGHTS),
      )
      expect(
        screen
          .getByRole('button', { name: 'Show 3 more' })
          .getAttribute('aria-expanded'),
      ).toBe('false')
    })

    it('sizes the toggle as a 44px tap target', () => {
      renderEntry(fixtureWithHighlights(VISIBLE_HIGHLIGHTS + 1))

      const classes = classesOf(screen.getByRole('button'))

      // 2.75rem tall at 375px, the same floor as the skip link and the
      // header's controls; `items-center` is what makes the padding real
      // rather than leaving the label at the top of the box.
      expect(classes).toContain('min-h-11')
      expect(classes).toContain('inline-flex')
      expect(classes).toContain('items-center')
    })
  })

  describe.each(experiences)('$company, $dates', (experience) => {
    it('renders every string of the real role', () => {
      renderEntry(experience)

      expect(screen.getByText(experience.company)).toBeDefined()
      expect(screen.getByText(experience.title)).toBeDefined()
      expect(screen.getByText(experience.dates)).toBeDefined()
      expect(screen.getByText(experience.location)).toBeDefined()
      expect(
        screen.getAllByRole('listitem').map((bullet) => bullet.textContent),
      ).toEqual(expect.arrayContaining(experience.highlights))
    })

    it('derives a heading id no other role can collide with', () => {
      const { container } = renderEntry(experience)
      const headingId = screen.getByRole('heading', { level: 3 }).id

      // Two eBay rows share a company and two rows share a title, so an id
      // built from either alone would be duplicated once the section renders
      // them all; company plus dates is unique.
      expect(headingId).not.toBe('')
      expect(
        experiences.filter(
          (other) =>
            other.company === experience.company &&
            other.dates === experience.dates,
        ),
      ).toHaveLength(1)
      expect(
        entryOf(container)
          .querySelector('ul')
          ?.getAttribute('aria-labelledby'),
      ).toBe(headingId)
    })
  })
})
