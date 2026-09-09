/*
 * The custom pointer: a small crosshair reticle — a 20px ring with a 4px dot
 * at its centre — painted in place of the OS arrow. The dot tracks the pointer
 * exactly; the ring lags it by a short transform transition, so the two read
 * as one cursor with a little weight to it.
 *
 * Mounted once from App.tsx, outside <main>: it is chrome for the whole
 * document, not part of any section, and both elements are `fixed` and
 * `pointer-events-none` so nothing here is in the layout or in the way of a
 * click — e2e/responsive.spec.ts's no-horizontal-overflow assertion at 320px
 * still holds with the reticle in the document.
 *
 * WHAT IT WRITES, AND WHERE. The transform of each element is written
 * imperatively on `pointermove` rather than held in state: a re-render per
 * pointer event would re-render the whole page. Hover is the one thing that
 * *is* state, because it changes the ring's border colour and that is a class.
 * Both elements are `aria-hidden` — this is paint, with nothing to announce.
 *
 * HIDING THE OS ARROW. The component toggles a `custom-cursor` class on <html>
 * and src/index.css declares one unlayered rule for the root and for `a`,
 * `button` and `[role="button"]`. Those element selectors are not redundant
 * with the root one: Chrome's UA stylesheet declares `cursor: pointer` on
 * `a:-webkit-any-link`, and any declaration on the element beats a value
 * inherited from an ancestor, so `cursor: none` on <html> alone would leave
 * the arrow showing over every link. `button` and `[role="button"]` have no
 * such UA rule and would inherit `none` on their own; they are listed with the
 * anchor because a UA that does declare one should not reintroduce the arrow
 * on exactly the controls the reticle is most visible over. The rule is
 * unlayered so it outranks Tailwind's utility layer, the same trick the
 * reduced-motion block uses.
 *
 * WHEN IT STAYS OUT OF THE WAY. Three queries make it render nothing at all
 * and never touch the class: a touch screen (`(hover: none)`), a coarse
 * pointer, and a reader who asked for reduced motion — a reticle chasing the
 * cursor is movement, and there is no static version of it worth painting.
 * They are read once, up front, with no `change` listener, mirroring
 * src/useTilt.ts: several suites stub `matchMedia` with a single fake object
 * shared by every query and count its listeners.
 *
 * And two conditions suspend it without unmounting, because in both the OS
 * arrow is the correct cursor: while the window is blurred (the reticle would
 * otherwise sit frozen on an inactive window, since no pointer events arrive),
 * and while a full-bleed overlay is in front of the page — Header.tsx's mobile
 * menu and BootSequence.tsx's boot animation. Both are found by watching the
 * document with a MutationObserver for OVERLAY_SELECTOR below, so neither
 * component has to call into this one: the menu's focus trap and close button
 * behave exactly as they did before, and the boot overlay is dismissed with
 * the OS arrow visible to aim.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

/** Any one of these makes the component a no-op. */
const BLOCKING_QUERIES = [
  '(hover: none)',
  '(pointer: coarse)',
  '(prefers-reduced-motion: reduce)',
] as const

/** The class src/index.css hangs its `cursor: none` rule off. */
const ROOT_CLASS = 'custom-cursor'

/** What counts as "hovering something clickable" for the ring's expanded
 * state. Matched with `closest()` rather than on the event target itself, so
 * the icon inside the header's menu button counts as the button. */
const INTERACTIVE_SELECTOR = 'a, button, [role="button"]'

/** A full-bleed overlay in front of the page, over which the OS arrow is the
 * right pointer and the reticle is not. Two of them today, matched
 * differently on purpose: Header.tsx's mobile menu is a real modal dialog,
 * while BootSequence.tsx's overlay is `aria-hidden inert` — not a dialog at
 * all, nothing to operate — so it carries a `data-overlay` attribute for
 * exactly this.
 *
 * Suspending on "an overlay is up" rather than recolouring the reticle is the
 * general fix. The boot overlay is `bg-neutral-900`, and in the light palette
 * `--color-text` is that same `#111827`, so a `border-text` ring and a
 * `bg-text` dot over it are invisible at 1.00:1 while `custom-cursor` has
 * already taken the OS arrow away — a pointerless first load. Any future
 * overlay painted in a fixed palette would reintroduce that state; carrying
 * `data-overlay` keeps it out. */
const OVERLAY_SELECTOR = '[role="dialog"][aria-modal="true"], [data-overlay]'

/** Shared by both elements. `top-0 left-0` puts them at the viewport origin;
 * the transform below does the positioning, including the centring. */
const RETICLE = 'pointer-events-none fixed top-0 left-0 z-50 rounded-full'

/** Where the reticle parks before the first pointer event: off-screen, so it
 * is not sitting in the top-left corner until the pointer moves. */
const OFF_SCREEN = { x: -100, y: -100 }

/** How much bigger the ring gets over something clickable. */
const HOVER_SCALE = 2

function matchesQuery(query: string): boolean {
  return window.matchMedia?.(query)?.matches ?? false
}

export function Cursor() {
  // Read once for the lifetime of the component, like useTilt does.
  const [unsupported] = useState(() => BLOCKING_QUERIES.some(matchesQuery))
  const [blurred, setBlurred] = useState(false)
  const [overlaid, setOverlaid] = useState(false)
  const [hovering, setHovering] = useState(false)

  const ringRef = useRef<HTMLDivElement>(null)
  const dotRef = useRef<HTMLDivElement>(null)
  /* The pointer's last position and the hover state as refs as well as state:
   * the painter below runs on every pointer event and must not depend on a
   * re-render having happened first. */
  const positionRef = useRef(OFF_SCREEN)
  const hoveringRef = useRef(false)

  const active = !unsupported && !blurred && !overlaid

  /* Both transforms, from the current position and hover state. Centring is
   * part of this same transform (`calc(<x>px - 50%)`) rather than a
   * `-translate-*` class, because a class-level transform would simply be
   * overwritten by this inline one. */
  const paint = useCallback(() => {
    const { x, y } = positionRef.current
    const centred = `translate3d(calc(${x}px - 50%), calc(${y}px - 50%), 0)`
    const scale = hoveringRef.current ? HOVER_SCALE : 1

    ringRef.current?.style.setProperty(
      'transform',
      `${centred} scale(${scale})`,
    )
    dotRef.current?.style.setProperty('transform', centred)
  }, [])

  useEffect(() => {
    if (unsupported) return

    const handlePointerMove = (event: PointerEvent) => {
      positionRef.current = { x: event.clientX, y: event.clientY }
      paint()
    }

    const handlePointerOver = (event: PointerEvent) => {
      const target = event.target
      const over =
        target instanceof Element &&
        target.closest(INTERACTIVE_SELECTOR) !== null

      hoveringRef.current = over
      setHovering(over)
      paint()
    }

    const handlePointerOut = (event: PointerEvent) => {
      hoveringRef.current = false
      setHovering(false)

      /* A `pointerout` that reaches the window with no `relatedTarget` is the
       * pointer leaving the document altogether — up into the tab bar or the
       * URL bar, or off the side onto a second monitor. No further
       * `pointermove` arrives, so both elements would otherwise stay painted
       * at the last position inside the viewport, a ring and a dot sitting at
       * the edge of the page with no pointer near them. `blur` does not cover
       * it: the window is still the focused one. Parking off-screen is enough
       * — the OS arrow is the browser's own outside the viewport, and the next
       * real move repaints both. */
      if (event.relatedTarget === null) positionRef.current = OFF_SCREEN

      paint()
    }

    // The window's own focus, not an element's: with no pointer events
    // arriving there is nothing to move the reticle, so the OS arrow takes
    // over until the window is active again.
    const handleBlur = () => setBlurred(true)
    const handleFocus = () => setBlurred(false)

    // Reconciled up front as well as on every mutation, which is the case
    // that matters on first load: the boot overlay is already in the document
    // by the time this effect runs, so the component starts suspended rather
    // than hiding the arrow behind an overlay it cannot be seen against.
    const syncOverlay = () =>
      setOverlaid(document.querySelector(OVERLAY_SELECTOR) !== null)
    syncOverlay()
    const observer = new MutationObserver(syncOverlay)
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      // Both of today's overlays mount and unmount, which `childList` sees.
      // The filter covers the other shape — an element already in the document
      // that gains or drops one of these attributes.
      attributes: true,
      attributeFilter: ['data-overlay', 'role', 'aria-modal'],
    })

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerover', handlePointerOver)
    window.addEventListener('pointerout', handlePointerOut)
    window.addEventListener('blur', handleBlur)
    window.addEventListener('focus', handleFocus)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerover', handlePointerOver)
      window.removeEventListener('pointerout', handlePointerOut)
      window.removeEventListener('blur', handleBlur)
      window.removeEventListener('focus', handleFocus)
      observer.disconnect()
    }
  }, [unsupported, paint])

  // The OS arrow is hidden only while the reticle is actually painted, and
  // the cleanup runs on unmount as well as on every suspension.
  useEffect(() => {
    if (!active) return

    const root = document.documentElement
    root.classList.add(ROOT_CLASS)
    return () => root.classList.remove(ROOT_CLASS)
  }, [active])

  // Coming back from a suspension re-creates both elements, so the position
  // the pointer was last at has to be written to them again.
  useEffect(() => {
    if (!active) return
    paint()
  }, [active, paint])

  if (!active) return null

  return (
    <>
      <div
        ref={ringRef}
        aria-hidden="true"
        /* `reticle-lag` is the transform transition, and the only thing that
           separates the ring from the dot: the dot is written the same
           position in the same tick, carries no transition and moves there
           immediately. The duration is named in src/index.css with the rest of
           the rice's numbers rather than written as an inline style here —
           an inline style would also be out of reach of that file's
           reduced-motion block. */
        className={`${RETICLE} reticle-lag size-5 border ${
          hovering ? 'border-accent' : 'border-text'
        }`}
      />
      <div
        ref={dotRef}
        aria-hidden="true"
        className={`${RETICLE} size-1 bg-text`}
      />
    </>
  )
}
