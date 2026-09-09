import { readFileSync } from 'node:fs'
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
