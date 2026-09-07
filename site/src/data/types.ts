/*
 * Shapes for the resume content in `resume.ts`. Interfaces only — no data
 * lives here, so a section component can import just the type it renders.
 *
 * Strings are display-ready: dates are already formatted for the page rather
 * than parsed from anything, and bullet text is kept short and split into
 * arrays so narrow screens can wrap it as an ordinary list.
 */

/** Header contact details. */
export interface ContactInfo {
  email: string
  phone: string
  location: string
  githubUrl: string
  gpgFingerprint: string
}

/** A labelled cluster of skills: one Core Competencies column, or one
 * Technical Skills row. */
export interface SkillGroup {
  label: string
  items: string[]
}

/** One role in the work history. */
export interface Experience {
  company: string
  title: string
  /** Display-ready range, e.g. `September 2024 - Present`. */
  dates: string
  location: string
  /** Short bullets, one string each — never a single paragraph. */
  highlights: string[]
}

/** A key achievement bullet. */
export interface Achievement {
  /** The full bullet, as written in the resume. */
  text: string
  /** The figure pulled out of `text`, when it carries one, for callout
   * treatments. Unset for bullets without a figure. */
  metric?: string
}

/** An open source project. */
export interface Project {
  name: string
  description: string
  url: string
}

/** Identity and the professional summary paragraph. */
export interface Summary {
  name: string
  title: string
  professionalSummary: string
}
