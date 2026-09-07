import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { contact, summary } from '../data/resume.ts'
import { HeroSection } from './HeroSection.tsx'

/*
 * Text and hrefs are asserted against the data exports rather than literals,
 * so a string typed into the component fails here.
 *
 * jsdom applies no stylesheet, so nothing below actually stacks or sits in a
 * row: the responsive behaviour is asserted as the class names that produce it
 * (a 44px tap target, a column of full-width buttons that becomes a row from
 * `sm` up) plus the manual 375/768/1440 checklist in README — the same split
 * the existing suites use.
 */

const HEADING_ID = 'about-heading'

/** The three CTAs in the order the issue asks for them. */
function ctas() {
  return [
    screen.getByRole('link', { name: /download pdf/i }),
    screen.getByRole('link', { name: /github/i }),
    screen.getByRole('link', { name: /email/i }),
  ]
}

describe('HeroSection', () => {
  it('renders the name as the only h1, carrying the id it is given', () => {
    render(<HeroSection headingId={HEADING_ID} />)

    const headings = screen.getAllByRole('heading', { level: 1 })

    expect(headings).toHaveLength(1)
    expect(headings[0].textContent).toBe(summary.name)
    // App.tsx labels the wrapping <section> with this id; the hero owns it.
    expect(headings[0].id).toBe(HEADING_ID)
  })

  it('renders the title, location and professional summary from the data', () => {
    render(<HeroSection headingId={HEADING_ID} />)

    expect(screen.getByText(summary.title)).toBeDefined()
    expect(screen.getByText(contact.location)).toBeDefined()
    expect(screen.getByText(summary.professionalSummary)).toBeDefined()
  })

  it('renders no resume content that is not in the data module', () => {
    const { container } = render(<HeroSection headingId={HEADING_ID} />)

    // The phone number and the GPG fingerprint are in `contact` but are not
    // for a public page; the footer keeps them off too.
    expect(container.innerHTML).not.toContain(contact.phone)
    expect(container.innerHTML).not.toContain(contact.gpgFingerprint)
  })

  it('links the download to the resume PDF under the site base path', () => {
    render(<HeroSection headingId={HEADING_ID} />)

    const link = screen.getByRole('link', { name: /download pdf/i })

    // Served from a project page, so the file lives under BASE_URL rather than
    // at the server root.
    expect(link.getAttribute('href')).toBe(
      `${import.meta.env.BASE_URL}${summary.resumePdfFileName}`,
    )
    expect(link.hasAttribute('download')).toBe(true)
    expect(link.hasAttribute('target')).toBe(false)
  })

  it('opens the GitHub profile in a new tab, safely', () => {
    render(<HeroSection headingId={HEADING_ID} />)

    const link = screen.getByRole('link', { name: /github/i })

    expect(link.getAttribute('href')).toBe(contact.githubUrl)
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('links the email address as a mailto in the same tab', () => {
    render(<HeroSection headingId={HEADING_ID} />)

    const link = screen.getByRole('link', { name: /email/i })

    expect(link.getAttribute('href')).toBe(`mailto:${contact.email}`)
    expect(link.hasAttribute('target')).toBe(false)
  })

  it('offers the three CTAs in order', () => {
    render(<HeroSection headingId={HEADING_ID} />)

    const links = screen.getAllByRole('link')

    expect(links.map((link) => (link.textContent ?? '').trim())).toEqual([
      'Download PDF',
      'GitHub',
      'Email',
    ])
  })

  it('gives every CTA a 44px tap target and the shared focus ring', () => {
    render(<HeroSection headingId={HEADING_ID} />)

    for (const cta of ctas()) {
      const classes = cta.className.split(/\s+/)

      // Tailwind's 11 = 2.75rem = 44px, the minimum comfortable touch size.
      expect(classes).toContain('min-h-11')
      expect(classes).toContain('focus-visible:outline-accent')
    }
  })

  it('stacks the CTAs full width on a phone and puts them in a row from sm up', () => {
    render(<HeroSection headingId={HEADING_ID} />)

    for (const cta of ctas()) {
      const classes = cta.className.split(/\s+/)

      expect(classes).toContain('w-full')
      expect(classes).toContain('sm:w-auto')
    }

    const group = ctas()[0].parentElement
    const classes = (group?.className ?? '').split(/\s+/)

    expect(classes).toContain('flex-col')
    expect(classes).toContain('sm:flex-row')
    // 44px targets stacked directly on top of each other need visible space
    // between them; `gap-3` is 0.75rem.
    expect(classes.filter((name) => name.startsWith('gap-'))).toEqual(['gap-3'])
  })
})
