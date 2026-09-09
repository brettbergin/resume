/*
 * The key achievements section: every bullet of `achievements`, as a card
 * rather than another run of bullets.
 *
 * The experience timeline is already a line of markers and plain <ul> bullets,
 * so these read differently on purpose: each achievement is its own bordered
 * surface, and the ones whose data carries a `metric` lead with that figure as
 * a large accented callout. The callout is a pull-out — `metric` is a verbatim
 * substring of `text`, and the full `text` is rendered underneath on every
 * card, with or without a figure — so nothing in the resume is dropped or
 * reworded, and the callout is `aria-hidden` so a screen reader hears the
 * bullet once instead of twice.
 *
 * Every string here except the callout's own markup is the data's: no
 * percentage, rating, progress bar or count is derived. `resume.md` has none,
 * so any such figure would be invented. The order on the page is the data
 * module's order and nothing else — no sort, reverse, filter or slice.
 *
 * The section wrapper is App.tsx's, which labels itself
 * `aria-labelledby={id + '-heading'}`; this component owns the heading that id
 * points at, so both the id and its text arrive as props (the text is the
 * section registry's label, which keeps the nav and the on-page heading from
 * drifting). The document's one <h1> is the hero's, so the top heading here is
 * an <h2>.
 */

import { useRef } from 'react'

import { achievements } from '../data/resume.ts'
import type { Achievement } from '../data/types.ts'
import { useTilt } from '../useTilt.ts'
import { SectionHeading } from './SectionHeading.tsx'

/** One card per row below `md`, two from `md` and three from `lg`. Widths are
 * the grid's, so a card is never wider than the viewport. */
const CARD_GRID = 'grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3'

/** The same token vocabulary the skills group cards use, so the two sections
 * read as one system. `tilt-card` is the index.css utility that turns the
 * custom properties `useTilt` writes into the rotation and the specular
 * highlight; it declares its own rest values, so a card that never sees a
 * pointer — a phone, reduced motion — renders flat. */
const CARD =
  'tilt-card flex flex-col gap-2 rounded-card border border-border bg-surface p-4'

/** The pulled-out figure: named font-size steps, so it grows on a wide screen
 * and stays at 1.5rem on a phone, and `break-words` so `500,000+ endpoints`
 * wraps inside its card instead of widening the page at 320px. `glow-text`
 * gives the figure the same dark-mode halo the headings carry (and nothing at
 * all in light mode); it is a text-shadow, so it changes no metric's box. */
const METRIC =
  'glow-text break-words text-2xl font-semibold text-accent md:text-3xl'

/** One achievement card. Its own component only because the tilt needs a ref
 * per card and a hook cannot be called in a loop body: the markup is the same
 * `<li>` of the `role="list"` it has always been, and the class string stays
 * this file's `CARD` rather than moving into a shared wrapper. */
function AchievementCard({ achievement }: { achievement: Achievement }) {
  const card = useRef<HTMLLIElement>(null)
  useTilt(card)

  return (
    <li ref={card} className={CARD}>
      {achievement.metric ? (
        // A repeat of words already in the bullet below, so it is
        // decoration to a screen reader.
        <span aria-hidden="true" className={METRIC}>
          {achievement.metric}
        </span>
      ) : null}

      <p className="text-base text-text">{achievement.text}</p>
    </li>
  )
}

export function AchievementsSection({
  headingId,
  heading,
  index,
}: {
  headingId: string
  heading: string
  index: number
}) {
  return (
    <div className="flex flex-col gap-6">
      <SectionHeading id={headingId} index={index}>
        {heading}
      </SectionHeading>

      <ul role="list" className={CARD_GRID}>
        {achievements.map((achievement) => (
          <AchievementCard key={achievement.text} achievement={achievement} />
        ))}
      </ul>
    </div>
  )
}
