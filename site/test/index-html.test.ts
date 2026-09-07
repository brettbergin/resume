import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { site } from '../src/data/site.ts'

/*
 * Pins the one piece of behaviour that cannot live in a component: the theme
 * has to be on <html> before the first paint.
 *
 * `src/main.tsx` is loaded as a module script and module scripts are
 * deferred, so the browser is free to paint the parsed document — white,
 * since the light palette is the CSS default and `dark` is only ever added by
 * JS — before the bundle runs. Applying the theme from the bundle alone
 * therefore flashes the light palette at every visitor who stored `dark`, for
 * as long as the bundle takes to arrive. The fix is a render-blocking inline
 * script in <head>, and the thing that rots is its duplicated storage key and
 * media query, so those are asserted against `src/theme.ts` itself.
 *
 * These read the HTML source rather than executing it: the point is what the
 * browser is handed before any of our JS runs.
 */

const here = dirname(fileURLToPath(import.meta.url))
const siteDir = resolve(here, '..')

const html = readFileSync(resolve(siteDir, 'index.html'), 'utf8')
const themeSource = readFileSync(resolve(siteDir, 'src/theme.ts'), 'utf8')

const head = html.slice(html.indexOf('<head'), html.indexOf('</head>'))

/** The key as `src/theme.ts` declares it, read out of the source rather than
 * imported: this file type-checks under the node project (no DOM lib) and
 * theme.ts is a browser module. Either half of the pair moving breaks the
 * assertions below. */
const storageKey = /THEME_STORAGE_KEY = '([^']+)'/.exec(themeSource)?.[1]

/** Likewise the media query theme.ts falls back to. */
const darkQuery = /DARK_QUERY = '([^']+)'/.exec(themeSource)?.[1]

/** The `theme-color` tag and the colour it carries out of the parser, before
 * the script below has had a chance to swap it. */
const themeColorTag = /<meta\b[^>]*name="theme-color"[^>]*>/.exec(head)?.[0]
const themeColorContent = /content="([^"]*)"/.exec(themeColorTag ?? '')?.[1]

/** The `lang` the <html> tag declares, or `undefined` if it declares none. */
const htmlLang = /<html\b[^>]*\blang="([^"]*)"/.exec(html)?.[1]

/** The document with the mount point's element removed, so the focusable-element
 * sweep below sees only the shell around it. The div is empty in the source —
 * React fills it at runtime — so this drops the tag pair and nothing else. */
const outsideRoot = html.replace(/<div\b[^>]*id="root"[^>]*>[\s\S]*?<\/div>/, '')

/** The inline (`src`-less) scripts in <head>, as their bodies. */
const inlineHeadScripts = [
  ...head.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g),
].map((match) => ({ attributes: match[1], body: match[2] }))

const themeScript = inlineHeadScripts.find((script) =>
  script.body.includes(storageKey ?? '\u0000'),
)

describe('index.html', () => {
  it('applies the stored theme from an inline script in <head>', () => {
    expect(themeScript).toBeDefined()
    // A theme applied after the document is painted is a flash, not a theme:
    // this script must block rendering, so no `type=module`, `defer` or
    // `async`.
    expect(themeScript?.attributes).not.toMatch(/module|defer|async/)
  })

  it('runs the theme script before the app bundle', () => {
    // The bundle re-applies the same theme; if it got there first the inline
    // script would be pointless. The `\0` keeps a missing script from
    // matching at position 0 and passing vacuously.
    const themeAt = html.indexOf(themeScript?.body ?? '\u0000')
    const bundleAt = html.indexOf('src="/src/main.tsx"')

    expect(themeAt).toBeGreaterThan(-1)
    expect(bundleAt).toBeGreaterThan(themeAt)
  })

  it('reads the same storage key as theme.ts', () => {
    // Duplicated on purpose — the inline script cannot import — so drift is
    // what breaks it. Both halves are read from their own file.
    expect(storageKey).toBe('resume-theme')
    expect(themeScript?.body).toContain(storageKey)
  })

  it('falls back to the same media query as theme.ts', () => {
    expect(darkQuery).toBe('(prefers-color-scheme: dark)')
    expect(themeScript?.body).toContain(darkQuery)
  })

  it('sets the same theme-color literals as site.ts', () => {
    // The chrome colour has to be right on the first paint too, so the script
    // makes the swap applyTheme() makes — with the colours typed out, since an
    // inline script cannot import. Both halves are read from their own file,
    // so either one moving alone fails here.
    expect(themeColorContent).toBe(site.themeColorLight)
    expect(themeScript?.body).toContain(site.themeColorDark)
    // Light needs no write: it is what the parsed tag already carries. A
    // literal light value inside the script would mean the two disagree about
    // which one is the default.
    expect(themeScript?.body).not.toContain(site.themeColorLight)
  })

  it('sets theme-color in the branch that applies the dark class', () => {
    // Same decision, same place. Split apart, the class and the chrome can
    // disagree about which theme the visitor asked for.
    const body = themeScript?.body ?? ''
    const classAt = body.indexOf("classList.add('dark')")
    const colorAt = body.indexOf(site.themeColorDark)

    expect(classAt).toBeGreaterThan(-1)
    expect(colorAt).toBeGreaterThan(classAt)
    // No block has closed in between, so the write is still inside the `if`
    // that added the class rather than after it.
    expect(body.slice(classAt, colorAt)).not.toContain('}')
  })

  it('declares the theme-color tag before the script that rewrites it', () => {
    // querySelector only finds an element the parser has already reached, and
    // this script runs where it sits.
    const metaAt = head.indexOf(themeColorTag ?? '\u0000')

    expect(metaAt).toBeGreaterThan(-1)
    expect(head.indexOf(themeScript?.body ?? '\u0000')).toBeGreaterThan(metaAt)
  })

  it('applies the dark class only, and only for dark', () => {
    // Light is the CSS default, so there is nothing to add for it; the script
    // adds `dark` and touches nothing else.
    expect(themeScript?.body).toMatch(/classList\.add\('dark'\)/)
    expect(themeScript?.body).toContain("'dark'")
    expect(themeScript?.body).toContain("'light'")
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

  it('tolerates localStorage throwing', () => {
    // Safari in private mode throws on the property access itself, and a
    // theme lookup must never be why the page fails to render. Matches
    // getStoredTheme()'s own try/catch.
    expect(themeScript?.body).toMatch(/try\s*\{[\s\S]*catch/)
  })
})
