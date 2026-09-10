/*
 * Tilt a card toward the pointer. The hook only ever writes custom properties
 * on the element — `--tilt-x`/`--tilt-y` for the rotation and
 * `--spec-x`/`--spec-y` for the centre of the specular highlight — so the
 * transform, the gradient and the settle-back transition all stay in CSS
 * where the rest of the theme lives.
 *
 * The move handler never measures. `getBoundingClientRect` forces a style and
 * layout flush, and calling it per pointer sample flushes the writes the
 * previous sample just made, so the box is read once on `pointerenter` and
 * cached; window `resize` and `scroll` refresh it, since both move the card
 * within the viewport the cached rect is relative to.
 *
 * It is pointer-only and motion-aware: a touch screen reports `(hover: none)`
 * and a tilt there would fight the scroll, and a reader who asked for reduced
 * motion should not get a card that moves under the cursor at all. In either
 * case the hook attaches nothing and writes nothing, leaving the element on
 * the rest values its stylesheet declares. The queries are read once, up
 * front, with no `change` listener registered: several suites stub
 * `matchMedia` with a single fake object shared by every query, and a hook
 * that subscribed to it would show up in their listener counts.
 */

import { useEffect, type RefObject } from 'react'

/** How far the card may rotate, in degrees, at the edges of its own box. */
const DEFAULT_MAX_TILT = 8

/** What the four properties read when the pointer is not over the element. */
const REST_VALUES = {
  '--tilt-x': '0deg',
  '--tilt-y': '0deg',
  '--spec-x': '50%',
  '--spec-y': '50%',
} as const

function matchesQuery(query: string): boolean {
  return window.matchMedia?.(query)?.matches ?? false
}

/** Trim the float noise so the inline style stays readable in devtools. */
function round(value: number): number {
  return Math.round(value * 100) / 100
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

export function useTilt(
  ref: RefObject<HTMLElement | null>,
  options?: { max?: number },
): void {
  const max = options?.max ?? DEFAULT_MAX_TILT

  useEffect(() => {
    const element = ref.current
    if (!element) return
    if (
      matchesQuery('(hover: none)') ||
      matchesQuery('(prefers-reduced-motion: reduce)')
    ) {
      return
    }

    let rect: DOMRect | null = null

    const handlePointerEnter = () => {
      rect = element.getBoundingClientRect()
    }

    const updateRect = () => {
      rect = element.getBoundingClientRect()
    }

    const handlePointerMove = (event: PointerEvent) => {
      // No rect means no `pointerenter` has landed yet — unreachable from a
      // real pointer, but a synthesised move must not throw. A zero-sized rect
      // (an element not laid out yet, or jsdom) would divide by zero in the
      // normalisation below.
      if (!rect || rect.width === 0 || rect.height === 0) return

      // Normalised 0…1 across the box; a pointer captured outside it can read
      // past either end, so clamp before scaling.
      const x = clamp01((event.clientX - rect.left) / rect.width)
      const y = clamp01((event.clientY - rect.top) / rect.height)

      // Toward the cursor: pointer right rotates the card about Y, pointer up
      // lifts the top edge, both peaking at `max` on the edges.
      element.style.setProperty('--tilt-x', `${round((x - 0.5) * 2 * max)}deg`)
      element.style.setProperty('--tilt-y', `${round((0.5 - y) * 2 * max)}deg`)
      element.style.setProperty('--spec-x', `${round(x * 100)}%`)
      element.style.setProperty('--spec-y', `${round(y * 100)}%`)
    }

    const handlePointerLeave = () => {
      for (const [property, value] of Object.entries(REST_VALUES)) {
        element.style.setProperty(property, value)
      }
    }

    element.addEventListener('pointerenter', handlePointerEnter)
    element.addEventListener('pointermove', handlePointerMove)
    element.addEventListener('pointerleave', handlePointerLeave)
    window.addEventListener('resize', updateRect)
    window.addEventListener('scroll', updateRect, { passive: true })
    return () => {
      element.removeEventListener('pointerenter', handlePointerEnter)
      element.removeEventListener('pointermove', handlePointerMove)
      element.removeEventListener('pointerleave', handlePointerLeave)
      window.removeEventListener('resize', updateRect)
      window.removeEventListener('scroll', updateRect)
    }
  }, [ref, max])
}
