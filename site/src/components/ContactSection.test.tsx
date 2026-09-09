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
})
