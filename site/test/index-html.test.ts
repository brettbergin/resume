import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { site } from '../src/data/site.ts'
import { DARK_QUERY, getInitialTheme, THEME_STORAGE_KEY } from '../src/theme.ts'
import { themeScriptBody } from '../vite/theme-script.ts'

/*
 * index.html's own source only carries a placeholder comment: the pre-paint
 * theme script is generated and injected into <head> by vite/theme-script.ts's
 * themeScript() plugin, at both `vite build` and `vite dev`. An inline
 * <script> can't import, so that plugin builds the script from src/theme.ts's
 * and src/data/site.ts's actual exports rather than it being hand-typed here.
 *
 * `html` below splices that same generator's output into the placeholder, so
 * every assertion that follows runs against the real build-time output
 * instead of a second copy pasted into this test file.
 */

const here = dirname(fileURLToPath(import.meta.url))
const siteDir = resolve(here, '..')

const rawHtml = readFileSync(resolve(siteDir, 'index.html'), 'utf8')

const placeholderComment = /<!--\s*Pre-paint theme script goes here[\s\S]*?-->/
const generatedScript = themeScriptBody()
const html = rawHtml.replace(
  placeholderComment,
  `<script>${generatedScript}</script>`,
)

const head = html.slice(html.indexOf('<head'), html.indexOf('</head>'))

/** The `theme-color` tag and the colour it carries out of the parser, before
 * the injected script has had a chance to swap it. */
const themeColorTag = /<meta\b[^>]*name="theme-color"[^>]*>/.exec(head)?.[0]
const themeColorContent = /content="([^"]*)"/.exec(themeColorTag ?? '')?.[1]

/** The `lang` the <html> tag declares, or `undefined` if it declares none. */
const htmlLang = /<html\b[^>]*\blang="([^"]*)"/.exec(html)?.[1]

/** The document with the mount point's element removed, so the focusable-element
 * sweep below sees only the shell around it. The div is empty in the source —
 * React fills it at runtime — so this drops the tag pair and nothing else. */
const outsideRoot = html.replace(/<div\b[^>]*id="root"[^>]*>[\s\S]*?<\/div>/, '')

describe('index.html', () => {
  it('carries only the placeholder in source; the real script is generated', () => {
    // vite/theme-script.ts generates and injects the script at build/dev
    // time; the checked-in source carries nothing but a comment pointing at
    // it. `html` (used by every other test below) is `rawHtml` with the
    // generator's actual output spliced into that comment's place.
    expect(rawHtml).not.toContain("classList.add('dark')")
    expect(rawHtml).toContain('vite/theme-script.ts')
    expect(head).toContain(generatedScript)
  })

  it('inlines a script reading the same storage key and media query as theme.ts', () => {
    expect(generatedScript).toContain(THEME_STORAGE_KEY)
    expect(generatedScript).toContain(DARK_QUERY)
  })

  it('carries the light theme-color literal the generated script swaps out of', () => {
    // The injected script only ever writes the dark value (see
    // test/theme-script.test.ts); light has to already be what the parsed
    // tag carries.
    expect(themeColorTag).toBeDefined()
    expect(themeColorContent).toBe(site.themeColorLight)
    expect(generatedScript).toContain(site.themeColorDark)
  })

  it('declares a language on <html>', () => {
    // Without it a screen reader reads the page in whatever voice it happens
    // to be set to, and this is the only place it can be declared: React never
    // renders the <html> element.
    expect(htmlLang).toBeDefined()
    expect(htmlLang).not.toBe('')
  })

  it('puts nothing focusable outside #root', () => {
    // src/a11y.test.tsx asserts the skip link is the first focusable element of
    // the tree React renders. That only means "first on the page" while the
    // document itself contributes no tab stop ahead of the mount point — a
    // hand-written link or button in the HTML shell would sit before every one
    // of them.
    expect(html).toContain('id="root"')
    expect(outsideRoot).not.toMatch(/<a\b[^>]*\bhref=/)
    expect(outsideRoot).not.toMatch(/<button\b/)
    expect(outsideRoot).not.toMatch(/\btabindex=/)
  })
})

/*
 * Behavioral parity: the generated script and getInitialTheme() must agree on
 * whether the `dark` class ends up applied, for every combination of a stored
 * value and an OS preference. theme-script.test.ts and theme.test.ts each pin
 * the two in isolation (same storage key, same media query, same theme-color
 * literals), but neither runs the two side by side. A change to
 * getInitialTheme()'s precedence — an explicit 'system' stored value, say, or
 * a different validity rule — could silently stop matching the generated
 * script's `if` while every one of those existing assertions stays green.
 */

type Listener = (event: MediaQueryListEvent) => void

/** Replace window.matchMedia with a fixed answer, since jsdom never actually
 * evaluates `(prefers-color-scheme: dark)`. Mirrors src/theme.test.ts's own
 * mockPreferredTheme. */
function mockPreferredTheme(prefersDark: boolean) {
  const query = {
    media: DARK_QUERY,
    matches: prefersDark,
    addEventListener(_type: 'change', _listener: Listener) {},
    removeEventListener(_type: 'change', _listener: Listener) {},
  }
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => query),
  )
}

/** Runs the generated script body against the ambient document/window,
 * exactly as a browser would run the inlined <script> in <head>. */
function runGeneratedScript(): void {
  new Function(generatedScript)()
}

const PARITY_CASES: {
  label: string
  stored?: string
  osPrefersDark: boolean
}[] = [
  { label: 'a valid stored light', stored: 'light', osPrefersDark: true },
  { label: 'a valid stored dark', stored: 'dark', osPrefersDark: false },
  {
    label: 'no stored value, with the OS preferring light',
    osPrefersDark: false,
  },
  {
    label: 'no stored value, with the OS preferring dark',
    osPrefersDark: true,
  },
]

describe('generated script vs getInitialTheme()', () => {
  beforeEach(() => {
    window.localStorage.clear()
    document.documentElement.classList.remove('dark')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    window.localStorage.clear()
    document.documentElement.classList.remove('dark')
  })

  it.each(PARITY_CASES)(
    'agrees with getInitialTheme() for $label',
    ({ stored, osPrefersDark }) => {
      mockPreferredTheme(osPrefersDark)
      if (stored !== undefined) {
        window.localStorage.setItem(THEME_STORAGE_KEY, stored)
      }

      const expectDark = getInitialTheme() === 'dark'

      runGeneratedScript()

      expect(document.documentElement.classList.contains('dark')).toBe(
        expectDark,
      )
    },
  )
})
