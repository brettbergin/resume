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

/** One anchored section of the page, as listed in `sections.ts`. */
export interface PageSection {
  /** The DOM id of the section, and the anchor fragment the nav links to.
   * Kebab-case, with no leading `#`. */
  id: string
  /** The nav text for the section. */
  label: string
}

/** One page the header links to that is *not* a section of the resume: the
 * `~/tools` route, rendered by the hash router in `App.tsx`.
 *
 * Deliberately its own shape rather than another `PageSection`: a section id
 * is an on-page anchor — `App.tsx` renders an element carrying it and
 * `App.test.tsx` asserts every `#`-link resolves to an element id — while a
 * route names a view that replaces those sections, so no element on the page
 * ever carries it. The href is written out in full rather than derived from
 * the id, because the route path (`#/tools`) is not the id (`tools`). */
export interface RouteLink {
  /** Stable key for the route, matching the tools page's own name. */
  id: string
  /** The nav text for the route. */
  label: string
  /** The full hash href, leading `#` included. */
  href: string
}

/** Identity and the professional summary paragraph. */
export interface Summary {
  name: string
  title: string
  professionalSummary: string
  /** File name of the downloadable resume, as it is published at the site
   * root. The component joins it with `import.meta.env.BASE_URL` to build the
   * href; the build emits the repo-root file under this same name. */
  resumePdfFileName: string
}
