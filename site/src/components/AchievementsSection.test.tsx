import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { achievements } from '../data/resume.ts'
import { AchievementsSection } from './AchievementsSection.tsx'

/*
 * Cards and callouts are asserted against the `achievements` export rather
 * than literals, so a bullet retyped into the component fails here — and
 * because the rendered card set is compared for equality, a dropped
 * achievement and an invented one fail the same way. Every digit the section
 * renders is checked back against the data, which is what keeps a made-up
 * figure out of a section whose whole point is figures.
 *
 * jsdom applies no stylesheet, so nothing below actually sits in a grid or
 * scales with the viewport: the responsive behaviour is asserted as the class
 * names that produce it (one column of cards that becomes two at `md` and
 * three at `lg`, a callout on named font-size steps that wraps) plus the
 * manual 320/375/768/1440 checklist in README — the same split the existing
 * suites use.
 */

const HEADING_ID = 'achievements-heading'
const HEADING = 'Key Achievements'

function renderSection() {
  return render(
    <AchievementsSection headingId={HEADING_ID} heading={HEADING} />,
  )
}

/** The cards: every achievement is one list item and nothing else in the
 * section is one. */
function cards() {
  return screen.getAllByRole('listitem')
}

/** The bullet paragraph of a card — the achievement's full text. */
function bulletOf(card: Element) {
  return card.querySelector('p')?.textContent ?? ''
}

/** The pulled-out figure of a card, or `null` when it has none. */
function calloutOf(card: Element) {
  return card.querySelector('[aria-hidden="true"]')
}

function classesOf(element: Element | null | undefined) {
  return (element?.className ?? '').split(/\s+/)
}

describe('AchievementsSection', () => {
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

  it('renders exactly the achievements the data lists, in order, as cards', () => {
    renderSection()

    // Equality, not containment: an achievement dropped from the data's order
    // and one invented in the component both fail.
    expect(cards().map(bulletOf)).toEqual(
      achievements.map((achievement) => achievement.text),
    )
  })

  it('collects the cards in a single list', () => {
    renderSection()

    const lists = screen.getAllByRole('list')

    expect(lists).toHaveLength(1)
    expect(lists[0].querySelectorAll('li')).toHaveLength(achievements.length)
  })

  it('leads a card with its metric, and only when the data has one', () => {
    renderSection()

    const rendered = cards()

    achievements.forEach((achievement, index) => {
      const callout = calloutOf(rendered[index])

      if (achievement.metric === undefined) {
        expect(callout).toBeNull()
        return
      }

      expect(callout?.textContent).toBe(achievement.metric)
      // The figure comes first, the full bullet underneath it.
      expect(callout).toBe(rendered[index].firstElementChild)
    })
  })

  it('hides the callouts from a screen reader, which hears the bullet', () => {
    renderSection()

    const callouts = cards().map(calloutOf).filter(Boolean)

    expect(callouts).toHaveLength(
      achievements.filter((achievement) => achievement.metric !== undefined)
        .length,
    )

    for (const callout of callouts) {
      // Each metric is a verbatim substring of its bullet, so announcing it
      // would read the same words twice.
      expect(callout?.getAttribute('aria-hidden')).toBe('true')
    }
  })

  it('renders no percentage, rating or progress bar', () => {
    const { container } = renderSection()

    expect(screen.queryAllByRole('progressbar')).toEqual([])
    expect(screen.queryAllByRole('meter')).toEqual([])
    expect(container.innerHTML).not.toContain('%')
  })

  it('renders no figure the data does not already carry', () => {
    const { container } = renderSection()

    const fromData = achievements
      .map((achievement) => achievement.text)
      .join(' ')

    // Every run of digits on the page traces back to the resume's own wording;
    // a count derived in the view (7 achievements, a made-up multiple) fails.
    for (const digits of (container.textContent ?? '').match(/\d+/g) ?? []) {
      expect(fromData).toContain(digits)
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

  it('sizes the metric callouts to scale and to wrap inside their card', () => {
    renderSection()

    const callouts = cards().map(calloutOf).filter(Boolean)

    expect(callouts.length).toBeGreaterThan(0)

    for (const callout of callouts) {
      const classes = classesOf(callout)

      // Named steps, not a bracketed size: 1.5rem on a phone, 1.875rem from
      // `md` up.
      expect(classes).toContain('text-2xl')
      expect(classes).toContain('md:text-3xl')
      // Without this, `500,000+ endpoints` pushes its card past a 320px
      // viewport.
      expect(classes).toContain('break-words')
      expect(classes).toContain('text-accent')
    }
  })

  it('gives every card the same surface the skills cards use', () => {
    renderSection()

    for (const card of cards()) {
      const classes = classesOf(card)

      expect(classes).toContain('rounded-card')
      expect(classes).toContain('border-border')
      expect(classes).toContain('bg-surface')
      expect(classes).toContain('p-4')
    }
  })

  it('tilts every card toward the pointer', () => {
    renderSection()

    for (const card of cards()) {
      // `tilt-card` is the index.css utility that owns the perspective, the
      // settle-back transition and the specular gradient; src/useTilt.ts
      // writes the custom properties it reads, and no-ops on a touch screen
      // or under reduced motion, where the utility's own rest values keep the
      // card flat.
      expect(classesOf(card)).toContain('tilt-card')
    }
  })
})
