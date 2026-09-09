/*
 * Swing the hero name's weight with the pointer. Like src/useTilt.ts the hook
 * only ever writes a custom property on the element — `--hero-wght` — so the
 * variation axis and the settle-back transition stay in CSS, in index.css's
 * `hero-weight` utility, where the rest of the theme lives. The property is
 * written on the hero *container* and inherited by the <h1> that carries the
 * utility, so a single ref drives the whole hero.
 *
 * Pointer-only and motion-aware, on the same terms as the tilt: a touch screen
 * reports `(hover: none)` and has no cursor to follow, and a reader who asked
 * for reduced motion should not get type that reflows under the pointer. In
 * either case the hook attaches nothing and writes nothing, leaving the name on
 * the rest weight the utility's `var()` default declares. The queries are read
 * once, up front, with no `change` listener registered: several suites stub
 * `matchMedia` with a single fake object shared by every query, and a hook that
 * subscribed to it would show up in their listener counts.
 */

import { useEffect, type RefObject } from 'react'

/** The ends of Inter Variable's `wght` axis this treatment uses: light enough
 * at the left edge to read as hairline display type, heavy enough at the right
 * to read as black, both inside the font's own 100…900 range. */
const MIN_WEIGHT = 300
const MAX_WEIGHT = 800

/** What the property reads when the pointer is not over the hero. Matches the
 * `var(--hero-wght, 600)` default in index.css's `hero-weight`, so the rest
 * state is the same whether the hook has ever run or not. */
const REST_WEIGHT = 600

function matchesQuery(query: string): boolean {
  return window.matchMedia?.(query)?.matches ?? false
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

export function useHeroWeight(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const element = ref.current
    if (!element) return
    if (
      matchesQuery('(hover: none)') ||
      matchesQuery('(prefers-reduced-motion: reduce)')
    ) {
      return
    }

    const handlePointerMove = (event: PointerEvent) => {
      const rect = element.getBoundingClientRect()
      // A zero-width rect (an element still laid out, or jsdom) would make the
      // normalisation divide by zero.
      if (rect.width === 0) return

      // Normalised 0…1 across the box; a pointer captured outside it can read
      // past either end, so clamp before scaling — that clamp is what holds
      // the weight inside the axis range.
      const x = clamp01((event.clientX - rect.left) / rect.width)
      const weight = MIN_WEIGHT + x * (MAX_WEIGHT - MIN_WEIGHT)

      // A whole number: the axis is continuous, but the fractional part is
      // invisible and only makes the inline style unreadable in devtools.
      element.style.setProperty('--hero-wght', `${Math.round(weight)}`)
    }

    const handlePointerLeave = () => {
      element.style.setProperty('--hero-wght', `${REST_WEIGHT}`)
    }

    element.addEventListener('pointermove', handlePointerMove)
    element.addEventListener('pointerleave', handlePointerLeave)
    return () => {
      element.removeEventListener('pointermove', handlePointerMove)
      element.removeEventListener('pointerleave', handlePointerLeave)
    }
  }, [ref])
}
