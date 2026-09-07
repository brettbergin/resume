import { describe, expect, it } from 'vitest'

import {
  achievements,
  competencies,
  contact,
  experiences,
  projects,
  summary,
  technicalSkills,
} from './resume.ts'
import type { SkillGroup } from './types.ts'

/*
 * Guard rails, not a transcript check: these catch a section being emptied or
 * an entry being dropped by accident. The exact counts are the ones in
 * `resume.md` — if the source resume gains or loses an entry, update both the
 * data and the count here in the same change. Wording lives in resume.md.
 */

/** Every skill group on the page, whichever section it renders in. */
const skillGroups: SkillGroup[] = [...competencies, ...technicalSkills]

const monthNames = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

/** The shape every `dates` string uses: `Month YYYY - Month YYYY|Present`. */
const datesPattern = new RegExp(
  `^(?:${monthNames.join('|')}) \\d{4} - (?:(?:${monthNames.join('|')}) \\d{4}|Present)$`,
)

/**
 * Turn the `Month YYYY` half of a `dates` string into a comparable number.
 * `dates` is a display string by design (see types.ts), so the test parses it
 * rather than the data carrying a second machine-readable field.
 */
function monthStamp(monthAndYear: string): number {
  const [month, year] = monthAndYear.split(' ')
  const monthIndex = monthNames.indexOf(month)
  expect(monthIndex, `unknown month in "${monthAndYear}"`).toBeGreaterThan(-1)
  return Date.UTC(Number(year), monthIndex)
}

/** The start half of a `dates` string, as a comparable number. */
function startOf(dates: string): number {
  return monthStamp(dates.split(' - ')[0])
}

describe('resume section counts', () => {
  it('keeps every achievement from resume.md', () => {
    expect(achievements).toHaveLength(7)
  })

  it('keeps every core competency column', () => {
    expect(competencies).toHaveLength(3)
  })

  it('keeps every technical skill group', () => {
    expect(technicalSkills).toHaveLength(9)
  })

  it('keeps every role in the work history', () => {
    expect(experiences).toHaveLength(8)
  })

  it('keeps every open source project', () => {
    expect(projects).toHaveLength(7)
  })
})

describe('resume identity', () => {
  it('fills in every summary field', () => {
    expect(summary.name).not.toBe('')
    expect(summary.title).not.toBe('')
    expect(summary.professionalSummary).not.toBe('')
  })

  it('fills in every contact field', () => {
    for (const [field, value] of Object.entries(contact)) {
      expect(value, field).not.toBe('')
    }
  })
})

describe('resume entries', () => {
  it('gives every skill group a label and non-empty items', () => {
    expect(skillGroups).not.toHaveLength(0)
    for (const group of skillGroups) {
      expect(group.label).not.toBe('')
      expect(group.items).not.toHaveLength(0)
      for (const item of group.items) {
        expect(item, group.label).not.toBe('')
      }
    }
  })

  it('gives every experience its fields and bullets', () => {
    for (const experience of experiences) {
      expect(experience.company).not.toBe('')
      expect(experience.title, experience.company).not.toBe('')
      expect(experience.dates, experience.company).not.toBe('')
      expect(experience.location, experience.company).not.toBe('')
      expect(experience.highlights.length, experience.company).toBeGreaterThan(0)
      for (const highlight of experience.highlights) {
        expect(highlight, experience.company).not.toBe('')
      }
    }
  })

  it('gives every project a name, description and https URL', () => {
    for (const project of projects) {
      expect(project.name).not.toBe('')
      expect(project.description, project.name).not.toBe('')
      expect(project.url, project.name).toMatch(/^https:\/\//)
    }
  })

  it('gives every achievement text', () => {
    for (const achievement of achievements) {
      expect(achievement.text).not.toBe('')
    }
  })

  it('pulls a metric out of at least one achievement for the callouts', () => {
    const withMetric = achievements.filter(
      (achievement) => achievement.metric !== undefined,
    )
    expect(withMetric.length).toBeGreaterThan(0)
    for (const achievement of withMetric) {
      expect(achievement.metric, achievement.text).not.toBe('')
    }
  })
})

/*
 * The timeline renders `experiences` in array order and deliberately does no
 * sorting of its own, so "reverse-chronological" is a promise the data keeps,
 * not the component. That makes this the right place for the guard: swapping
 * two roles in resume.ts fails here rather than silently rendering out of
 * order.
 */
describe('experiences are reverse-chronological', () => {
  it('formats every date range as `Month YYYY - Month YYYY|Present`', () => {
    for (const experience of experiences) {
      expect(experience.dates, experience.company).toMatch(datesPattern)
    }
  })

  it('never lets a role start later than the role above it', () => {
    for (let index = 1; index < experiences.length; index += 1) {
      const previous = experiences[index - 1]
      const current = experiences[index]
      expect(
        startOf(current.dates),
        `${current.company} (${current.dates}) should not start after ${previous.company} (${previous.dates})`,
      ).toBeLessThanOrEqual(startOf(previous.dates))
    }
  })

  it('keeps the only current role at the top', () => {
    for (const [index, experience] of experiences.entries()) {
      if (index === 0) continue
      expect(experience.dates, experience.company).not.toMatch(/Present$/)
    }
  })
})
