import { readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/*
 * Pins the root README's "Repo layout" section. The repository now holds two
 * things — the resume files and the site that publishes them — and the only
 * place that explains which is which is prose, which nothing else would catch
 * going stale. These assertions pin the *facts* (the heading exists, the
 * section names each part of the repo, the live URL is the one the site is
 * actually served from) and not the phrasing, so the section can be reworded
 * freely. The live URL is cross-checked against site/README.md's Live URL row
 * and the `base` in vite.config.ts, so the two documents and the build cannot
 * drift apart. The same cross-check anchors the one item of site/README.md's
 * manual checklist that stands in for a test — the Download PDF tap, which
 * needs a browser and a deployed site to verify.
 *
 * It pins site/README.md's Accessibility section and manual checklist the same
 * way, and for the same reason: issue #11's review checklist needs a browser,
 * a rendering engine or the deployed site, so the whole of it lives in prose.
 * Prose nothing checks goes stale — a width dropped in a reword is a
 * breakpoint nobody looks at again. So the axes are pinned as facts: the five
 * widths, both palettes, the Lighthouse threshold, and the suites the section
 * says do assert something mechanically.
 */

const here = dirname(fileURLToPath(import.meta.url))
const siteDir = resolve(here, '..')

const readSiteFile = (relativePath: string): string =>
  readFileSync(resolve(siteDir, relativePath), 'utf8')

const rootReadme = readSiteFile('../README.md')
const siteReadme = readSiteFile('README.md')
const viteConfig = readSiteFile('vite.config.ts')

const layoutHeading = /^## Repo layout$/m
const checklistHeading = /^### Manual check:/m
const accessibilityHeading = /^## Accessibility$/m
const layoutShellHeading = /^## Layout shell$/m
const treatmentsHeading = /^### The accent's treatments/m
const pdfRecipeHeading = /^### Regenerating resume\.pdf$/m

/** The root README from the "Repo layout" heading to the end of the file. */
const layoutSection = (): string => {
  const start = rootReadme.search(layoutHeading)
  return start === -1 ? '' : rootReadme.slice(start)
}

/** The root README's resume.pdf recipe, up to the next heading of any level. */
const pdfRecipeSection = (): string => {
  const start = rootReadme.search(pdfRecipeHeading)
  if (start === -1) return ''
  const rest = rootReadme.slice(start)
  // Past the heading's own line, so the `###` it starts with is not the `###`
  // the search below stops at.
  const body = rest.indexOf('\n') + 1
  const end = rest.slice(body).search(/^#{2,3} /m)
  return end === -1 ? rest : rest.slice(0, body + end)
}

/** site/README.md from the manual checklist heading to the end of the file. */
const manualChecklist = (): string => {
  const start = siteReadme.search(checklistHeading)
  return start === -1 ? '' : siteReadme.slice(start)
}

/**
 * One top-level item of the manual checklist, from the line matching `start`
 * to the next top-level item or the end of the file — sub-bullets included.
 * `$` would be the end of the *line* under the `m` flag `start` needs.
 */
const itemStartingWith = (start: RegExp): string => {
  const body = new RegExp(
    `${start.source}[\\s\\S]*?(?=\\n- \\[ \\]|\\n## |(?![\\s\\S]))`,
    'm',
  )
  return body.exec(manualChecklist())?.[0] ?? ''
}

/** The checklist item covering the three states that hand the OS arrow back. */
const arrowItem = (): string =>
  itemStartingWith(/^- \[ \] \*\*The native arrow/m)

/** site/README.md's Accessibility section, up to the next `##` heading. */
const accessibilitySection = (): string => {
  const start = siteReadme.search(accessibilityHeading)
  if (start === -1) return ''
  const rest = siteReadme.slice(start)
  const end = rest.slice(1).search(/^## /m)
  return end === -1 ? rest : rest.slice(0, end + 1)
}

/** site/README.md's Layout shell section (which contains both the shell table
 * and the Shared hooks table), up to the next `##` heading. */
const layoutShellSection = (): string => {
  const start = siteReadme.search(layoutShellHeading)
  if (start === -1) return ''
  const rest = siteReadme.slice(start)
  const end = rest.slice(1).search(/^## /m)
  return end === -1 ? rest : rest.slice(0, end + 1)
}

/** site/README.md's treatments section, up to the next heading of any level. */
const treatmentsSection = (): string => {
  const start = siteReadme.search(treatmentsHeading)
  if (start === -1) return ''
  const rest = siteReadme.slice(start)
  // Past the heading's own line, so the `###` it starts with is not the `###`
  // the search below stops at.
  const body = rest.indexOf('\n') + 1
  const end = rest.slice(body).search(/^#{2,3} /m)
  return end === -1 ? rest : rest.slice(0, body + end)
}

/** The URL in site/README.md's `| Live URL | … |` table row. */
const documentedLiveUrl = (): string => {
  const row = /^\|\s*Live URL\s*\|\s*(\S+)\s*\|/m.exec(siteReadme)
  return row?.[1] ?? ''
}

describe('root README repo layout', () => {
  it('has a Repo layout section', () => {
    expect(rootReadme).toMatch(layoutHeading)
  })

  it('replaced the old Frontend section', () => {
    expect(rootReadme).not.toMatch(/^## Frontend$/m)
  })

  it('has a short intro above the Repo layout section', () => {
    // The section above "Repo layout" used to be a full copy of resume.md;
    // it's now a short pointer to that file instead, but it should still
    // read as a real intro rather than being blank.
    const start = rootReadme.search(layoutHeading)
    expect(start).toBeGreaterThan(0)
    expect(rootReadme.slice(0, start).trim()).not.toBe('')
  })

  it('names the resume sources and their exports', () => {
    const section = layoutSection()
    for (const file of ['resume.md', 'resume.html', 'resume.pdf']) {
      expect(section, file).toContain(file)
    }
  })

  it('names the site directory and links its README', () => {
    const section = layoutSection()
    expect(section).toContain('site/')
    expect(section).toContain('site/README.md')
  })

  it('names the data file that has to be kept in sync', () => {
    // The sync rule is the whole reason this section exists: resume.md and
    // the site's data module are hand-kept transcriptions of each other.
    expect(layoutSection()).toContain('src/data/resume.ts')
  })

  it('names the suite that checks the transcription', () => {
    // The section says the sync is no longer entirely manual, which is only
    // true while that suite exists. A suite renamed or dropped without the
    // prose following it leaves the document pointing at a file that is gone.
    expect(layoutSection()).toContain('test/resume-md-sync.test.ts')
  })
})

describe('root README resume.pdf recipe', () => {
  it('documents how the export is rendered', () => {
    // The export is regenerated by hand, and the one thing the command has to
    // carry is not in `resume.html` — see the section itself. Undocumented, it
    // was got wrong the first time the projects table changed.
    expect(rootReadme).toMatch(pdfRecipeHeading)
    expect(pdfRecipeSection()).toContain('weasyprint')
  })

  it('spells out the base font size the published layout is set at', () => {
    // A recipe missing the stylesheet argument is the plain render, which is
    // the bug this section exists to prevent.
    const section = pdfRecipeSection()

    expect(section).toContain('14px')
    expect(section).toContain('body{font-size:14px}')
  })

  it('names the suite that asserts the rendered file', () => {
    // Renamed or dropped without the prose following it, the section points at
    // a file that is gone — and the recipe stops being enforced anywhere.
    expect(pdfRecipeSection()).toContain('test/resume-pdf-layout.test.ts')
  })
})

describe('site README accessibility section', () => {
  it('has an Accessibility section', () => {
    expect(siteReadme).toMatch(accessibilityHeading)
  })

  it('names the suites that assert the contract mechanically', () => {
    // The section's job is to say which facts are pinned and by what. A suite
    // renamed or dropped without the prose following it leaves a document
    // pointing at a file that no longer exists.
    const section = accessibilitySection()

    for (const file of [
      'src/a11y.test.tsx',
      'src/theme-contrast.test.ts',
      'test/layout-contract.test.ts',
    ]) {
      expect(section, file).toContain(file)
    }
  })

  it('records the two border tokens and keeps them straight', () => {
    // The split is the one design decision of the pass that a reviewer has to
    // re-make by eye (the project card sits on the decorative token), so the
    // reasoning has to survive a reword.
    const section = accessibilitySection()

    expect(section).toContain('--color-border-strong')
    expect(section).toMatch(/--color-border\b/)
  })
})

describe('site README manual checklist', () => {
  it('keeps a Download PDF item that has to be re-checked on the live site', () => {
    // Whether the button actually yields the file is the one acceptance
    // criterion no suite can assert — there is no browser in the runner — so
    // the checklist item is the check. Nothing else would notice it being
    // dropped in a reword.
    const checklist = manualChecklist()

    expect(checklist).not.toBe('')
    expect(checklist).toContain('Download PDF')
    expect(checklist).toContain(documentedLiveUrl())
  })

  it('walks every width of the responsive matrix', () => {
    // Issue #11's matrix is five widths, and 1024 (the `lg` breakpoint, where
    // the card grids first go to three columns) is the one that was missing.
    // A checklist that quietly loses a width is a breakpoint nobody looks at.
    const checklist = manualChecklist()

    for (const width of ['320', '375', '768', '1024', '1440']) {
      expect(checklist, `${width}px`).toContain(width)
    }
  })

  it('walks the matrix in both themes', () => {
    // Every colour on the page changes with the palette, so a sweep in one
    // theme covers half the site.
    const checklist = manualChecklist()

    expect(checklist).toMatch(/\blight\b/i)
    expect(checklist).toMatch(/\bdark\b/i)
  })

  it('names the Lighthouse accessibility threshold', () => {
    // The score is an acceptance criterion of #11 and can only be had from a
    // deployed site, so the number lives here or nowhere.
    const checklist = manualChecklist()

    expect(checklist).toContain('Lighthouse')
    expect(checklist).toMatch(/accessibility[^.]*\b95\b/i)
  })
})

/*
 * The crosshair cursor, the decrypt-in headings and the weight-reactive hero
 * name are all pointer/animation behaviours, and jsdom paints none of them: it
 * applies no stylesheet, has no IntersectionObserver, reports no real pointer
 * and lays nothing out. Every suite that covers them therefore covers the
 * wiring — a class toggled, a property written, a string returned — and the
 * behaviour itself is only ever seen in a browser. So the checklist below is
 * where their acceptance actually lives, and these assertions keep it from
 * being reworded away. They pin the facts (a case is walked, a file is named)
 * and not the phrasing.
 */
describe('site README rice treatments', () => {
  it('names the four new source files in its tables', () => {
    // The shell table and the Shared hooks table are what a reader consults to
    // find out where a behaviour lives. A file added to src/ and never named
    // here is a component nobody can find from the document.
    const section = layoutShellSection()

    expect(section).not.toBe('')
    for (const file of [
      'src/components/Cursor.tsx',
      'src/components/SectionHeading.tsx',
      'src/useDecrypt.ts',
      'src/useHeroWeight.ts',
    ]) {
      expect(section, file).toContain(file)
    }
  })

  it('documents the hero-weight utility and the custom-cursor class', () => {
    // The two names that exist in index.css and nowhere a component's class
    // list would show them: one is written by a hook, the other toggled on
    // <html> by a component.
    const section = treatmentsSection()

    expect(section).not.toBe('')
    expect(section).toContain('hero-weight')
    expect(section).toContain('custom-cursor')
    // Same case as hero-weight: a utility no component's class list explains,
    // carried by one element the reader cannot see in a class list either.
    expect(section).toContain('reticle-lag')
  })

  it("documents the boot cursor's blink utility and what carries it", () => {
    // Third of the same kind as hero-weight and reticle-lag: a utility whose
    // one carrier is a glyph in a component nobody greps for by colour. It is
    // also the utility most likely to be dropped from the reduced-motion
    // block by someone tidying the animation, so the section has to say that
    // the block is where it is switched off.
    const section = treatmentsSection()

    expect(section).not.toBe('')
    expect(section).toContain('blink')
    expect(section).toContain('BootSequence.tsx')
    expect(section).toMatch(/prefers-reduced-motion/)
  })

  it('counts the utilities it actually lists', () => {
    // The count in the paragraph under the heading is the one number in the
    // section that a new row silently falsifies.
    const section = treatmentsSection()

    expect(section).not.toMatch(/\bsix named\b/i)
    expect(section).toMatch(/\bseven named\b/i)
  })

  it('says the section headings now come from SectionHeading', () => {
    // The glow's "Carried by" cell used to say "every section <h2>", which was
    // true while five components each wrote their own. They no longer do, and
    // a reader chasing a missing halo has to be sent to the right file.
    expect(treatmentsSection()).toContain('SectionHeading')
  })

  it('names the four new suites in the Accessibility table', () => {
    // Same rule the section's existing suites are held to: a suite renamed or
    // dropped without the prose following it leaves the document pointing at a
    // file that is gone.
    const section = accessibilitySection()

    for (const file of [
      'src/components/Cursor.test.tsx',
      'src/useDecrypt.test.ts',
      'src/components/SectionHeading.test.tsx',
      'src/useHeroWeight.test.ts',
    ]) {
      expect(section, file).toContain(file)
    }
  })
})

describe('site README manual checklist: the rice treatments', () => {
  it('walks the crosshair cursor and its hover state', () => {
    const checklist = manualChecklist()

    expect(checklist).toMatch(/crosshair/i)
    expect(checklist).toMatch(/\bring\b/i)
  })

  it('walks the three states that hand the OS arrow back', () => {
    // All three are suspensions rather than unmounts, and all three are
    // states a person can get into by accident and find a frozen — or
    // invisible — reticle in. The boot overlay is the one that is not a near
    // miss: it is a `dark` subtree painting `bg-bg` (#0a0a0a) and the reticle
    // is the page's `--color-text`, #111827 in the light palette, so a first
    // load with the arrow hidden and the reticle painted has no visible
    // pointer at all.
    const checklist = manualChecklist()

    expect(checklist).toMatch(/mobile menu/i)
    expect(checklist).toMatch(/blur|focus/i)
    expect(checklist).toMatch(/boot/i)
  })

  it('gives the boot overlay its current background, not the old ramp step', () => {
    // The item explains why a coloured reticle would not save this case, and
    // the explanation is only true of the colour the overlay actually paints.
    // It was written against `bg-neutral-900`, the pre-neon navy, and stayed
    // that way for a release after the overlay moved onto the tokens.
    const item = arrowItem()

    expect(item).not.toBe('')
    expect(item).toMatch(/#0a0a0a|bg-bg/i)
    expect(item).not.toMatch(/neutral-900/)
  })

  it('walks the repainted boot sequence in both themes', () => {
    // Every colour in the overlay is a browser's answer — jsdom applies no
    // stylesheet — so this item is the whole of the repaint's acceptance: the
    // background that must not step at the fade, the accent on the prompt,
    // the glow on the name, the muted title and the blinking cursor. The
    // light-theme half is the one a reviewer would otherwise skip, and it is
    // where the `dark` subtree either works or does not.
    const item = itemStartingWith(/^- \[ \] \*\*The boot sequence/m)

    expect(item).not.toBe('')
    expect(item).toContain('#0a0a0a')
    expect(item).toMatch(/accent/i)
    expect(item).toMatch(/glow/i)
    expect(item).toMatch(/muted/i)
    expect(item).toMatch(/blink/i)
    expect(item).toMatch(/\blight\b/i)
    expect(item).toMatch(/\bdark\b/i)
  })

  it('walks the pointer leaving the document, which blur does not cover', () => {
    // Moving into the tab bar or off onto a second monitor sends no further
    // pointermove and fires no blur, so this is its own check: both elements
    // have to leave with the pointer rather than stay parked at the edge.
    const checklist = manualChecklist()

    expect(checklist).toMatch(/tab bar|url bar|second monitor/i)
  })

  it('walks the touch case, where there is no reticle at all', () => {
    // The `(hover: none)` early return can only be seen on a device, and the
    // check is a DOM check as much as a visual one.
    const checklist = manualChecklist()

    expect(checklist).toMatch(/touch/i)
    expect(checklist).toMatch(/reticle/i)
  })

  it('walks the decrypt-in headings and what a screen reader hears', () => {
    // The scramble is paint; the accessible name must be the real label at
    // every frame, and only a real screen reader says whether it is.
    const checklist = manualChecklist()

    expect(checklist).toMatch(/scrambl/i)
    expect(checklist).toMatch(/screen reader|VoiceOver|NVDA/i)
  })

  it('pins the numbered prefixes, in nav order and by their real range', () => {
    // About is position 1 and is the hero's <h1>, which carries no prefix, so
    // the numbered headings start at 02. A checklist that said 01 would send a
    // reviewer looking for a number the page never paints.
    const checklist = manualChecklist()

    expect(checklist).toContain('02 / Skills')
    expect(checklist).toContain('06 / Contact')
  })

  it('walks the hero name following the pointer and settling back', () => {
    const checklist = manualChecklist()

    expect(checklist).toMatch(/hero name/i)
    expect(checklist).toMatch(/rest weight/i)
  })

  it('walks reduced motion over all three treatments', () => {
    // One preference switches off three separate things in three separate
    // places, so the item has to name all three or it only covers the one the
    // reviewer happens to remember.
    // To the next top-level checklist item or the end of the file — `$` would
    // be the end of the *line* under the `m` flag the heading matches need.
    const reducedMotion =
      /^- \[ \] \*\*Reduced motion[\s\S]*?(?=\n- \[ \]|\n## |(?![\s\S]))/m
    const item = reducedMotion.exec(manualChecklist())?.[0] ?? ''

    expect(item).not.toBe('')
    expect(item).toMatch(/arrow/i)
    expect(item).toMatch(/scrambl/i)
    expect(item).toMatch(/weight/i)
  })
})

/*
 * The `~/tools` route's documentation. Everything the section records is a
 * decision that is invisible in the code it describes: *why* the route is a
 * fragment and not a second Vite entry, why an option marked `secret` never
 * reaches the URL, why two parsers are vendored, and what the fixtures were
 * generated with. None of that can be re-derived from the modules, and a
 * reword that quietly drops one of them takes the reasoning with it — the
 * secret rule especially, which is a security property of shared links rather
 * than a style preference.
 *
 * Facts, not phrasing: a file is named, a number is stated, a rule is
 * asserted. The section can be rewritten around them freely.
 */
const toolsRouteHeading = /^## The `~\/tools` route$/m

/** site/README.md's `~/tools` section, up to the next `##` heading — its own
 * `###` subheadings included. */
const toolsRouteSection = (): string => {
  const start = siteReadme.search(toolsRouteHeading)
  if (start === -1) return ''
  const rest = siteReadme.slice(start)
  const end = rest.slice(1).search(/^## /m)
  return end === -1 ? rest : rest.slice(0, end + 1)
}

describe('site README tools route', () => {
  it('has a section for the route', () => {
    expect(siteReadme).toMatch(toolsRouteHeading)
    expect(toolsRouteSection()).not.toBe('')
  })

  it('names the modules the route is built from', () => {
    // Same rule every other section here is held to: a module renamed without
    // the prose following it leaves the document pointing at a file that is
    // gone, and this section is the only map of a ten-module directory.
    const section = toolsRouteSection()

    for (const file of [
      'src/tools/types.ts',
      'src/tools/fragment.ts',
      'src/tools/registry.ts',
      'src/components/tools/ToolsPage.tsx',
    ]) {
      expect(section, file).toContain(file)
    }
  })

  it('records the hash-route decision and the alternative it rejected', () => {
    // The second Vite entry is the option a later reader will re-propose, so
    // the four places that assume one page have to stay written down — they
    // are the whole cost of changing course.
    const section = toolsRouteSection()

    expect(section).toContain('#/tools')
    expect(section).toMatch(/hashchange/)
    expect(section).toMatch(/tools\.html/)
    for (const assumesOnePage of [
      'test/index-html.test.ts',
      'test/metadata.test.ts',
      'sitemap.xml',
      'deploy-pages.yml',
    ]) {
      expect(section, assumesOnePage).toContain(assumesOnePage)
    }
  })

  it('gives the fragment format and both of its rules', () => {
    // The format is what a hand-written or truncated link is debugged
    // against; `replaceState` is the difference between Back leaving the page
    // and Back walking one history entry per keystroke.
    const section = toolsRouteSection()

    expect(section).toMatch(/#\/tools\/<id>\?i=<base64url input>&o=<base64url json options>/)
    expect(section).toContain('replaceState')
    expect(section).toMatch(/never\s+`?pushState/)
  })

  it('states the 4 KB ceiling and what it does to the share button', () => {
    // The number is the one thing about the ceiling a reader cannot guess,
    // and the greyed-out button is the only way the page admits to it.
    const section = toolsRouteSection()

    expect(section).toMatch(/4\s?KB/i)
    expect(section).toContain('4096')
    expect(section).toMatch(/share button/i)
  })

  it('documents the contract members the pane keys off', () => {
    const section = toolsRouteSection()

    for (const member of ['detect', 'runFile', 'live', 'ToolOption.secret']) {
      expect(section, member).toContain(member)
    }
  })

  it('states that secret option values never reach the fragment', () => {
    // A security property of every shared link, and the one fact in the
    // section whose loss would be silent: the code still filters, but nobody
    // reviewing a new option would know it has to.
    const section = toolsRouteSection()

    expect(section).toMatch(/never\s+(?:encoded|written)\s+into\s+the\s+fragment/i)
  })

  it('lists the registry order magic paste breaks ties by', () => {
    // The order is load-bearing twice over — the sidebar and the tie-break —
    // so a list that has drifted from registry.ts is worse than none.
    const section = toolsRouteSection()
    const ids = [
      'magic',
      'base64',
      'hex',
      'url',
      'html',
      'jwt',
      'hash',
      'cert',
      'cidr',
      'epoch',
    ]
    const line = /^magic,[^\n]*$/m.exec(section)?.[0] ?? ''

    expect(line).not.toBe('')
    expect(line.split(',').map((id) => id.trim())).toEqual(ids)
  })

  it("names magic's threshold and its tie-break", () => {
    const section = toolsRouteSection()

    expect(section).toContain('0.6')
    expect(section).toMatch(/tie/i)
  })

  it('says what each vendored module is and why it is vendored', () => {
    const section = toolsRouteSection()

    expect(section).toContain('src/tools/vendor/md5.ts')
    expect(section).toContain('src/tools/vendor/asn1.ts')
    // The reasons: Web Crypto has no MD5, and a general ASN.1 library is far
    // larger than the walking the cert tool does.
    expect(section).toMatch(/Web Crypto/)
    expect(section).toMatch(/ASN\.1/)
  })

  it('names every fixture and the tools that generated them', () => {
    // A fixture nobody can regenerate is a binary blob with expectations
    // pinned to it. Read off disk so a new fixture added without a recipe
    // fails here rather than being discovered by whoever has to refresh it.
    const section = toolsRouteSection()

    const fixtures = readdirSync(resolve(siteDir, 'test/fixtures'))
    expect(fixtures.length).toBeGreaterThan(0)
    for (const fixture of fixtures) {
      expect(section, fixture).toContain(fixture)
    }

    expect(section).toContain('openssl')
    expect(section).toContain('ssh-keygen')
  })

  it('names the suite that enforces the no-network guarantee', () => {
    // The promise the whole page rests on, and the only reason pasting a real
    // credential into it is reasonable.
    const section = toolsRouteSection()

    expect(section).toContain('test/tools-no-network.test.ts')
    expect(section).toMatch(/network/i)
  })
})

describe('site README layout shell: the tools components', () => {
  it('names both tools components in the shell table', () => {
    // Same rule as the rice treatments' four files: a component added to src/
    // and never named here is one nobody can find from the document.
    const section = layoutShellSection()

    expect(section).not.toBe('')
    for (const file of [
      'src/components/tools/ToolsPage.tsx',
      'src/components/tools/ToolPane.tsx',
    ]) {
      expect(section, file).toContain(file)
    }
  })
})

describe('site README accessibility: the tools route', () => {
  it('says the a11y suite covers the tools route too', () => {
    // The route replaces everything inside <main>, so the landmark and
    // heading facts are re-asserted there rather than inherited. A reader
    // consulting the table to find out what is covered would otherwise
    // conclude only the resume is.
    const section = accessibilitySection()

    expect(section).toContain('src/a11y.test.tsx')
    expect(section).toMatch(/#\/tools/)
  })
})

describe('site README manual checklist: the tools route', () => {
  it('walks the Network tab, which is the no-network promise itself', () => {
    // test/tools-no-network.test.ts reads source; only a browser says what
    // was actually sent. That gap is exactly what this item covers.
    const item = itemStartingWith(/^- \[ \] \*\*`#\/tools` makes zero network/m)

    expect(item).not.toBe('')
    expect(item).toMatch(/Network tab/i)
    expect(item).toMatch(/paste/i)
  })

  it('walks the JWT expiry countdown, which needs a real clock', () => {
    const checklist = manualChecklist()

    expect(checklist).toMatch(/countdown/i)
    expect(checklist).toMatch(/\bexp\b/)
  })

  it('walks reloading a shared fragment URL', () => {
    // Tool, input and output all have to come back, and the secret must not.
    const item = itemStartingWith(/^- \[ \] \*\*A shared fragment URL/m)

    expect(item).not.toBe('')
    expect(item).toMatch(/secret/i)
    expect(item).toMatch(/4\s?KB/i)
  })

  it('walks the route at the same widths and in both palettes', () => {
    const item = itemStartingWith(/^- \[ \] \*\*Walk `#\/tools`/m)

    expect(item).not.toBe('')
    for (const width of ['320', '375', '768', '1024', '1440']) {
      expect(item, `${width}px`).toContain(width)
    }
    expect(item).toMatch(/\blight\b/i)
    expect(item).toMatch(/\bdark\b/i)
  })
})

describe('root README repo layout: the tools route', () => {
  it('points at the tools directory', () => {
    // The one place a reader lands first, and the route is otherwise
    // invisible from the repository root: it has no file of its own there.
    expect(layoutSection()).toContain('site/src/tools/')
  })
})

describe('root README live URL', () => {
  it('links the live site', () => {
    expect(documentedLiveUrl()).not.toBe('')
    expect(layoutSection()).toContain(documentedLiveUrl())
  })

  it('gives the same URL site/README.md does', () => {
    // Two documents naming the deployed site is two places to get it wrong.
    const url = documentedLiveUrl()
    expect(url).toMatch(/^https:\/\//)
    expect(rootReadme).toContain(url)
  })

  it('matches the path vite.config.ts builds assets for', () => {
    // A live URL of /resume/ and a base of / is a blank page with a 200.
    const base = /base:\s*'([^']+)'/.exec(viteConfig)?.[1] ?? ''
    expect(base).not.toBe('')
    expect(new URL(documentedLiveUrl()).pathname).toBe(base)
  })
})

describe('site README internal anchor links', () => {
  it('every internal link target resolves to a heading', () => {
    // A heading rename is invisible to every other assertion here: the prose
    // still reads correctly and the link still renders, it just lands
    // nowhere. So the fragments are checked against the headings they name.
    const targets = new Set(
      [...siteReadme.matchAll(/\]\(#([^)]+)\)/g)].map((match) => match[1]),
    )
    const headingSlugs = [...siteReadme.matchAll(/^#{1,6} (.+)$/gm)].map((match) =>
      match[1]
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/_/g, '')
        // No trimming of leading or trailing hyphens: GitHub keeps them, so
        // `### \`--color-border\` vs …` really does anchor at `#--color-border-vs-…`.
        .replace(/\s+/g, '-'),
    )

    expect(targets.size).toBeGreaterThan(0)
    for (const target of targets) {
      expect(headingSlugs, target).toContain(target)
    }
  })
})
