/*
 * The open source projects section: every entry of `projects` as a card
 * linking out to its GitHub repo.
 *
 * The order on the page is the data module's order and nothing else — no sort,
 * reverse, filter or slice — and no name, description or URL is written here:
 * a card's every string is its `Project`'s, so the section cannot drift from
 * `resume.ts`.
 *
 * The section wrapper is App.tsx's, which labels itself
 * `aria-labelledby={id + '-heading'}`; this component owns the heading that id
 * points at, so both the id and its text arrive as props (the text is the
 * section registry's label, which keeps the nav and the on-page heading from
 * drifting). The document's one <h1> is the hero's, so the top heading here is
 * an <h2>.
 */

import { projects } from '../data/resume.ts'
import { ProjectCard } from './ProjectCard.tsx'

/** One card per row below `md`, two from `md` and three from `lg` — the same
 * grid the achievements cards use. Widths are the grid's, so a card is never
 * wider than the viewport. */
const CARD_GRID = 'grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3'

export function ProjectsSection({
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

      <ul className={CARD_GRID}>
        {projects.map((project) => (
          /* The list item is the grid cell and stretches to the row's height;
             the card is a block inside it and `h-full` is what fills it. */
          <li key={project.url}>
            <ProjectCard project={project} />
          </li>
        ))}
      </ul>
    </div>
  )
}
