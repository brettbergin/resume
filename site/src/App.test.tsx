import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from './App.tsx'
import { contact, summary } from './data/resume.ts'
import { sections } from './data/sections.ts'

/*
 * Shell-level guards, as opposed to the per-component tests next to Header,
 * Footer and ThemeToggle: that the page has exactly one of each landmark, that
 * no nav link points at an id the page does not render, that the skip link is
 * genuinely first in tab order, and that the toggle in the header reaches the
 * class the palette hangs off.
 *
 * jsdom cannot scroll, so "nav links scroll to the right section" is asserted
 * in its mechanical form: every same-page href resolves to an element that
 * exists in the document. It also applies no stylesheet, so both the inline
 * nav and the mobile panel are visible to queries here — the panel is opened
 * explicitly where its links are the subject.
 */

/** Registry entries whose content has been built; the rest still render the
 * label-plus-"Coming soon." placeholder. Extend as sections land. */
const FILLED_SECTION_IDS: string[] = ['about']

/** Every same-page anchor in the document: the skip link plus both navs. */
function fragmentLinks(): HTMLAnchorElement[] {
  return Array.from(
    document.querySelectorAll<HTMLAnchorElement>('a[href^="#"]'),
  )
}

function expectTargetsExist(links: HTMLAnchorElement[]) {
  expect(links).not.toHaveLength(0)
  for (const link of links) {
    const id = link.getAttribute('href')!.slice(1)
    expect(document.getElementById(id), `#${id}`).not.toBeNull()
  }
}

// jsdom never fires media query changes, and the theme falls back to
// `prefers-color-scheme`; pin it to light so the toggle starts in a known
// state.
function stubPrefersLight() {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      media: '(prefers-color-scheme: dark)',
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    })),
  )
}

beforeEach(() => {
  stubPrefersLight()
  window.localStorage.clear()
  document.documentElement.classList.remove('dark')
})

afterEach(() => {
  vi.unstubAllGlobals()
  window.localStorage.clear()
  document.documentElement.classList.remove('dark')
})

describe('App landmarks', () => {
  it('renders exactly one banner, one main and one contentinfo', () => {
    render(<App />)

    expect(screen.getAllByRole('banner')).toHaveLength(1)
    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(screen.getAllByRole('contentinfo')).toHaveLength(1)
  })

  it('gives <main> the id the skip link targets', () => {
    render(<App />)

    expect(screen.getByRole('main').id).toBe('main')
  })
})

describe('App sections', () => {
  it('renders one section per registry entry, in order', () => {
    render(<App />)

    const rendered = Array.from(
      screen.getByRole('main').querySelectorAll('section[id]'),
    )

    expect(rendered.map((section) => section.id)).toEqual(
      sections.map((section) => section.id),
    )
  })

  it('still renders the registry label as the heading of every placeholder', () => {
    render(<App />)

    const placeholders = sections.filter(
      (section) => !FILLED_SECTION_IDS.includes(section.id),
    )

    expect(placeholders).not.toHaveLength(0)
    for (const section of placeholders) {
      const element = document.getElementById(section.id)!
      expect(within(element).getByRole('heading').textContent).toBe(
        section.label,
      )
      expect(within(element).getByText('Coming soon.')).toBeDefined()
    }
  })
})

/*
 * The hero is unit-tested next to the component; asserted here is only what
 * the shell is responsible for — that it is mounted in the right section, and
 * that plugging an <h1> into a `aria-labelledby` wrapper left the document
 * with one top-level heading pointing at the right place.
 */
describe('App about section', () => {
  /** Scoped: the footer also has links named "GitHub" and "Email". */
  function about() {
    return document.getElementById('about')!
  }

  it('fills the about section with the hero instead of a placeholder', () => {
    render(<App />)

    expect(within(about()).getByText(summary.professionalSummary)).toBeDefined()
    expect(within(about()).queryByText('Coming soon.')).toBeNull()
  })

  it('has exactly one h1, holding the name, inside #about', () => {
    render(<App />)

    const headings = screen.getAllByRole('heading', { level: 1 })

    expect(headings).toHaveLength(1)
    expect(headings[0].textContent).toBe(summary.name)
    expect(about().contains(headings[0])).toBe(true)
  })

  it('labels the section by the heading the hero renders', () => {
    render(<App />)

    const labelledBy = about().getAttribute('aria-labelledby')!
    const heading = document.getElementById(labelledBy)

    expect(heading).toBe(screen.getByRole('heading', { level: 1 }))
  })

  it('points the hero CTAs at the PDF, the GitHub profile and the email', () => {
    render(<App />)

    const scope = within(about())

    expect(
      scope.getByRole('link', { name: /download pdf/i }).getAttribute('href'),
    ).toBe(`${import.meta.env.BASE_URL}${summary.resumePdfFileName}`)
    expect(
      scope.getByRole('link', { name: 'GitHub' }).getAttribute('href'),
    ).toBe(contact.githubUrl)
    expect(
      scope.getByRole('link', { name: 'Email' }).getAttribute('href'),
    ).toBe(`mailto:${contact.email}`)
  })
})

describe('App nav targets', () => {
  it('points every same-page link at an id that exists on the page', () => {
    render(<App />)

    expectTargetsExist(fragmentLinks())
  })

  it('points every mobile menu link at an id that exists on the page', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /^menu$/i }))
    const dialog = screen.getByRole('dialog')
    const links = within(dialog).getAllByRole('link') as HTMLAnchorElement[]

    expect(links).toHaveLength(sections.length)
    expectTargetsExist(links)
  })
})

describe('App skip link', () => {
  it('is the first focusable element and targets #main', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.tab()

    const focused = document.activeElement as HTMLAnchorElement
    expect(focused.tagName).toBe('A')
    expect(focused.textContent).toBe('Skip to content')
    expect(focused.getAttribute('href')).toBe('#main')
    expect(document.getElementById('main')).toBe(screen.getByRole('main'))
  })

  it('is hidden until it takes focus rather than removed from tab order', () => {
    render(<App />)

    const skipLink = screen.getByRole('link', { name: 'Skip to content' })
    expect(skipLink.className).toContain('sr-only')
    expect(skipLink.className).toContain('focus:not-sr-only')
    expect(skipLink.getAttribute('tabindex')).toBeNull()
  })
})

describe('App theme toggle', () => {
  it('is rendered inside the header', () => {
    render(<App />)

    const banner = screen.getByRole('banner')
    expect(
      within(banner).getByRole('button', { name: /switch to .* theme/i }),
    ).toBeDefined()
  })

  it('flips the dark class on <html> when used', async () => {
    const user = userEvent.setup()
    render(<App />)

    const banner = screen.getByRole('banner')
    const toggle = within(banner).getByRole('button', {
      name: /switch to .* theme/i,
    })
    expect(document.documentElement.classList.contains('dark')).toBe(false)

    await user.click(toggle)
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    await user.click(toggle)
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })
})
