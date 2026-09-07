/*
 * The hero: who this is, what they do, where they are, the professional
 * summary, and the three ways to act on it.
 *
 * Every string of resume content comes from the `summary` and `contact`
 * exports — only the button labels are written here, the same way the footer
 * writes its own. The section wrapper is App.tsx's, which labels itself
 * `aria-labelledby={id + '-heading'}`; the hero owns the heading that id
 * points at, so the id arrives as a prop rather than being built here. That
 * heading is the document's one and only <h1> (the header's wordmark is a
 * <span>).
 *
 * The download href is joined to `import.meta.env.BASE_URL` because the site
 * is served from a project page under /resume/ — a hand-written '/resume.pdf'
 * would 404 there.
 */

import { contact, summary } from '../data/resume.ts'

/** Shared with every interactive element so keyboard users can always see
 * where they are. Matches the header's and the footer's ring. */
const FOCUS_RING =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

/** A 44px-tall tap target (Tailwind's 11 = 2.75rem), the minimum comfortable
 * touch size. Full width below `sm`, where the buttons are stacked, and
 * content width once they sit in a row. */
const CTA = `inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-pill px-4 text-base sm:w-auto ${FOCUS_RING}`

const PRIMARY_CTA = `${CTA} bg-accent font-medium text-accent-contrast hover:opacity-90`

const SECONDARY_CTA = `${CTA} border border-border text-text hover:border-accent hover:text-accent`

export function HeroSection({ headingId }: { headingId: string }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 id={headingId} className="text-3xl font-semibold md:text-4xl">
          {summary.name}
        </h1>
        <p className="text-lg text-accent md:text-xl">{summary.title}</p>
        <p className="text-base text-muted">{contact.location}</p>
      </div>

      {/* `max-w-prose` keeps the paragraph at a readable measure on a wide
          screen; it is a relative width, so at 375px it is simply the column
          and the text wraps normally. */}
      <p className="max-w-prose text-base text-text">
        {summary.professionalSummary}
      </p>

      {/* Column of full-width buttons on a phone, row of content-width ones
          from `sm` up. `gap-3` (12px), not less: these are 44px tap targets
          stacked directly on top of each other. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <a
          href={`${import.meta.env.BASE_URL}${summary.resumePdfFileName}`}
          download
          className={PRIMARY_CTA}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="size-4 shrink-0"
          >
            <path d="M10 3v9m0 0 3.5-3.5M10 12 6.5 8.5" />
            <path d="M3.5 14.5v1a1.5 1.5 0 0 0 1.5 1.5h10a1.5 1.5 0 0 0 1.5-1.5v-1" />
          </svg>
          Download PDF
        </a>

        <a
          href={contact.githubUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={SECONDARY_CTA}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="size-4 shrink-0"
          >
            <path d="M10 1.5a8.5 8.5 0 0 0-2.69 16.56c.43.08.58-.18.58-.41v-1.6c-2.36.51-2.86-1.01-2.86-1.01-.39-.98-.95-1.24-.95-1.24-.78-.53.06-.52.06-.52.86.06 1.31.88 1.31.88.76 1.31 2 .93 2.49.71.08-.55.3-.93.54-1.15-1.89-.21-3.87-.94-3.87-4.19 0-.93.33-1.68.88-2.28-.09-.21-.38-1.08.08-2.24 0 0 .71-.23 2.34.87a8.1 8.1 0 0 1 4.26 0c1.63-1.1 2.34-.87 2.34-.87.46 1.16.17 2.03.08 2.24.55.6.88 1.35.88 2.28 0 3.26-1.99 3.98-3.88 4.19.31.26.58.78.58 1.57v2.33c0 .23.15.5.58.41A8.5 8.5 0 0 0 10 1.5Z" />
          </svg>
          GitHub
        </a>

        <a href={`mailto:${contact.email}`} className={SECONDARY_CTA}>
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="size-4 shrink-0"
          >
            <rect x="2.5" y="4.5" width="15" height="11" rx="2" />
            <path d="M3 6l7 5 7-5" />
          </svg>
          Email
        </a>
      </div>
    </div>
  )
}
