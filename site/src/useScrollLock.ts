/*
 * Freeze the page behind an overlay. `overflow: hidden` alone is enough on
 * most browsers, but iOS Safari ignores it on <body> and still lets the page
 * rubber-band scroll behind the overlay — pinning the body with
 * `position: fixed` is what actually holds it there. The cleanup runs on
 * close *and* on unmount-while-open, and restores whatever was there before
 * rather than clearing the properties outright, then scrolls back to where
 * the page was so unlocking does not jump it to the top.
 */

import { useEffect } from 'react'

export function useScrollLock(open: boolean): void {
  useEffect(() => {
    if (!open) return
    const scrollY = window.scrollY
    const previousOverflow = document.body.style.overflow
    const previousPosition = document.body.style.position
    const previousTop = document.body.style.top
    const previousWidth = document.body.style.width
    document.body.style.overflow = 'hidden'
    document.body.style.position = 'fixed'
    document.body.style.top = `-${scrollY}px`
    document.body.style.width = '100%'
    return () => {
      document.body.style.overflow = previousOverflow
      document.body.style.position = previousPosition
      document.body.style.top = previousTop
      document.body.style.width = previousWidth
      window.scrollTo(0, scrollY)
    }
  }, [open])
}
