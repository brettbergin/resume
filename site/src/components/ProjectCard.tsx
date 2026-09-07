/*
 * One open source project, as a card that is itself the link to its repo.
 *
 * The card takes its `Project` as a prop rather than reaching into
 * `../data/resume.ts`, the same way ExperienceEntry does: the section owns the
 * ordering, and a test can render this against a fixture.
 *
 * The whole surface is the <a>, not a small "view on GitHub" link tucked in a
 * corner — on a phone the card is the only thing to aim at, so it is the tap
 * target: `flex` + `h-full` so it fills its grid cell whatever the neighbouring
 * cards' text does, and `min-h-11` so even the shortest description leaves a
 * comfortable 44px. There is no fixed height anywhere and no truncation
 * utility, so a long description wraps and grows the card instead of being
 * clipped at 320px.
 *
 * It leaves the site, so it opens in a new tab with `rel="noopener
 * noreferrer"` — the hero's GitHub button is the precedent.
 */

import type { Project } from '../data/types.ts'
import { FOCUS_RING, TAP_TARGET_HEIGHT } from '../styles.ts'

/** The same token vocabulary the achievements and skills cards use, so the
 * three sections read as one system. `h-full` is what squares the cards off in
 * a row once the grid has more than one column. */
const CARD = `flex h-full ${TAP_TARGET_HEIGHT} flex-col gap-2 rounded-card border border-border bg-surface p-4 hover:border-accent ${FOCUS_RING}`

export function ProjectCard({ project }: { project: Project }) {
  return (
    <a
      href={project.url}
      target="_blank"
      rel="noopener noreferrer"
      className={CARD}
    >
      {/* The heading is inside the link, so the project name is what the link
          is announced and listed as; the description follows it as ordinary
          wrapping text. */}
      <h3 className="text-lg font-medium text-accent">{project.name}</h3>

      <p className="text-base text-text">{project.description}</p>
    </a>
  )
}
