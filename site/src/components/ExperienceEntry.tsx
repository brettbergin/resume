/*
 * One role in the work history: the row of the experience timeline.
 *
 * The entry takes its `Experience` as a prop rather than reaching into
 * `../data/resume.ts`, so the section owns the ordering (and only the section
 * needs the data module) and a test can render this against a fixture.
 *
 * The timeline treatment is a single left-aligned column at every width: the
 * connecting line is the entry's own left border, so consecutive entries draw
 * one unbroken line, and the marker is a disc positioned on top of it. There
 * is deliberately no alternating/two-sided variant — it needs width a phone
 * does not have, and the mobile-first contract in README.md rules it out.
 *
 * Nothing here is clipped: company, title, dates and location are ordinary
 * wrapping text — no ellipsis utility, no single-line utility, no fixed-height
 * text box — and the meta line is its own wrapping flex row, so dates and
 * location fall onto separate lines at 375px instead of widening the page.
 *
 * Long bullet lists collapse behind a show-more toggle past
 * `VISIBLE_HIGHLIGHTS`. No role in `resume.ts` reaches that threshold today —
 * every one of them has three highlights, so the toggle never renders against
 * the live data and the section reads exactly as it did before. The threshold
 * is here so that growing a role's bullets in `resume.ts` cannot silently turn
 * the section into a wall of text on a phone; the same way SkillsSection
 * refuses to invent a proficiency level, nothing here pretends the current
 * content is longer than it is, and the collapsing behaviour is exercised by
 * fixtures in the test rather than by the resume.
 */

import { useState } from 'react'

import type { Experience } from '../data/types.ts'
import { FOCUS_RING, TAP_TARGET_HEIGHT } from '../styles.ts'

/** How many bullets a role may have before the rest are collapsed. Four is
 * about a phone screen's worth of highlights above the next role's heading;
 * a role with five or more hides the remainder behind the toggle. At or below
 * this count no button renders at all. */
const VISIBLE_HIGHLIGHTS = 4

/** The DOM id of an entry's role heading, which its bullet list is
 * `aria-labelledby`. Company alone is not unique (three eBay rows) and neither
 * is title (two Senior Application Security Engineer rows), so the id is built
 * from company *and* dates, which no two roles share. Runs of
 * non-alphanumerics collapse to a single hyphen. */
function entryHeadingId({ company, dates }: Experience): string {
  return `experience-${`${company} ${dates}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')}`
}

export function ExperienceEntry({ experience }: { experience: Experience }) {
  const [expanded, setExpanded] = useState(false)

  const headingId = entryHeadingId(experience)
  // `aria-controls` needs a real id on the list, and it has to be as
  // collision-proof as the heading's, so it is derived from the same string.
  const highlightsId = `${headingId}-highlights`

  const hiddenCount = experience.highlights.length - VISIBLE_HIGHLIGHTS
  const collapsible = hiddenCount > 0
  // Collapsed bullets are left out of the render, not clipped with a height:
  // what a screen reader walks and what a sighted reader sees stay the same
  // list, and Ctrl+F cannot land on text nobody can see.
  const visibleHighlights =
    collapsible && !expanded
      ? experience.highlights.slice(0, VISIBLE_HIGHLIGHTS)
      : experience.highlights

  return (
    /* `border-l` is the connecting line and `pl-6` (1.5rem) is the gutter it
       runs in; the bottom padding is what separates entries, so the line is
       not broken by a flex gap. The last entry stops the line at its own
       content. */
    <li className="relative border-l border-border pb-8 pl-6 last:pb-0">
      {/* The marker: a disc straddling the line, centred on it by
          `-translate-x-1/2` and decorative, so it is hidden from assistive
          tech. */}
      <span
        aria-hidden="true"
        className="absolute top-1.5 left-0 size-3 -translate-x-1/2 rounded-pill border border-border bg-accent"
      />

      <div className="flex flex-col gap-2">
        <h3 id={headingId} className="text-lg font-medium">
          {experience.title}
        </h3>

        <p className="text-base font-medium text-accent">
          {experience.company}
        </p>

        {/* Dates and location wrap as their own row rather than sharing a
            line they may not fit on. */}
        <p className="flex flex-wrap gap-2 text-base text-muted">
          <span>{experience.dates}</span>
          <span aria-hidden="true">&middot;</span>
          <span>{experience.location}</span>
        </p>
      </div>

      {/* `list-disc` needs list-item children, so the bullets are spaced with
          `space-y-*` rather than turned into a flex column. */}
      <ul
        id={highlightsId}
        aria-labelledby={headingId}
        className="mt-4 list-disc space-y-2 pl-5 text-base text-text"
      >
        {visibleHighlights.map((highlight) => (
          <li key={highlight}>{highlight}</li>
        ))}
      </ul>

      {/* Nothing at all below the list for a role short enough to read whole:
          no button and no wrapper, so the layout of today's entries is
          unchanged. The label counts what is hidden rather than saying "more",
          so it is still unambiguous read out of context. */}
      {collapsible ? (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={highlightsId}
          onClick={() => {
            setExpanded((wasExpanded) => !wasExpanded)
          }}
          className={`mt-3 inline-flex ${TAP_TARGET_HEIGHT} items-center rounded-pill border border-border-strong px-4 text-base text-text hover:text-accent ${FOCUS_RING}`}
        >
          {expanded ? 'Show less' : `Show ${hiddenCount} more`}
        </button>
      ) : null}
    </li>
  )
}
