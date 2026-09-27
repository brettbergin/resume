import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { contact } from '../data/resume.ts'
import { FOCUS_RING, TAP_TARGET_HEIGHT } from '../styles.ts'
import { ContactSection } from './ContactSection.tsx'

const HEADING_ID = 'contact-heading'
const HEADING = 'Contact'
/** The section's 1-based place in src/data/sections.ts, which is the number
 * SectionHeading paints in front of the label. App.tsx passes it in. */
const HEADING_INDEX = 6

function renderSection() {
  return render(
    <ContactSection headingId={HEADING_ID} heading={HEADING} index={HEADING_INDEX} />,
  )
}

function classesOf(element: Element | null | undefined) {
  return (element?.className ?? '').split(/\s+/)
}

describe('ContactSection', () => {
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

  it('renders every contact field from the data', () => {
    const { container } = renderSection()

    expect(container.textContent).toContain(contact.email)
    expect(container.textContent).toContain(contact.phone)
    expect(container.textContent).toContain(contact.location)
    expect(container.textContent).toContain(contact.githubUrl)
    expect(container.textContent).toContain(contact.gpgFingerprint)
  })

  it('renders the email as a mailto link with the focus ring and tap target', () => {
    renderSection()

    const link = screen.getByRole('link', { name: contact.email })

    expect(link.getAttribute('href')).toBe(`mailto:${contact.email}`)

    const classes = classesOf(link)
    for (const cls of FOCUS_RING.split(' ')) {
      expect(classes).toContain(cls)
    }
    expect(classes).toContain(TAP_TARGET_HEIGHT)
  })

  it('renders the GitHub URL as an external link with the focus ring and tap target', () => {
    renderSection()

    const link = screen.getByRole('link', { name: contact.githubUrl })

    expect(link.getAttribute('href')).toBe(contact.githubUrl)
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noreferrer')

    const classes = classesOf(link)
    for (const cls of FOCUS_RING.split(' ')) {
      expect(classes).toContain(cls)
    }
    expect(classes).toContain(TAP_TARGET_HEIGHT)
  })

  /*
   * The two inquiry CTAs. Their copy lives in the component rather than in the
   * `contact` export (test/resume-md-sync.test.ts holds that export to
   * resume.md verbatim), so these assert the shape the visitor gets: a
   * `mailto:` to the same address as the plain email link, a subject that says
   * which inquiry it is, and the same focus ring and tap target every other
   * control on the page carries.
   */
  it('renders a technical-consulting CTA as a mailto link with a pre-filled subject', () => {
    renderSection()

    const link = screen.getByRole('link', {
      name: 'Inquire about technical consulting',
    })

    expect(link.getAttribute('href')).toBe(
      `mailto:${contact.email}?subject=${encodeURIComponent('Technical consulting inquiry')}`,
    )

    const classes = classesOf(link)
    for (const cls of FOCUS_RING.split(' ')) {
      expect(classes).toContain(cls)
    }
    expect(classes).toContain(TAP_TARGET_HEIGHT)
  })

  it('renders a Lantern CTA as a separate mailto link with its own subject', () => {
    renderSection()

    const link = screen.getByRole('link', { name: 'Ask about Lantern' })

    expect(link.getAttribute('href')).toBe(
      `mailto:${contact.email}?subject=${encodeURIComponent('Lantern inquiry')}`,
    )

    const classes = classesOf(link)
    for (const cls of FOCUS_RING.split(' ')) {
      expect(classes).toContain(cls)
    }
    expect(classes).toContain(TAP_TARGET_HEIGHT)
  })

  it('gives the two CTAs distinct accessible names and distinct subjects', () => {
    renderSection()

    const consulting = screen.getByRole('link', {
      name: 'Inquire about technical consulting',
    })
    const lantern = screen.getByRole('link', { name: 'Ask about Lantern' })

    expect(consulting).not.toBe(lantern)
    expect(consulting.getAttribute('href')).not.toBe(
      lantern.getAttribute('href'),
    )
  })

  it('says what Lantern is before the link that asks about it', () => {
    const { container } = renderSection()

    // The blurb has to tell a visitor who has never heard of Lantern that it
    // is Brett's, unreleased and in progress — that is what makes the CTA
    // beside it answerable.
    expect(container.textContent).toContain(
      'Lantern is an app Brett is building',
    )
    expect(container.textContent).toContain('has not been released yet')

    const link = screen.getByRole('link', { name: 'Ask about Lantern' })
    const blurb = Array.from(container.querySelectorAll('p')).find((node) =>
      (node.textContent ?? '').includes('Lantern is an app Brett is building'),
    )

    if (blurb === undefined) throw new Error('no Lantern blurb was rendered')

    // DOCUMENT_POSITION_FOLLOWING: the link comes after the blurb in reading
    // order, so a screen reader hears the description first.
    expect(
      blurb.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })
})
