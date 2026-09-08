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
 */

import { experiences } from '../data/resume.ts'
import { ExperienceEntry } from './ExperienceEntry.tsx'

export function ExperienceSection({
  headingId,
  heading,
}: {
  headingId: string
  heading: string
}) {
  return (
    <div className="flex flex-col gap-6">
      <h2 id={headingId} className="text-2xl font-medium">
        {heading}
      </h2>

      {/* No flex gap between entries: the connecting line is each entry's left
          border, and a gap would cut it into segments. Entries space
          themselves with bottom padding instead. `pl-2` keeps the markers,
          which straddle the line, inside the content column at 320px. */}
      <ol role="list" className="flex flex-col pl-2">
        {experiences.map((experience) => (
          <ExperienceEntry
            key={`${experience.company} ${experience.dates}`}
            experience={experience}
          />
        ))}
      </ol>
    </div>
  )
}
