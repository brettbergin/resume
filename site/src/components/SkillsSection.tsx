/*
 * The skills section: the resume's core competencies and its technical skills,
 * each group a labelled cluster of chips rather than one run-on bullet list.
 *
 * Every group and every item comes from the `competencies` and
 * `technicalSkills` exports, in the data module's order — the only strings
 * written here are the two sub-block titles, the same way the hero writes its
 * button labels and the footer its "built with" note. Nothing here derives a
 * proficiency level, rating or bar: `resume.md` has none, so any such figure
 * would be invented.
 *
 * The section wrapper is App.tsx's, which labels itself
 * `aria-labelledby={id + '-heading'}`; this component owns the heading that id
 * points at, so both the id and its text arrive as props (the text is the
 * section registry's label, which keeps the nav and the on-page heading from
 * drifting). The document's one <h1> is the hero's, so the top heading here is
 * an <h2>.
 */

import { competencies, technicalSkills } from '../data/resume.ts'
import type { SkillGroup } from '../data/types.ts'

/** A chip: non-interactive today, but already sized as a comfortable tap
 * target (`min-h-8` is 2rem tall, `px-3` is 0.75rem either side) so making one
 * a filter link later is a change of behaviour and not of layout. Text stays
 * at `text-base` — the contract's floor is 1rem. */
const CHIP =
  'inline-flex min-h-8 items-center rounded-pill border border-border bg-surface px-3 text-base text-text'

/** One column per group below `md`, two from `md` and three from `lg`. Widths
 * are the grid's, so a card is never wider than the viewport. */
const GROUP_GRID = 'grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3'

/** The DOM id of a group's heading, which its chip list is `aria-labelledby`.
 * Runs of non-alphanumerics collapse to a single hyphen, so `SIEM/Analytics`
 * becomes `siem-analytics`; the twelve labels are unique across both exports,
 * so the ids are too. */
function groupHeadingId(label: string): string {
  return `skill-group-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
}

/** A titled block of skill groups: `competencies` or `technicalSkills`. */
function SkillGroups({
  title,
  groups,
}: {
  title: string
  groups: SkillGroup[]
}) {
  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-lg font-medium">{title}</h3>

      <div className={GROUP_GRID}>
        {groups.map((group) => {
          const headingId = groupHeadingId(group.label)

          return (
            <div
              key={group.label}
              className="flex flex-col gap-3 rounded-card border border-border p-4"
            >
              <h4 id={headingId} className="text-base font-medium text-muted">
                {group.label}
              </h4>

              {/* `flex-wrap` with a 0.5rem gap: a long group like
                  Specializations takes as many lines as it needs at 320px
                  instead of being clipped or widening the page. */}
              <ul aria-labelledby={headingId} className="flex flex-wrap gap-2">
                {group.items.map((item) => (
                  <li key={item} className={CHIP}>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function SkillsSection({
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

      <SkillGroups title="Core Competencies" groups={competencies} />
      <SkillGroups title="Technical Skills" groups={technicalSkills} />
    </div>
  )
}
