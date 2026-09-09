import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { summary } from '../data/resume.ts'
import { routes } from '../data/routes.ts'
import { sections } from '../data/sections.ts'
import { Header } from './Header.tsx'

/*
 * The mobile menu is hand-rolled, so everything a browser would normally give
 * a <dialog> — focus in on open, Tab containment, Escape to dismiss, a frozen
 * background — is this component's own code and is covered here.
 *
 * jsdom applies no stylesheet, so `hidden md:flex` does not actually hide the
 * inline nav in these tests. Queries are therefore scoped to a named <nav> or
 * to the open dialog rather than run against the whole document.
 */

/** The panel's focusables, in DOM order: the close button, then the links. */
function focusablesIn(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>('a[href], button:not([disabled])'),
  )
}

function menuButton() {
  return screen.getByRole('button', { name: /menu/i })
}

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(menuButton())
  return screen.getByRole('dialog')
}

type Listener = (event: MediaQueryListEvent) => void

/**
 * A controllable stand-in for the `md` media query the header watches. jsdom
 * parses media queries but never re-evaluates them and never fires `change`,
 * so a viewport crossing the breakpoint — a phone unfolding, a tablet
 * rotating — has to be simulated. The query is driven from the outside, never
 * through the component, so these assertions hold however the header decides
 * to observe the width.
 */
function mockViewport(initiallyWide: boolean) {
  let matches = initiallyWide
  const listeners = new Set<Listener>()

  const query = {
    media: '(min-width: 48rem)',
    get matches() {
      return matches
    },
    addEventListener(_type: 'change', listener: Listener) {
      listeners.add(listener)
    },
    removeEventListener(_type: 'change', listener: Listener) {
      listeners.delete(listener)
    },
  }

  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => query),
  )

  return {
    listenerCount: () => listeners.size,
    /** Cross the breakpoint: `wide` true is >= 768px, false is below it. */
    resize(wide: boolean) {
      matches = wide
      act(() => {
        for (const listener of [...listeners]) {
          listener({ matches } as MediaQueryListEvent)
        }
      })
    },
  }
}

/* jsdom implements no `matchMedia` at all, so every test needs one before the
 * header can mount. The default is a narrow viewport — the state the mobile
 * menu exists for; the tests that care about the breakpoint install their own
 * over the top. */
beforeEach(() => {
  mockViewport(false)
  // jsdom has no layout, so it never implements `scrollTo` — stub it so the
  // scroll-lock's restore call doesn't log a "not implemented" warning in
  // tests that don't care about it themselves.
  window.scrollTo = vi.fn()
})

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.style.overflow = ''
  document.body.style.position = ''
  document.body.style.top = ''
  document.body.style.width = ''
})

describe('Header', () => {
  it('renders the wordmark from the resume data', () => {
    render(<Header />)

    expect(screen.getByText(summary.name)).toBeDefined()
  })

  it('renders one inline nav link per section and per route, in that order', () => {
    render(<Header />)

    const nav = screen.getByRole('navigation', { name: 'Primary' })
    const links = within(nav).getAllByRole('link')

    expect(links).toHaveLength(sections.length + routes.length)
    expect(links.map((link) => link.textContent)).toEqual([
      ...sections.map((section) => section.label),
      ...routes.map((route) => route.label),
    ])
    // A section's href is derived from its id, so the nav and the page's
    // anchors cannot drift; a route's is written out in the registry, because
    // `#/tools` is a hash path and not an id anything on the page carries.
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      ...sections.map((section) => `#${section.id}`),
      ...routes.map((route) => route.href),
    ])
  })

  it('sweeps and blooms an inline nav link on hover and keyboard focus only', () => {
    render(<Header />)

    const nav = screen.getByRole('navigation', { name: 'Primary' })

    for (const link of within(nav).getAllByRole('link')) {
      const classes = link.className.split(/\s+/)

      // The band of accent light, and the clip that keeps it inside the pill.
      expect(classes).toContain('sweep')
      expect(classes).toContain('overflow-hidden')
      // The bloom is a hover/focus affordance: there is no active-section
      // tracking in this app, so an unprefixed `glow-text` here would light
      // every link at once and claim a state nothing computes.
      expect(classes).toContain('hover:glow-text')
      expect(classes).toContain('focus-visible:glow-text')
      expect(classes).not.toContain('glow-text')
      // Clipping the sweep must not cost the link its focus ring; the ring is
      // an outline drawn outside the border box.
      expect(classes).toContain('focus-visible:outline-accent')
    }
  })

  it('renders the same section and route links inside the mobile menu', async () => {
    const user = userEvent.setup()
    render(<Header />)

    const dialog = await openMenu(user)
    const links = within(dialog).getAllByRole('link')

    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      ...sections.map((section) => `#${section.id}`),
      ...routes.map((route) => route.href),
    ])
  })

  it('keeps the route links inside the two navs it already has', async () => {
    const user = userEvent.setup()
    render(<Header />)

    // One landmark in the bar, one in the panel — never a third for the
    // handful of route links.
    expect(screen.getAllByRole('navigation')).toHaveLength(1)

    const dialog = await openMenu(user)

    expect(screen.getAllByRole('navigation')).toHaveLength(2)
    expect(within(dialog).getAllByRole('navigation')).toHaveLength(1)
    for (const route of routes) {
      expect(
        within(dialog).getByRole('link', { name: route.label }),
      ).toBeDefined()
    }
  })

  it('renders children in the bar, outside the mobile panel', async () => {
    const user = userEvent.setup()
    render(
      <Header>
        <button type="button">Toggle theme</button>
      </Header>,
    )

    const slotted = screen.getByRole('button', { name: 'Toggle theme' })
    // In the bar itself, so there is one toggle in the document rather than a
    // second copy inside the panel.
    expect(slotted.closest('[role="dialog"]')).toBeNull()

    // Opening the panel does not re-render it elsewhere or duplicate it.
    // Whether it is *visible* under the open panel is a stacking question
    // jsdom cannot answer (no stylesheet, no layout) — it stays a manual
    // check; see README.
    await openMenu(user)
    expect(screen.getByRole('button', { name: 'Toggle theme' })).toBe(slotted)
    expect(screen.getAllByRole('button', { name: 'Toggle theme' })).toHaveLength(
      1,
    )
  })

  it('starts collapsed and expands on click', async () => {
    const user = userEvent.setup()
    render(<Header />)

    const button = menuButton()
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('dialog')).toBeNull()

    const dialog = await openMenu(user)

    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(button.getAttribute('aria-controls')).toBe(dialog.id)
  })

  it('moves focus into the menu when it opens', async () => {
    const user = userEvent.setup()
    render(<Header />)

    const dialog = await openMenu(user)

    expect(dialog.contains(document.activeElement)).toBe(true)
  })

  it('wraps Tab from the last focusable element back to the first', async () => {
    const user = userEvent.setup()
    render(<Header />)

    const dialog = await openMenu(user)
    const focusables = focusablesIn(dialog)
    const first = focusables[0]
    const last = focusables[focusables.length - 1]

    last.focus()
    await user.tab()

    expect(document.activeElement).toBe(first)
  })

  it('wraps Shift+Tab from the first focusable element back to the last', async () => {
    const user = userEvent.setup()
    render(<Header />)

    const dialog = await openMenu(user)
    const focusables = focusablesIn(dialog)
    const first = focusables[0]
    const last = focusables[focusables.length - 1]

    first.focus()
    await user.tab({ shift: true })

    expect(document.activeElement).toBe(last)
  })

  it('keeps focus inside the menu across a full cycle of tabs', async () => {
    const user = userEvent.setup()
    render(<Header />)

    const dialog = await openMenu(user)

    for (let i = 0; i <= focusablesIn(dialog).length; i += 1) {
      await user.tab()
      expect(dialog.contains(document.activeElement)).toBe(true)
    }
  })

  it('closes on Escape and returns focus to the menu button', async () => {
    const user = userEvent.setup()
    render(<Header />)

    await openMenu(user)
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(menuButton().getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(menuButton())
  })

  it('closes when a nav link in the menu is selected', async () => {
    const user = userEvent.setup()
    render(<Header />)

    const dialog = await openMenu(user)
    await user.click(within(dialog).getByRole('link', { name: sections[0].label }))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(menuButton().getAttribute('aria-expanded')).toBe('false')
  })

  it('locks background scrolling while open and restores it on close', async () => {
    const user = userEvent.setup()
    document.body.style.overflow = 'auto'
    render(<Header />)

    await openMenu(user)
    expect(document.body.style.overflow).toBe('hidden')

    await user.keyboard('{Escape}')
    expect(document.body.style.overflow).toBe('auto')

    document.body.style.overflow = ''
  })

  it('restores background scrolling when unmounted while open', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<Header />)

    await openMenu(user)
    expect(document.body.style.overflow).toBe('hidden')

    unmount()
    expect(document.body.style.overflow).toBe('')
  })

  it('pins the body with position:fixed at the current scroll position while open, and restores it on close', async () => {
    const user = userEvent.setup()
    Object.defineProperty(window, 'scrollY', {
      configurable: true,
      value: 240,
    })
    const scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    render(<Header />)

    expect(document.body.style.position).toBe('')
    expect(document.body.style.top).toBe('')
    expect(document.body.style.width).toBe('')

    await openMenu(user)
    expect(document.body.style.position).toBe('fixed')
    expect(document.body.style.top).toBe('-240px')
    expect(document.body.style.width).toBe('100%')

    await user.keyboard('{Escape}')
    expect(document.body.style.position).toBe('')
    expect(document.body.style.top).toBe('')
    expect(document.body.style.width).toBe('')
    expect(scrollToSpy).toHaveBeenCalledWith(0, 240)
  })

  it('restores the body position lock to its prior values, not just clearing them', async () => {
    const user = userEvent.setup()
    Object.defineProperty(window, 'scrollY', {
      configurable: true,
      value: 120,
    })
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    document.body.style.position = 'relative'
    document.body.style.top = '10px'
    document.body.style.width = '90%'
    render(<Header />)

    await openMenu(user)
    expect(document.body.style.position).toBe('fixed')

    await user.keyboard('{Escape}')
    expect(document.body.style.position).toBe('relative')
    expect(document.body.style.top).toBe('10px')
    expect(document.body.style.width).toBe('90%')
  })

  it('restores the body position lock and scroll position when unmounted while open', async () => {
    const user = userEvent.setup()
    Object.defineProperty(window, 'scrollY', {
      configurable: true,
      value: 360,
    })
    const scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    const { unmount } = render(<Header />)

    await openMenu(user)
    expect(document.body.style.position).toBe('fixed')
    expect(document.body.style.top).toBe('-360px')

    unmount()
    expect(document.body.style.position).toBe('')
    expect(document.body.style.top).toBe('')
    expect(document.body.style.width).toBe('')
    expect(scrollToSpy).toHaveBeenCalledWith(0, 360)
  })

  /*
   * Everything the open state controls is behind `md:hidden`, so an open menu
   * that survives into desktop width leaves the page scroll-locked with no
   * visible control to clear it. These cover the breakpoint reconciliation
   * that prevents it.
   */
  it('watches the md breakpoint at 48rem, matching its md: classes', () => {
    mockViewport(false)
    render(<Header />)

    expect(window.matchMedia).toHaveBeenCalledWith('(min-width: 48rem)')
  })

  it('closes the menu and unlocks scrolling when the viewport reaches md', async () => {
    const user = userEvent.setup()
    const viewport = mockViewport(false)
    document.body.style.overflow = 'auto'
    render(<Header />)

    await openMenu(user)
    expect(document.body.style.overflow).toBe('hidden')

    // The gesture: a fold opening or a tablet rotating past 768px, with the
    // menu still up.
    viewport.resize(true)

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(menuButton().getAttribute('aria-expanded')).toBe('false')
    expect(document.body.style.overflow).toBe('auto')
  })

  it('reopens normally after the viewport goes back below md', async () => {
    const user = userEvent.setup()
    const viewport = mockViewport(false)
    render(<Header />)

    await openMenu(user)
    viewport.resize(true)
    expect(screen.queryByRole('dialog')).toBeNull()

    // Folding back up must not leave the menu wedged shut.
    viewport.resize(false)
    await openMenu(user)

    expect(menuButton().getAttribute('aria-expanded')).toBe('true')
    expect(document.body.style.overflow).toBe('hidden')
  })

  it('leaves a closed menu closed when the viewport narrows below md', () => {
    const viewport = mockViewport(true)
    document.body.style.overflow = 'auto'
    render(<Header />)

    // Narrowing below `md` only puts the menu button back; it must not open
    // the panel or lock the page on its own.
    viewport.resize(false)

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(menuButton().getAttribute('aria-expanded')).toBe('false')
    expect(document.body.style.overflow).toBe('auto')
  })

  it('removes its breakpoint listener on unmount', () => {
    const viewport = mockViewport(false)
    const { unmount } = render(<Header />)

    expect(viewport.listenerCount()).toBeGreaterThan(0)

    unmount()

    expect(viewport.listenerCount()).toBe(0)
  })

  it('omits aria-controls while the panel is not rendered', async () => {
    const user = userEvent.setup()
    render(<Header />)

    const button = menuButton()
    expect(button.hasAttribute('aria-controls')).toBe(false)

    const dialog = await openMenu(user)
    expect(button.getAttribute('aria-controls')).toBe(dialog.id)

    await user.keyboard('{Escape}')
    expect(button.hasAttribute('aria-controls')).toBe(false)
  })

  it('keeps at least 8px between the tap targets in the bar', () => {
    render(<Header />)

    // 44x44 targets sitting 4px apart are adjacent enough to mis-tap on a
    // phone; `gap-2` is 0.5rem.
    const group = menuButton().parentElement
    const gaps = group?.className
      .split(/\s+/)
      .filter((name) => name.startsWith('gap-'))

    expect(gaps).toEqual(['gap-2'])
  })
})
