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

  it('leaves the resume itself reading from the top', () => {
    // The section is an appendix: everything above it is the resume.
    const start = rootReadme.search(layoutHeading)
    expect(start).toBeGreaterThan(0)
    expect(rootReadme.slice(0, start)).toMatch(/^# Brett Bergin/)
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
