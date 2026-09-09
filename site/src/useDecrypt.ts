/*
 * Resolve a string out of noise: the classic decrypt-in effect, as a plain
 * `string` the caller paints. The hook owns the animation and nothing else —
 * *when* it runs is the component's business, which is why `active` comes in
 * from outside rather than being observed here — and it never touches the DOM,
 * so the real text can stay in the document for assistive tech while only the
 * painted glyphs scramble.
 *
 * The frame is derived during render from a single counter rather than pushed
 * into state by the effect: that way the very first render with `active` true
 * already paints noise, with no frame of real text showing through first. The
 * whole run is one `setInterval` rather than a timer per frame, and it settles
 * for good — after the last frame the interval is cleared and the hook returns
 * `text` forever, so a later `active` toggle cannot restart a heading that has
 * already resolved.
 *
 * Motion-aware, mirroring `useTilt.ts`: a reader who asked for reduced motion
 * gets `text` immediately with nothing scheduled at all. The query is read
 * once, up front, with no `change` listener registered — several suites stub
 * `matchMedia` with a single fake object shared by every query, and a hook
 * that subscribed to it would show up in their listener counts.
 */

import { useEffect, useMemo, useState } from 'react'

/** How many frames the resolve takes, and how long each one is shown. */
const FRAME_COUNT = 20
const FRAME_MS = 40

/** What an unresolved character is drawn from. */
const GLYPHS = '!<>-_\\/[]{}—=+*^?#'

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'

function matchesQuery(query: string): boolean {
  return window.matchMedia?.(query)?.matches ?? false
}

function randomGlyph(): string {
  return GLYPHS[Math.floor(Math.random() * GLYPHS.length)]
}

/**
 * One frame: everything left of the cursor has resolved to the real glyph,
 * everything from it rightward is still noise. Length always matches `text`.
 */
function scramble(text: string, progress: number): string {
  const cursor = progress * text.length
  let out = ''
  for (let index = 0; index < text.length; index += 1) {
    out += index < cursor ? text[index] : randomGlyph()
  }
  return out
}

export function useDecrypt(text: string, active: boolean): string {
  // Read once for the lifetime of the hook, like useTilt does.
  const [reduced] = useState(() => matchesQuery(REDUCED_MOTION))
  const [frame, setFrame] = useState(0)
  const [settled, setSettled] = useState(false)

  const running = active && !reduced && !settled

  useEffect(() => {
    if (!running) return

    let painted = 0
    const interval = setInterval(() => {
      painted += 1
      if (painted >= FRAME_COUNT) {
        // Last frame: stop, and hand the real text back for good.
        clearInterval(interval)
        setSettled(true)
        return
      }
      setFrame(painted)
    }, FRAME_MS)

    return () => clearInterval(interval)
  }, [running])

  return useMemo(
    () => (running ? scramble(text, frame / FRAME_COUNT) : text),
    [running, text, frame],
  )
}
