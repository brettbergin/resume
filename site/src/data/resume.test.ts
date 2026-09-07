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
