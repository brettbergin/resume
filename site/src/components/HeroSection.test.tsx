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

  it('gives every CTA a 44px, full-width-on-a-phone tap target and the shared focus ring', () => {
    render(<HeroSection headingId={HEADING_ID} />)

    for (const cta of ctas()) {
      const classes = cta.className.split(/\s+/)

      // Tailwind's 11 = 2.75rem = 44px, the minimum comfortable touch size.
      expect(classes).toContain('min-h-11')
      // The other half of the phone tap target: 44px tall *and* the full
      // column wide below `sm`, content width once the buttons sit in a row.
      // Both come from the shared `CTA` class string, so this is what stops a
      // restyle there from quietly shrinking the Download PDF target — the
      // README's manual checklist walks the rendered result.
      expect(classes).toContain('w-full')
      expect(classes).toContain('sm:w-auto')
      expect(classes).toContain('focus-visible:outline-accent')
      // Additive to that ring, not a replacement for it: `glow-ring` is a
      // box-shadow and only paints inside `.dark`.
      expect(classes).toContain('hover:glow-ring')
      expect(classes).toContain('focus-visible:glow-ring')
      // The hover sweep and the clip that keeps its bar inside the pill.
      // `overflow-hidden` clips the bar, not the focus ring above it: that
      // ring is an outline, drawn outside the border box.
      expect(classes).toContain('sweep')
      expect(classes).toContain('overflow-hidden')
    }
  })

  it('sets the name as oversized, weight-reactive display type', () => {
    render(<HeroSection headingId={HEADING_ID} />)

    const classes = screen
      .getByRole('heading', { level: 1 })
      .className.split(/\s+/)

    // The axis itself is index.css's `hero-weight`; src/useHeroWeight.ts only
    // writes the `--hero-wght` the utility reads.
    expect(classes).toContain('hero-weight')
    // One oversized line, at named steps rather than a bracketed size —
    // test/layout-contract.test.ts keeps arbitrary font sizes out of here.
    expect(classes).toContain('text-5xl')
    expect(classes).toContain('md:text-7xl')
    expect(classes).toContain('tracking-tight')
    // The halo stays: test/rice-contract.test.ts pins it on this tag.
    expect(classes).toContain('glow-text')
  })

  it("moves the name's weight with the pointer over the hero", () => {
    const { container } = render(<HeroSection headingId={HEADING_ID} />)

    const hero = container.firstElementChild as HTMLElement
    // jsdom lays nothing out, and the hook skips a zero-width rect.
    hero.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 400, height: 120, right: 400, bottom: 120, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect

    hero.dispatchEvent(
      new MouseEvent('pointermove', { clientX: 300, clientY: 60, bubbles: true }),
    )

    // The property is written on the container and inherited by the <h1>,
    // which is what carries `hero-weight`. Its exact mapping is
    // src/useHeroWeight.test.ts's; here it only has to be on the axis.
    const weight = Number(hero.style.getPropertyValue('--hero-wght'))
    expect(weight).toBeGreaterThanOrEqual(300)
    expect(weight).toBeLessThanOrEqual(800)
  })

  it('stacks the CTAs on a phone and puts them in a row from sm up', () => {
    render(<HeroSection headingId={HEADING_ID} />)

    const group = ctas()[0].parentElement
    const classes = (group?.className ?? '').split(/\s+/)

    expect(classes).toContain('flex-col')
    expect(classes).toContain('sm:flex-row')
    // 44px targets stacked directly on top of each other need visible space
    // between them; `gap-3` is 0.75rem.
    expect(classes.filter((name) => name.startsWith('gap-'))).toEqual(['gap-3'])
  })
})
