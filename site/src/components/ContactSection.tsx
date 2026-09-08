/*
 * The contact section: every field of the `contact` export, rendered as-is.
 *
 * The email and GitHub URL are the two ways to reach out, so they render as
 * links — `mailto:` for the email, an external link for GitHub, matching
 * Footer.tsx's convention (target="_blank" rel="noreferrer" on the external
 * one) and both carrying the shared FOCUS_RING and TAP_TARGET_HEIGHT classes
 * so they meet the page-wide a11y contract. Phone, location and the GPG
 * fingerprint are plain text: the data carries no link or extra formatting
 * for them, so none is invented here.
 *
 * The section wrapper is App.tsx's, which labels itself
 * `aria-labelledby={id + '-heading'}`; this component owns the heading that
 * id points at, so both the id and its text arrive as props, same as
 * AchievementsSection and ExperienceSection.
 */

import { contact } from '../data/resume.ts'
import { FOCUS_RING, TAP_TARGET_HEIGHT } from '../styles.ts'

const LINK = `inline-flex ${TAP_TARGET_HEIGHT} items-center rounded-pill text-accent hover:underline ${FOCUS_RING}`

export function ContactSection({
  headingId,
  heading,
}: {
  headingId: string
  heading: string
}) {
  return (
    <div className="flex flex-col gap-6">
      <h2 id={headingId} className="glow-text text-2xl font-medium">
        {heading}
      </h2>

      <dl className="flex flex-col gap-4 text-base text-text">
        <div className="flex flex-col gap-2">
          <dt className="text-sm text-muted">Email</dt>
          <dd>
            <a href={`mailto:${contact.email}`} className={LINK}>
              {contact.email}
            </a>
          </dd>
        </div>

        <div className="flex flex-col gap-2">
          <dt className="text-sm text-muted">Phone</dt>
          <dd>{contact.phone}</dd>
        </div>

        <div className="flex flex-col gap-2">
          <dt className="text-sm text-muted">Location</dt>
          <dd>{contact.location}</dd>
        </div>

        <div className="flex flex-col gap-2">
          <dt className="text-sm text-muted">GitHub</dt>
          <dd>
            <a
              href={contact.githubUrl}
              target="_blank"
              rel="noreferrer"
              className={LINK}
            >
              {contact.githubUrl}
            </a>
          </dd>
        </div>

        <div className="flex flex-col gap-2">
          <dt className="text-sm text-muted">GPG Fingerprint</dt>
          <dd className="break-words font-mono text-sm">
            {contact.gpgFingerprint}
          </dd>
        </div>
      </dl>
    </div>
  )
}
