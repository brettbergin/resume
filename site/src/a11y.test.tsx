import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from './App.tsx'
import { summary } from './data/resume.ts'
import { sections } from './data/sections.ts'

/*
 * The page-wide accessibility contract, asserted over the tree <App /> renders.
 *
 * It lives here rather than in App.test.tsx because its subject is different:
 * App.test.tsx checks that the shell wires the *sections* up (one section per
 * registry entry, every nav href resolving, the right component in the right
 * slot), while this file checks the facts issue #11 lists — landmarks, heading
 * order, accessible names, alt text, focus rings, tap targets — over whatever
 * the page happens to contain. A new section that skips a heading level or
 * ships an unnamed icon button fails here without anyone remembering to extend
 * a per-component test.
 *
 * The site is client-rendered, so `dist/index.html` is `<div id="root"></div>`
 * and "the built page" has to be evaluated in two halves: this file is the
 * rendered tree, and test/index-html.test.ts is the document-level half (the
 * `lang` attribute, and that nothing focusable sits outside #root — which is
 * what lets "first focusable element of the render" mean "first focusable
 * element of the page").
 *
 * jsdom applies no stylesheet, so responsive classes do nothing here: both the
 * inline nav and — once opened — the mobile panel are visible to queries at the
 * same time. The default, menu-closed state is therefore the contract these
 * tests assert; see the landmark tests for what the open state means.
 */

/** Everything the browser puts in tab order on this page. There are no
 * positive tabindexes and nothing is `tabindex="-1"`, so document order is tab
 * order. */
const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]'

/** The focus-ring utility prefix, split so this file doesn't spell out a
 * candidate class name Tailwind's content scan would pick up. */
const FOCUS_UTILITY = 'focus-visible:out' + 'line'

/** The subset the name/focus/tap-target rules apply to: links and enabled
 * buttons. */
const CONTROLS = 'a[href], button:not([disabled])'

const HEADINGS = 'h1, h2, h3, h4, h5, h6'

/**
 * The accessible name of a link or button, computed the way a browser computes
 * the simple cases: `aria-label` wins, then the text of the elements named by
 * `aria-labelledby`, then the element's own text. Written out rather than
 * pulled in from a library — the page uses none of the exotic forms (no
 * `title` fallback, no `aria-label` on an ancestor), and a name computation is
 * not worth a dependency.
 */
function accessibleName(element: Element): string {
  const label = element.getAttribute('aria-label')
  if (label !== null) return label.trim()

  const labelledBy = element.getAttribute('aria-labelledby')
  if (labelledBy !== null) {
    return labelledBy
      .split(/\s+/)
      .filter(Boolean)
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ')
      .trim()
  }

  return (element.textContent ?? '').trim()
}

function controlsIn(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(CONTROLS))
}

/** A description of a control for assertion messages: two links with the same
 * text in different sections are otherwise indistinguishable in a failure. */
function describeControl(element: Element): string {
  return `<${element.tagName.toLowerCase()} class="${element.className}">`
}

function headingLevels(container: HTMLElement): number[] {
  return Array.from(container.querySelectorAll(HEADINGS)).map((heading) =>
    Number(heading.tagName.slice(1)),
  )
}

/** Open the mobile menu and return the panel. The inline nav is `md:hidden`'s
 * counterpart and stays in the DOM under jsdom, so the panel is queried
 * explicitly rather than assumed to be the only nav. */
async function openMenu(): Promise<HTMLElement> {
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: /^menu$/i }))
  return screen.getByRole('dialog')
}

// Same stub as App.test.tsx: jsdom never fires media query changes and the
// theme falls back to `prefers-color-scheme`, so pin it to light for a known
// starting state.
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

describe('page landmarks', () => {
  it('renders exactly one banner, navigation, main and contentinfo', () => {
    render(<App />)

    expect(screen.getAllByRole('banner')).toHaveLength(1)
    expect(screen.getAllByRole('navigation')).toHaveLength(1)
    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(screen.getAllByRole('contentinfo')).toHaveLength(1)
  })

  it('names its one navigation landmark', () => {
    render(<App />)

    expect(screen.getByRole('navigation')).toBe(
      screen.getByRole('navigation', { name: 'Primary' }),
    )
  })

  /*
   * The closed state above is the contract, not this one. In a browser the
   * mobile panel and the inline nav are never on screen together — the panel
   * and the button that opens it are `md:hidden`, and the inline nav is
   * `hidden md:flex` — so a real visitor has exactly one navigation landmark at
   * every width. jsdom applies no stylesheet and so shows both at once; this
   * test pins that arithmetic (1 inline + 1 in the panel) rather than letting a
   * future second landmark hide inside an unexplained "2".
   */
  it('adds only the panel’s own navigation when the mobile menu opens', async () => {
    render(<App />)

    const dialog = await openMenu()

    expect(screen.getAllByRole('navigation')).toHaveLength(2)
    expect(within(dialog).getAllByRole('navigation')).toHaveLength(1)
    expect(
      within(dialog).getByRole('navigation', { name: 'Site sections' }),
    ).toBeDefined()
  })
})

describe('skip link', () => {
  it('is the first focusable element in the document', () => {
    const { container } = render(<App />)

    const [first] = Array.from(container.querySelectorAll(FOCUSABLE))

    expect(first).toBeDefined()
    expect(first.tagName).toBe('A')
    expect(accessibleName(first)).toBe('Skip to content')
  })

  it('targets #main, and #main is the main landmark', () => {
    render(<App />)

    const skipLink = screen.getByRole('link', { name: 'Skip to content' })

    expect(skipLink.getAttribute('href')).toBe('#main')
    expect(document.getElementById('main')).toBe(screen.getByRole('main'))
  })
})

describe('heading structure', () => {
  it('has exactly one h1, and it is the hero’s', () => {
    render(<App />)

    const h1s = screen.getAllByRole('heading', { level: 1 })

    expect(h1s).toHaveLength(1)
    expect(h1s[0].textContent).toBe(summary.name)
    expect(document.getElementById('about')?.contains(h1s[0])).toBe(true)
  })

  it('descends through the page without skipping a level', () => {
    const { container } = render(<App />)

    const levels = headingLevels(container)

    // Today: h1 (hero) -> h2 per section -> h3 (roles, projects, achievements)
    // -> h4 (skill groups). The assertion is the rule, not that shape: a future
    // section whose first heading is an <h4> under an <h2> fails here.
    expect(levels.length).toBeGreaterThan(1)
    expect(levels[0]).toBe(1)
    for (const [index, level] of levels.entries()) {
      if (index === 0) continue
      const where = `heading ${index + 1} of ${levels.length}`

      expect(level, where).toBeLessThanOrEqual(levels[index - 1] + 1)
    }
  })
})

/*
 * Images and icons. The page renders no <img> at all today, which would make a
 * "every img has alt" assertion over the tree a vacuous pass on its own — so it
 * is paired with a source sweep (nothing may add an <img> without an `alt`)
 * and with the <svg> rule below, which runs over the ten decorative icons the
 * page really does render.
 */
describe('images and icons', () => {
  /** Every rendering source in src/, as text: App.tsx plus the components. */
  const renderingSources = Object.entries(
    import.meta.glob<string>('./**/*.tsx', {
      query: '?raw',
      import: 'default',
      eager: true,
    }),
  ).filter(([path]) => !path.includes('.test.'))

  it('gives every rendered img an alt attribute', () => {
    const { container } = render(<App />)

    for (const image of container.querySelectorAll('img')) {
      expect(image.hasAttribute('alt'), image.outerHTML).toBe(true)
    }
  })

  it('has rendering sources to sweep for img tags', () => {
    // Guards the glob: a rename that empties this list must not turn the sweep
    // below into a vacuous pass.
    expect(renderingSources.map(([path]) => path)).toContain('./App.tsx')
    expect(renderingSources.length).toBeGreaterThan(1)
  })

  it.each(renderingSources)(
    '%s declares no img without alt',
    (_path, source) => {
      // Decorative images are `alt=""`, which is still an `alt` attribute;
      // what this forbids is the tag with none at all, announced by its file
      // name.
      const withoutAlt = [...source.matchAll(/<img\b[^>]*>/g)]
        .map((match) => match[0])
        .filter((tag) => !/\balt[=\s]/.test(tag))

      expect(withoutAlt).toEqual([])
    },
  )

  it('hides every decorative svg from assistive technology', () => {
    const { container } = render(<App />)

    const svgs = Array.from(container.querySelectorAll('svg'))

    expect(svgs.length).toBeGreaterThan(0)
    for (const svg of svgs) {
      // Every icon on the page today sits beside its own text label, so all of
      // them are decorative. An icon that ever carries meaning on its own needs
      // a name instead — hence the second branch rather than a flat
      // `aria-hidden` assertion.
      const hidden = svg.getAttribute('aria-hidden') === 'true'
      const named = accessibleName(svg) !== ''

      expect(hidden || named, svg.outerHTML).toBe(true)
    }
  })
})

describe('links and buttons', () => {
  it('gives every control a non-empty accessible name', () => {
    const { container } = render(<App />)

    const controls = controlsIn(container)

    expect(controls.length).toBeGreaterThan(0)
    for (const control of controls) {
      expect(accessibleName(control), describeControl(control)).not.toBe('')
    }
  })

  it('gives every control a focus ring and a 44px tap target', () => {
    const { container } = render(<App />)

    const controls = controlsIn(container)

    expect(controls.length).toBeGreaterThan(0)
    for (const control of controls) {
      const classes = Array.from(control.classList)

      // WCAG 2.4.7: the ring is drawn for keyboard focus only, so the utility
      // is the FOCUS_UTILITY family from src/styles.ts.
      expect(
        classes.some((name) => name.startsWith(FOCUS_UTILITY)),
        describeControl(control),
      ).toBe(true)
      // WCAG 2.5.5: 44px on the axis the content does not size. The skip link
      // is the one `focus:` variant — it has no box until it is focused, so an
      // unconditional minimum height would give an `sr-only` element a size it
      // can never show.
      expect(
        classes.includes('min-h-11') || classes.includes('focus:min-h-11'),
        describeControl(control),
      ).toBe(true)
    }
  })

  /* The two above run over the closed page, where the mobile menu's links do
   * not exist yet. They are controls too — and the ones a phone visitor uses to
   * get anywhere — so the same rules are re-run with the panel open, over a set
   * asserted to contain them. */
  it('holds the mobile menu’s links to the same rules', async () => {
    const { container } = render(<App />)

    const dialog = await openMenu()
    const menuLinks = within(dialog).getAllByRole('link')
    const controls = controlsIn(container)

    expect(menuLinks).toHaveLength(sections.length)
    for (const link of menuLinks) {
      expect(controls).toContain(link)
    }

    for (const control of controls) {
      const classes = Array.from(control.classList)

      expect(accessibleName(control), describeControl(control)).not.toBe('')
      expect(
        classes.some((name) => name.startsWith(FOCUS_UTILITY)),
        describeControl(control),
      ).toBe(true)
      expect(
        classes.includes('min-h-11') || classes.includes('focus:min-h-11'),
        describeControl(control),
      ).toBe(true)
    }
  })
})
