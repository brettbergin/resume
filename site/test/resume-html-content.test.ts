import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/*
 * Checks the committed `resume.html` still says what `resume.md` says.
 *
 * Both are hand-rendered exports of the markdown and nothing compares their
 * content to it: `resume-md-sync.test.ts` deliberately excludes both exports,
 * `resume-pdf.test.ts` only checks the PDF's bytes survive the Vite plugin,
 * and `resume-pdf-layout.test.ts` reads the PDF, not the HTML. So an edit to
 * `resume.md` that is not followed by a re-render ships the old page with
 * every other gate green.
 *
 * The expectations are parsed out of `resume.md` at test time rather than
 * listed here, so a project added or a role retitled later is covered without
 * anyone editing this file. It is one-directional, like the markdown sync
 * check: content in the HTML with no counterpart in the markdown is not a
 * failure here.
 */

const here = dirname(fileURLToPath(import.meta.url))

const html = readFileSync(resolve(here, '..', '..', 'resume.html'), 'utf8')
const md = readFileSync(resolve(here, '..', '..', 'resume.md'), 'utf8')

/**
 * `resume.html` as prose to search: character references resolved and every
 * run of whitespace flattened to one space.
 *
 * The renderer hard-wraps its output and escapes markup characters, so a
 * heading reads `MTS 1, Data\nScience Engineer` and an employer reads
 * `Application\n&amp; Product Security` — both of which a raw `toContain` of
 * the markdown's own wording would miss for reasons that have nothing to do
 * with the content being stale. `\s` covers the non-breaking spaces the
 * renderer inserts (`Inc. / Meraki`) along with the line breaks.
 */
const named: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
}
const readable = html
  .replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (entity) => named[entity])
  .replace(/\s+/g, ' ')

/** The markdown between a `## ` heading and the next one. */
const section = (heading: string): string => {
  const headingLine = `## ${heading}`
  const start = md.indexOf(headingLine)
  if (start === -1) throw new Error(`resume.md has no "${headingLine}" section`)
  const after = start + headingLine.length
  const next = md.slice(after).search(/\n## /)
  return next === -1 ? md.slice(start) : md.slice(start, after + next)
}

/** resume.md's only inline links are the project table's `[name](url)`. */
const projects = [...md.matchAll(/\[([^\]]+)\]\((https[^)]+)\)/g)].map(
  ([, name, url]) => ({ name, url }),
)

const workExperience = section('Work Experience')

/** One per role, e.g. `Senior Product Security Engineer`. */
const roleTitles = [...workExperience.matchAll(/^### (.+)$/gm)].map(
  ([, title]) => title,
)

/**
 * The bold employer line under each role, e.g. `GitHub`. Read out of the Work
 * Experience section rather than the whole document so the bold names in
 * `References` — which the page intentionally omits — are not demanded of it.
 */
const employers = [...workExperience.matchAll(/^\*\*([^*]+)\*\*/gm)].map(
  ([, employer]) => employer,
)

describe('committed resume.html', () => {
  it('contains every project URL from resume.md', () => {
    expect(projects.length).toBeGreaterThan(0)
    for (const { name, url } of projects) {
      expect(readable, `${name}'s link is missing from resume.html`).toContain(url)
    }
  })

  it('contains every project name from resume.md', () => {
    expect(projects.length).toBeGreaterThan(0)
    for (const { name } of projects) {
      expect(readable, `${name} is missing from resume.html`).toContain(name)
    }
  })

  it('contains every role title from resume.md', () => {
    expect(roleTitles.length).toBeGreaterThan(0)
    for (const title of roleTitles) {
      expect(readable, `${title} is missing from resume.html`).toContain(title)
    }
  })

  it('contains every employer name from resume.md', () => {
    expect(employers.length).toBeGreaterThan(0)
    for (const employer of employers) {
      expect(readable, `${employer} is missing from resume.html`).toContain(employer)
    }
  })
})
