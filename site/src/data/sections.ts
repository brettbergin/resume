/*
 * The page's sections, in the order they appear. Both the header nav and the
 * sections rendered in `App.tsx` read from this one list, so adding an entry
 * here is what makes a section appear in the nav — the hrefs and the DOM ids
 * cannot drift apart because they come from the same `id`.
 *
 * Ids double as anchor fragments (`#skills`), so they stay kebab-case with no
 * leading `#`; the `scroll-margin-top` rule in `index.css` keeps the sticky
 * header from covering a section the nav has just jumped to.
 */

import type { PageSection } from './types.ts'

export const sections: readonly PageSection[] = [
  { id: 'about', label: 'About' },
  { id: 'skills', label: 'Skills' },
  { id: 'experience', label: 'Experience' },
  { id: 'projects', label: 'Projects' },
  { id: 'achievements', label: 'Achievements' },
  { id: 'contact', label: 'Contact' },
] as const
