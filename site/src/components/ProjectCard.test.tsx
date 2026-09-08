import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { projects } from '../data/resume.ts'
import type { Project } from '../data/types.ts'
import { ProjectCard } from './ProjectCard.tsx'

/*
 * The card is rendered against every entry of the `projects` export rather
 * than against literals, so a name, description or URL retyped into the
 * component fails here. A fixture stands in only where the point is a shape
 * the resume does not happen to contain today (a long description).
 *
 * jsdom applies no stylesheet, so nothing below is actually a 44px box or
 * fills a grid cell: the tap target and the full-cell card are asserted as the
 * class names that produce them, plus the manual 320/375/768/1440 checklist in
 * README — the same split the existing suites use.
 */

function classesOf(element: Element | null | undefined) {
  return (element?.className ?? '').split(/\s+/)
}

/** The card itself: the link is the surface, not something inside it. */
function card() {
  return screen.getByRole('link')
}

describe('ProjectCard', () => {
  it.each(projects)('renders $name as one link to its repo', (project) => {
    render(<ProjectCard project={project} />)

    const link = card()

    expect(screen.getAllByRole('link')).toHaveLength(1)
    // The data's URL verbatim — not a github.com address rebuilt from the name.
    expect(link.getAttribute('href')).toBe(project.url)
    expect(link.textContent).toBe(`${project.name}${project.description}`)
  })

  it.each(projects)('names $name as the card heading', (project) => {
    render(<ProjectCard project={project} />)

    const heading = screen.getByRole('heading', { level: 3 })

    expect(heading.textContent).toBe(project.name)
    // Inside the link, so the project name is what the link is announced as.
    expect(card().contains(heading)).toBe(true)
    // The hero owns the document's only <h1>, the section its <h2>.
    expect(screen.queryAllByRole('heading', { level: 1 })).toEqual([])
    expect(screen.queryAllByRole('heading', { level: 2 })).toEqual([])
  })

  it.each(projects)('opens $name in a new tab, safely', (project) => {
    render(<ProjectCard project={project} />)

    const link = card()

    expect(link.getAttribute('target')).toBe('_blank')
    // Both keywords: no `window.opener` handle back to this page, and no
    // referrer leaked to the repo.
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('makes the whole card the tap target, not a link inside it', () => {
    render(<ProjectCard project={projects[0]} />)

    const classes = classesOf(card())

    // The surface *is* the anchor: it fills its grid cell...
    expect(classes).toContain('flex')
    expect(classes).toContain('h-full')
    // ...and is never shorter than the 44px minimum touch size.
    expect(classes).toContain('min-h-11')
  })

  it('gives the card the same surface the achievements cards use', () => {
    render(<ProjectCard project={projects[0]} />)

    const classes = classesOf(card())

    expect(classes).toContain('rounded-card')
    expect(classes).toContain('border-border')
    expect(classes).toContain('bg-surface')
    expect(classes).toContain('p-4')
  })

  it('shows a keyboard user where they are', () => {
    render(<ProjectCard project={projects[0]} />)

    expect(classesOf(card())).toContain('focus-visible:outline-accent')
  })

  it('halos the card on hover and on keyboard focus', () => {
    render(<ProjectCard project={projects[0]} />)

    const classes = classesOf(card())

    // `glow-ring` is a box-shadow scoped to `.dark` in index.css, so it is
    // additive to the outline above rather than a second focus indicator —
    // and it paints nothing at all in the light palette.
    expect(classes).toContain('hover:glow-ring')
    expect(classes).toContain('focus-visible:glow-ring')
  })

  it('tilts the card toward the pointer', () => {
    render(<ProjectCard project={projects[0]} />)

    // `tilt-card` is the index.css utility that owns the perspective, the
    // settle-back transition and the specular gradient; src/useTilt.ts writes
    // the custom properties it reads, and no-ops on a touch screen or under
    // reduced motion, where the utility's own rest values keep the card flat.
    expect(classesOf(card())).toContain('tilt-card')
  })

  it('wraps a long description instead of clipping it', () => {
    // Longer than any description in the resume today: the card has to grow,
    // because on a 320px screen there is nowhere else for the words to go.
    const wordy: Project = {
      name: 'a-project-with-a-hyphenated-name',
      description:
        'A deliberately long description, longer than anything in the resume, so that a fixed height or a truncation utility on the card would be visible here.',
      url: 'https://example.com/a-project',
    }

    const { container } = render(<ProjectCard project={wordy} />)

    expect(card().textContent).toContain(wordy.description)

    for (const element of container.querySelectorAll('*')) {
      const classes = classesOf(element)

      // No clipping and no height the text has to fit inside — only the
      // `min-h-*` floor, which the card may grow past.
      expect(classes).not.toContain('truncate')
      expect(classes).not.toContain('overflow-hidden')
      expect(
        classes.filter((name) => /^(h|max-h)-/.test(name) && name !== 'h-full'),
      ).toEqual([])
      expect(classes.filter((name) => name.startsWith('line-clamp-'))).toEqual(
        [],
      )
    }
  })
})
