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

/** The root README from the "Repo layout" heading to the end of the file. */
const layoutSection = (): string => {
  const start = rootReadme.search(layoutHeading)
  return start === -1 ? '' : rootReadme.slice(start)
}

/** site/README.md from the manual checklist heading to the end of the file. */
const manualChecklist = (): string => {
  const start = siteReadme.search(checklistHeading)
  return start === -1 ? '' : siteReadme.slice(start)
}

/** site/README.md's Accessibility section, up to the next `##` heading. */
const accessibilitySection = (): string => {
  const start = siteReadme.search(accessibilityHeading)
  if (start === -1) return ''
  const rest = siteReadme.slice(start)
  const end = rest.slice(1).search(/^## /m)
  return end === -1 ? rest : rest.slice(0, end + 1)
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
