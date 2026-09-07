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

/** The checked fields whose text is missing from the given markdown. */
const missingFrom = (source: string): Field[] =>
  checkedFields.filter((field) => !source.includes(field.value))

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
})
