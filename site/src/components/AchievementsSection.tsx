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

import { achievements } from '../data/resume.ts'

/** One card per row below `md`, two from `md` and three from `lg`. Widths are
 * the grid's, so a card is never wider than the viewport. */
const CARD_GRID = 'grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3'

/** The same token vocabulary the skills group cards use, so the two sections
 * read as one system. */
const CARD =
  'flex flex-col gap-2 rounded-card border border-border bg-surface p-4'

/** The pulled-out figure: named font-size steps, so it grows on a wide screen
 * and stays at 1.5rem on a phone, and `break-words` so `500,000+ endpoints`
 * wraps inside its card instead of widening the page at 320px. */
const METRIC = 'break-words text-2xl font-semibold text-accent md:text-3xl'

export function AchievementsSection({
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

      <ul role="list" className={CARD_GRID}>
        {achievements.map((achievement) => (
          <li key={achievement.text} className={CARD}>
            {achievement.metric ? (
              // A repeat of words already in the bullet below, so it is
              // decoration to a screen reader.
              <span aria-hidden="true" className={METRIC}>
                {achievement.metric}
              </span>
            ) : null}

            <p className="text-base text-text">{achievement.text}</p>
          </li>
        ))}
      </ul>
    </div>
  )
}
