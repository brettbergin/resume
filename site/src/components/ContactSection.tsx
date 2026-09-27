/*
 * The contact section: every field of the `contact` export, rendered as-is,
 * followed by two "start an inquiry" calls to action.
 *
 * The email and GitHub URL are the two ways to reach out, so they render as
 * links — `mailto:` for the email, an external link for GitHub, matching
 * Footer.tsx's convention (target="_blank" rel="noreferrer" on the external
 * one) and both carrying the shared FOCUS_RING and TAP_TARGET_HEIGHT classes
 * so they meet the page-wide a11y contract. Phone, location and the GPG
 * fingerprint are plain text: the data carries no link or extra formatting
 * for them, so none is invented here.
 *
 * The two CTAs are the same mechanism with a pre-filled subject: a visitor who
 * wants to talk about consulting, or about Lantern, lands in their own mail
 * client with the inquiry already labelled, and the site stays a static build
 * — no form endpoint, no third-party service, nothing to receive a POST. Their
 * copy (labels, subjects, the Lantern blurb) is site chrome rather than resume
 * prose, so it lives here as local constants: test/resume-md-sync.test.ts
 * requires every string in the `contact` export to appear verbatim in
 * resume.md, and this text is not in resume.md and should not be.
 *
 * The section wrapper is App.tsx's, which labels itself
 * `aria-labelledby={id + '-heading'}`; this component owns the heading that
 * id points at, so both the id and its text arrive as props, same as
 * AchievementsSection and ExperienceSection.
 */

import { contact } from '../data/resume.ts'
import { FOCUS_RING, TAP_TARGET_HEIGHT } from '../styles.ts'
import { SectionHeading } from './SectionHeading.tsx'

const LINK = `inline-flex ${TAP_TARGET_HEIGHT} items-center rounded-pill text-accent hover:underline ${FOCUS_RING}`

/** The subject each CTA pre-fills, so an inquiry arrives already sorted. The
 * two differ, which is the whole point: the link text says which one it is and
 * the subject line says it again in the inbox. */
const CONSULTING_SUBJECT = 'Technical consulting inquiry'
const LANTERN_SUBJECT = 'Lantern inquiry'

const LANTERN_DESCRIPTION =
  'Lantern is an app Brett is building; it is still in progress and has not ' +
  'been released yet. Mail is the only way to hear about it for now.'

/** `mailto:` with a pre-filled subject. The subject is encoded because it has
 * spaces, and a raw space in a URL is not one a mail client has to honour. */
function inquiryHref(subject: string): string {
  return `mailto:${contact.email}?subject=${encodeURIComponent(subject)}`
}

export function ContactSection({
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

        <div className="flex flex-col gap-2">
          <dt className="text-sm text-muted">Technical consulting</dt>
          <dd>
            <a href={inquiryHref(CONSULTING_SUBJECT)} className={LINK}>
              Inquire about technical consulting
            </a>
          </dd>
        </div>

        <div className="flex flex-col gap-2">
          <dt className="text-sm text-muted">Lantern</dt>
          <dd className="flex flex-col gap-2">
            <p>{LANTERN_DESCRIPTION}</p>
            <a href={inquiryHref(LANTERN_SUBJECT)} className={LINK}>
              Ask about Lantern
            </a>
          </dd>
        </div>
      </dl>
    </div>
  )
}
