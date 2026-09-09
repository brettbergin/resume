/*
 * The heading every filled-in section renders: the registry's label, prefixed
 * with its position in the nav (`02 /`) and resolved out of noise the first
 * time it scrolls into view.
 *
 * WHY ONE COMPONENT RATHER THAN FIVE COPIES. The five sections used to write
 * the same `<h2 id={headingId} className="glow-text text-2xl font-medium">`
 * each; the number in front of it is the one part that cannot be derived from
 * inside a section, so it arrives as `index` from App.tsx, which reads it off
 * the section's place in `src/data/sections.ts`. Numbering and nav order are
 * therefore the same list, and cannot drift. About is position 1 and is the
 * hero — an <h1> with no prefix — so the numbered headings run 02 to 06.
 *
 * WHAT ASSISTIVE TECH SEES. Three spans, and only one of them is announced:
 * the prefix and the scrambling copy are both `aria-hidden`, and an `sr-only`
 * span holds the real label. So the <h2>'s accessible name is exactly the
 * label whatever frame the animation is on, the DOM always contains the true
 * string, and the `aria-labelledby` on App.tsx's <section> wrapper still
 * resolves to it. Only the painted glyphs ever scramble.
 *
 * WHAT A SELECTION GETS. `sr-only` clips its span rather than hiding it, so
 * without `select-none` on the two painted spans a reader who selected a
 * heading and copied it would get the label twice over — `05 / Achievements`
 * followed by `Achievements` — and so would anything reading `textContent`.
 * The two spans nobody should copy are excluded from the selection, leaving
 * the `sr-only` copy as the one selectable string: the label, once.
 *
 * WHEN IT SCRAMBLES. An IntersectionObserver at `threshold: 0.5` — half the
 * heading on screen — firing once and unobserving, so a heading that has
 * resolved stays resolved on the way back up. Two cases install no observer at
 * all and paint the label as-is: a reader who asked for reduced motion, and an
 * environment without IntersectionObserver (jsdom, where the shell suites
 * render the whole page and stub no observer).
 */

import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'

import { useDecrypt } from '../useDecrypt.ts'

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'

/** Half the heading on screen. Low enough that a heading arriving under the
 * sticky header still triggers, high enough that it is genuinely being read. */
const THRESHOLD = 0.5

function matchesQuery(query: string): boolean {
  return window.matchMedia?.(query)?.matches ?? false
}

/**
 * True from the first moment `element` is at least half visible, and true for
 * good after that: the observer stops watching on the first hit, so this is a
 * one-way latch rather than a visibility flag.
 */
function useInView(element: RefObject<HTMLElement | null>): boolean {
  const [inView, setInView] = useState(false)

  useEffect(() => {
    const target = element.current
    if (target === null) return
    // Both skips leave `inView` false, which is what paints the real label.
    if (matchesQuery(REDUCED_MOTION)) return
    if (typeof IntersectionObserver === 'undefined') return

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          observer.unobserve(entry.target)
          setInView(true)
        }
      },
      { threshold: THRESHOLD },
    )

    observer.observe(target)

    return () => observer.disconnect()
  }, [element])

  return inView
}

export function SectionHeading({
  id,
  index,
  children,
}: {
  id: string
  index: number
  children: string
}) {
  const heading = useRef<HTMLHeadingElement>(null)
  const painted = useDecrypt(children, useInView(heading))

  return (
    <h2 ref={heading} id={id} className="glow-text text-2xl font-medium">
      <span aria-hidden="true" className="font-mono text-accent select-none">
        {String(index).padStart(2, '0')} /
      </span>{' '}
      <span aria-hidden="true" className="select-none">
        {painted}
      </span>
      <span className="sr-only">{children}</span>
    </h2>
  )
}
