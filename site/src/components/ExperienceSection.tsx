/*
 * The work experience section: every role in `experiences`, as a vertical
 * timeline.
 *
 * The order on the page is the data module's order and nothing else —
 * `resume.ts` stores the roles most-recent-first, so this maps the array as it
 * comes. There is no sort, reverse or slice here or in ExperienceEntry: a
 * chronology re-derived in the view is one more place for it to disagree with
 * the resume, and `resume.test.ts` is what guards the ordering.
 *
 * An <ol> holds the entries because the list is a chronology and its order
 * carries meaning; the bullets inside each entry stay a nested <ul>.
 *
 * The section wrapper is App.tsx's, which labels itself
 * `aria-labelledby={id + '-heading'}`; this component owns the heading that id
 * points at, so both the id and its text arrive as props (the text is the
 * section registry's label, which keeps the nav and the on-page heading from
 * drifting). The document's one <h1> is the hero's, so the top heading here is
 * an <h2>.
 *
 * A phone with every role fully expanded is a screen's worth of scroll per
 * role stacked eight deep, and the per-entry show-more toggle in
 * ExperienceEntry.tsx does nothing about that — it only fires past four
 * bullets, and no role in `resume.ts` reaches that. So there is a second,
 * section-level toggle here, orthogonal to the per-entry one: the most recent
 * `VISIBLE_ROLES` always render, and the rest are left out of the DOM (not
 * CSS-hidden, for the same reason ExperienceEntry leaves its collapsed
 * bullets out) until this toggle reveals them. Expanding it reproduces
 * exactly the array's order and content — nothing about an individual role
 * changes, and nothing here reaches into ExperienceEntry's own state.
 */

import { useState } from 'react'

import { experiences } from '../data/resume.ts'
import { FOCUS_RING, TAP_TARGET_HEIGHT } from '../styles.ts'
import { ExperienceEntry } from './ExperienceEntry.tsx'

/** How many of the most recent roles render unconditionally. The rest
 * collapse behind the section-level toggle below. */
const VISIBLE_ROLES = 3

export function ExperienceSection({
  headingId,
  heading,
}: {
  headingId: string
  heading: string
}) {
  const [expanded, setExpanded] = useState(false)

  // The id `aria-controls` points at: the <ol> itself, since that is what
  // holds the revealed roles once expanded — the same "resolves to the list
  // itself, not a wrapper" pattern ExperienceEntry's own toggle uses.
  const listId = `${headingId}-timeline`

  const hiddenCount = experiences.length - VISIBLE_ROLES
  const collapsible = hiddenCount > 0
  const visibleExperiences =
    collapsible && !expanded ? experiences.slice(0, VISIBLE_ROLES) : experiences

  return (
    <div className="flex flex-col gap-6">
      <h2 id={headingId} className="text-2xl font-medium">
        {heading}
      </h2>

      {/* No flex gap between entries: the connecting line is each entry's left
          border, and a gap would cut it into segments. Entries space
          themselves with bottom padding instead. `pl-2` keeps the markers,
          which straddle the line, inside the content column at 320px. */}
      <ol id={listId} role="list" className="flex flex-col pl-2">
        {visibleExperiences.map((experience) => (
          <ExperienceEntry
            key={`${experience.company} ${experience.dates}`}
            experience={experience}
          />
        ))}
      </ol>

      {/* Mirrors ExperienceEntry's own toggle: a count-labelled button when
          collapsed, "Show less" when expanded, aria-expanded reflecting
          state and aria-controls pointing at what it reveals. */}
      {collapsible ? (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={() => {
            setExpanded((wasExpanded) => !wasExpanded)
          }}
          className={`inline-flex ${TAP_TARGET_HEIGHT} w-fit items-center rounded-pill border border-border-strong px-4 text-base text-text hover:text-accent ${FOCUS_RING}`}
        >
          {expanded ? 'Show less' : `Show ${hiddenCount} earlier roles`}
        </button>
      ) : null}
    </div>
  )
}
