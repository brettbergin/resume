/*
 * The page footer: the two public ways to make contact, plus a note on what
 * the site is built with.
 *
 * Both links come from the `contact` export, so the footer and the resume
 * data can never disagree. `contact.phone` and `contact.gpgFingerprint` are
 * deliberately left out: this is a public page, and the issue asks for email
 * and GitHub only.
 */

import { contact } from '../data/resume.ts'
import { FOCUS_RING, TAP_TARGET_HEIGHT } from '../styles.ts'

/** Width is left to the content so the links can wrap. */
const LINK = `inline-flex ${TAP_TARGET_HEIGHT} items-center gap-2 rounded-pill text-sm text-accent hover:underline ${FOCUS_RING}`

export function Footer() {
  return (
    <footer className="mt-auto border-t border-border">
      <div className="mx-auto flex max-w-5xl flex-col gap-2 px-4 py-6 sm:flex-row sm:items-center sm:justify-between sm:gap-6 md:px-8">
        {/* Column on narrow screens, row from `sm` up — the links wrap rather
            than forcing the footer wider than the viewport.

            A list, not a navigation landmark: these are contact details — a
            mailto and an external profile — not a way of getting around the
            site, and a second landmark makes a screen-reader user choose
            between two "navigation"s when only one of them navigates. The
            header's primary nav is the page's only one; src/a11y.test.tsx
            asserts that count. */}
        <ul className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-6">
          <li>
            <a href={`mailto:${contact.email}`} className={LINK}>
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
          </li>

          <li>
            <a
              href={contact.githubUrl}
              target="_blank"
              rel="noreferrer"
              className={LINK}
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
          </li>
        </ul>

        <p className="text-sm text-muted">Built with React + TypeScript</p>
      </div>
    </footer>
  )
}
