import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { contact } from '../data/resume.ts'
import { Footer } from './Footer.tsx'

/*
 * The hrefs are asserted against the data exports rather than literals, so a
 * hardcoded address in the component fails here. The last test is the reason
 * this file exists at all: the footer must never leak the phone number or the
 * GPG fingerprint that also live in `contact`.
 */

describe('Footer', () => {
  it('links to the email address from the resume data', () => {
    render(<Footer />)

    const link = screen.getByRole('link', { name: /email/i })

    expect(link.getAttribute('href')).toBe(`mailto:${contact.email}`)
  })

  it('links to the GitHub profile from the resume data', () => {
    render(<Footer />)

    const link = screen.getByRole('link', { name: /github/i })

    expect(link.getAttribute('href')).toBe(contact.githubUrl)
  })

  it('opens the GitHub link safely when it targets a new tab', () => {
    render(<Footer />)

    const link = screen.getByRole('link', { name: /github/i })

    if (link.getAttribute('target') === '_blank') {
      expect(link.getAttribute('rel')).toMatch(/noreferrer/)
    }
  })

  it('gives every link an accessible name that says where it goes', () => {
    render(<Footer />)

    const links = screen.getAllByRole('link')

    expect(links.length).toBeGreaterThan(0)
    for (const link of links) {
      expect((link.textContent ?? '').trim()).not.toBe('')
    }
    expect(links.map((link) => (link.textContent ?? '').trim())).toEqual([
      'Email',
      'GitHub',
    ])
  })

  it('groups the contact links as a list, not a second nav landmark', () => {
    // The header's <nav aria-label="Primary"> is the page's one navigation
    // landmark. These two are contact details — a mailto and an external
    // profile — so they are a list; src/a11y.test.tsx asserts the page-wide
    // count that this keeps at one.
    render(<Footer />)

    expect(screen.queryByRole('navigation')).toBeNull()

    const list = screen.getByRole('list')
    const items = within(list).getAllByRole('listitem')

    expect(items).toHaveLength(2)
    for (const item of items) {
      expect(within(item).getAllByRole('link')).toHaveLength(1)
    }
  })

  it('credits the stack the site is built with', () => {
    render(<Footer />)

    expect(screen.getByText(/react \+ typescript/i)).toBeDefined()
  })

  it('renders neither the phone number nor the GPG fingerprint', () => {
    const { container } = render(<Footer />)

    expect(container.innerHTML).not.toContain(contact.phone)
    expect(container.innerHTML).not.toContain(contact.gpgFingerprint)
    // Also catch the digits arriving in some other formatting.
    const digits = (container.textContent ?? '').replace(/\D/g, '')
    expect(digits).not.toContain(contact.phone.replace(/\D/g, ''))
  })
})
