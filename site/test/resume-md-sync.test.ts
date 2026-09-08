import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  achievements,
  competencies,
  contact,
  experiences,
  projects,
  summary,
  technicalSkills,
} from '../src/data/resume.ts'

/*
 * `src/data/resume.ts` is a hand transcription of the repo-root `resume.md`,
 * and everything the site renders comes from the transcription rather than the
 * markdown. Nothing else notices the two drifting apart: `resume.test.ts` is
 * deliberately guard rails only (counts and non-emptiness), so a bullet
 * reworded in one file and not the other survives every check and is only
 * caught by someone reading both documents side by side. This suite is that
 * reading, done mechanically: every string the data module transcribes has to
 * appear verbatim somewhere in `resume.md`.
 *
 * The strings are collected by walking the exports generically — every string
 * property and every string in a string array — so a field added to a type
 * later is covered without anyone editing this file, and a field that is
 * deliberately not resume prose has to be named in `excludedFields` with a
 * reason.
 *
 * Deliberately not covered:
 *
 * - The `References` section of `resume.md`, which `resume.ts` intentionally
 *   omits (third parties' personal contact details; see the header of
 *   `resume.ts`). This check is one-directional — markdown content with no
 *   counterpart in the data is not a failure.
 * - `resume.html` and `resume.pdf`, which are separate exports of the same
 *   resume. The PDF is compared against what the build emits by
 *   `resume-pdf.test.ts` and by ci.yml; neither is a transcription of the
 *   data module.
 */

const here = dirname(fileURLToPath(import.meta.url))

/** The human-authored original, read once. */
const markdown = readFileSync(resolve(here, '..', '..', 'resume.md'), 'utf8')

/** Every export of the data module that holds transcribed resume content. */
const transcribed: Record<string, unknown> = {
  contact,
  summary,
  achievements,
  competencies,
  technicalSkills,
  experiences,
  projects,
}

/**
 * Field paths that hold something other than resume prose. Written with array
 * indices blanked (`achievements[].metric`) so one entry covers every element.
 */
const excludedFields = new Set([
  // The file name the published PDF is built under (`resume.pdf`). It is a
  // build artifact of the resume, not a line of it, and the markdown has no
  // reason to mention it.
  'summary.resumePdfFileName',
  // An editorial condensation of `text`, pulled out for callout treatments and
  // reworded to stand alone: `'500,000+ endpoints'` against the markdown's
  // "covering 500,000+ compute endpoints in OpenStack environment". The bullet
  // it comes from is checked, so the figure is still pinned to the markdown.
  'achievements[].metric',
])

interface Field {
  /** Where the string lives, e.g. `experiences[3].highlights[1]`. */
  path: string
  /** The same with array indices blanked, e.g. `experiences[].highlights[]`. */
  pattern: string
  value: string
}

/** Every string reachable from `value`, with the path that leads to it. */
function collect(
  value: unknown,
  path: string,
  pattern: string,
  into: Field[],
): void {
  if (typeof value === 'string') {
    into.push({ path, pattern, value })
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      collect(item, `${path}[${index}]`, `${pattern}[]`, into),
    )
    return
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      collect(child, `${path}.${key}`, `${pattern}.${key}`, into)
    }
  }
}

/** Every string in each export, exclusions included. */
const fieldsByExport = new Map<string, Field[]>(
  Object.entries(transcribed).map(([name, value]) => {
    const fields: Field[] = []
    collect(value, name, name, fields)
    return [name, fields]
  }),
)

const allFields = [...fieldsByExport.values()].flat()

/** The subset actually compared against the markdown. */
const checked = (fields: Field[]): Field[] =>
  fields.filter((field) => !excludedFields.has(field.pattern))

const checkedFields = checked(allFields)

/**
 * Four field categories are checked against the specific markdown section
 * they were transcribed from, rather than the whole document, so a bullet
 * attributed to the wrong role (or an item planted on the wrong skills line)
 * is caught even though the identical text is still present verbatim
 * somewhere else in the file. Everything else keeps the whole-document check.
 *
 * These operate on a `source` parameter rather than the module-level
 * `markdown` constant so the same scoping logic runs against the mutated
 * copies the tests below build.
 */

/** The substring of `source` between a `## ` heading and the next one. */
function sectionBody(source: string, heading: string): string {
  const headingLine = `## ${heading}`
  const start = source.indexOf(headingLine)
  if (start === -1) {
    throw new Error(`markdown has no "${headingLine}" section`)
  }
  const afterHeading = start + headingLine.length
  const nextHeading = source.slice(afterHeading).search(/\n## /)
  const end =
    nextHeading === -1 ? source.length : afterHeading + nextHeading
  return source.slice(start, end)
}

/** The `### <title>` block for the role matching both `title` and `company`. */
function experienceBlock(source: string, company: string, title: string): string {
  const section = sectionBody(source, 'Work Experience')
  const headings = [...section.matchAll(/^### .+$/gm)]
  const blocks = headings.map((match, index) => {
    const start = match.index
    const end =
      index + 1 < headings.length ? headings[index + 1].index : section.length
    return section.slice(start, end)
  })
  const titleLine = `### ${title}`
  const companyLine = `**${company}**`
  const matches = blocks.filter(
    (block) => block.split('\n')[0] === titleLine && block.includes(companyLine),
  )
  if (matches.length !== 1) {
    throw new Error(
      `expected exactly one Work Experience block for company ${JSON.stringify(company)} / title ${JSON.stringify(title)}, found ${matches.length}`,
    )
  }
  return matches[0]
}

/** The `**<label>:**` line in the Technical Skills section. */
function technicalSkillsLine(source: string, label: string): string {
  const section = sectionBody(source, 'Technical Skills')
  const marker = `**${label}:**`
  const lines = section.split('\n').filter((line) => line.startsWith(marker))
  if (lines.length !== 1) {
    throw new Error(
      `expected exactly one Technical Skills line for label ${JSON.stringify(label)}, found ${lines.length}`,
    )
  }
  return lines[0]
}

/** The Open Source Projects table row containing `url`. */
function projectRow(source: string, url: string): string {
  const section = sectionBody(source, 'Open Source Projects')
  // Matched as `(url)`, the exact markdown link syntax, so a url that is a
  // prefix of another project's url (`DisableMySSH` vs `DisableMySSH-Infra`)
  // still picks out a single row.
  const lines = section.split('\n').filter((line) => line.includes(`(${url})`))
  if (lines.length !== 1) {
    throw new Error(
      `expected exactly one Open Source Projects row containing ${JSON.stringify(url)}, found ${lines.length}`,
    )
  }
  return lines[0]
}

const experienceHighlightPath = /^experiences\[(\d+)\]\.highlights\[\d+\]$/
const technicalSkillsItemPath = /^technicalSkills\[(\d+)\]\.items\[\d+\]$/
const projectFieldPath = /^projects\[(\d+)\]\.(?:name|url)$/

/** The substring of `source` this field is checked against. */
function scopeFor(field: Field, source: string): string {
  if (field.pattern === 'achievements[].text' || field.pattern === 'achievements[].metric') {
    return sectionBody(source, 'Key Achievements')
  }

  const highlightMatch = experienceHighlightPath.exec(field.path)
  if (highlightMatch) {
    const experience = experiences[Number(highlightMatch[1])]
    return experienceBlock(source, experience.company, experience.title)
  }

  const skillMatch = technicalSkillsItemPath.exec(field.path)
  if (skillMatch) {
    return technicalSkillsLine(source, technicalSkills[Number(skillMatch[1])].label)
  }

  const projectMatch = projectFieldPath.exec(field.path)
  if (projectMatch) {
    return projectRow(source, projects[Number(projectMatch[1])].url)
  }

  return source
}

/** The checked fields whose text is missing from their scoped section of the
 * given markdown. */
const missingFrom = (source: string): Field[] =>
  checkedFields.filter((field) => !scopeFor(field, source).includes(field.value))

describe('resume.ts transcribes resume.md', () => {
  for (const [name, fields] of fieldsByExport) {
    it(`copies every string in \`${name}\` verbatim`, () => {
      const compared = checked(fields)
      expect(compared.length, name).toBeGreaterThan(0)
      for (const field of compared) {
        expect(markdown, field.path).toContain(field.value)
      }
    })
  }
})

describe('the sync check itself', () => {
  it('walks the whole data module rather than a corner of it', () => {
    // A refactor that quietly stops collecting would leave every assertion
    // above passing vacuously. The count is 165 today.
    expect(checkedFields.length).toBeGreaterThan(100)
  })

  it('still has both excluded fields to exclude', () => {
    // An exclusion for a field that no longer exists is a hole waiting for the
    // name to be reused. If a field goes away, drop its entry here too.
    const patterns = new Set(allFields.map((field) => field.pattern))
    for (const excluded of excludedFields) {
      expect(patterns, excluded).toContain(excluded)
    }
  })

  it('reports drift when a transcribed string stops matching', () => {
    // Proves the comparison can fail, without touching a file on disk: one
    // known bullet is altered in an in-memory copy of the markdown, and only
    // that field may come back missing.
    const drifted = markdown.replace(achievements[0].text, 'drifted')
    expect(drifted).not.toBe(markdown)

    expect(missingFrom(drifted).map((field) => field.path)).toEqual([
      'achievements[0].text',
    ])
  })

  it('finds nothing missing against the markdown as it stands', () => {
    expect(missingFrom(markdown)).toEqual([])
  })

  it('reports a highlight relocated into a different role\'s block as missing for its real role', () => {
    // A highlight that belongs to OnePay's block is removed from it and
    // duplicated, verbatim, inside Cisco's block instead. A whole-document
    // check would find the text present and call it a day; the scoped check
    // must still flag it missing for OnePay, the role it actually belongs to.
    const onePay = experiences[0]
    const cisco = experiences[1]
    const movedHighlight = onePay.highlights[0]

    const withoutOriginal = markdown.replace(`- ${movedHighlight}\n`, '')
    expect(withoutOriginal).not.toBe(markdown)

    const ciscoAnchor = `- ${cisco.highlights[0]}\n`
    const relocated = withoutOriginal.replace(
      ciscoAnchor,
      `${ciscoAnchor}- ${movedHighlight}\n`,
    )
    expect(relocated).not.toBe(withoutOriginal)

    // The text is still present verbatim in the document as a whole...
    expect(relocated).toContain(movedHighlight)
    // ...but scoped to OnePay's own block, it is gone.
    expect(missingFrom(relocated).map((field) => field.path)).toContain(
      'experiences[0].highlights[0]',
    )
  })

  it('reports a technicalSkills item planted on a different label line as missing', () => {
    // An item that belongs to the "Security Tools" line is removed from it
    // and planted, verbatim, on the "SIEM/Analytics" line instead.
    const group = technicalSkills[0]
    const other = technicalSkills[1]
    const movedItem = group.items[0]

    const withoutOriginal = markdown.replace(movedItem, 'REDACTED')
    expect(withoutOriginal).not.toBe(markdown)

    const otherLine = `**${other.label}:** ${other.items.join(', ')}`
    expect(withoutOriginal).toContain(otherLine)
    const relocated = withoutOriginal.replace(otherLine, `${otherLine}, ${movedItem}`)
    expect(relocated).not.toBe(withoutOriginal)

    expect(relocated).toContain(movedItem)
    expect(missingFrom(relocated).map((field) => field.path)).toContain(
      'technicalSkills[0].items[0]',
    )
  })
})
