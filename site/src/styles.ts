/*
 * The two accessibility floors the whole shell shares, as class strings.
 *
 * - A visible focus indicator on every interactive element (WCAG 2.4.7), so a
 *   keyboard user can always see where they are.
 * - A 44x44 CSS-pixel target on every control (WCAG 2.5.5 Target Size), which
 *   is Tailwind's `11` (2.75rem) on the axis the content does not already
 *   size.
 *
 * They live in one module rather than being restated per component so that a
 * single test can assert every control carries them: six private copies of the
 * same string can each drift on their own, and nothing page-wide can check a
 * floor that is only ever written locally. Sibling to theme.ts, which owns the
 * other cross-cutting styling seam.
 *
 * These are plain Tailwind utility names, written out in full — Tailwind v4
 * discovers utilities by scanning source text, so a composed or interpolated
 * class name here would simply not be emitted.
 */

/** The focus ring. Drawn only for keyboard focus (`focus-visible`), so a mouse
 * click on a button does not leave a ring behind. */
export const FOCUS_RING =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

/** A 44x44 tap target, for square controls whose content sizes neither axis:
 * the theme toggle, the menu and close buttons, the header's nav links. */
export const TAP_TARGET = 'min-h-11 min-w-11'

/** A 44px-tall tap target, for controls whose width comes from their content
 * and must stay free to wrap: the footer links, the hero CTAs, a project card,
 * the experience show-more button. A *minimum*, never a height. */
export const TAP_TARGET_HEIGHT = 'min-h-11'
