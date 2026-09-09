import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useHeroWeight } from './useHeroWeight.ts'

/*
 * The hook only ever writes `--hero-wght`, so every case here reads that one
 * property back off the element's inline style rather than looking for a
 * `font-variation-settings`: the axis itself is index.css's business, in the
 * `hero-weight` utility the <h1> carries.
 *
 * jsdom lays nothing out — `getBoundingClientRect` is all zeros — so the test
 * element carries a stubbed rect, and the hook's own zero-width guard would
 * otherwise swallow every write.
 */

const RECT = { left: 100, top: 50, width: 400, height: 120 }

/** Replace matchMedia with one that answers per query, the way useTilt.test.ts
 * does, so `(hover: none)` and reduced motion can be set independently. Also
 * counts listeners, since the hook must register none. */
function mockMedia(matching: string[] = []) {
  let listenerCount = 0

  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      media: query,
      matches: matching.includes(query),
      addEventListener() {
        listenerCount += 1
      },
      removeEventListener() {
        listenerCount -= 1
      },
    })),
  )

  return { listenerCount: () => listenerCount }
}

/** A detached element with a real rect and a countable listener list. */
function mockElement() {
  const element = document.createElement('div')
  element.getBoundingClientRect = () =>
    ({
      ...RECT,
      right: RECT.left + RECT.width,
      bottom: RECT.top + RECT.height,
      x: RECT.left,
      y: RECT.top,
      toJSON: () => ({}),
    }) as DOMRect

  const listeners = new Map<string, number>()
  const add = element.addEventListener.bind(element)
  const remove = element.removeEventListener.bind(element)
  element.addEventListener = (type: string, ...rest: unknown[]) => {
    listeners.set(type, (listeners.get(type) ?? 0) + 1)
    return (add as (...args: unknown[]) => void)(type, ...rest)
  }
  element.removeEventListener = (type: string, ...rest: unknown[]) => {
    listeners.set(type, (listeners.get(type) ?? 0) - 1)
    return (remove as (...args: unknown[]) => void)(type, ...rest)
  }

  return { element, listenerCount: (type: string) => listeners.get(type) ?? 0 }
}

/** jsdom has no PointerEvent, and clientX/clientY are read-only on the base
 * Event, so dispatch a MouseEvent carrying the coordinates. */
function pointerMove(element: HTMLElement, clientX: number) {
  element.dispatchEvent(
    new MouseEvent('pointermove', {
      clientX,
      clientY: RECT.top + RECT.height / 2,
      bubbles: true,
    }),
  )
}

const weightOf = (element: HTMLElement) =>
  element.style.getPropertyValue('--hero-wght')

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('useHeroWeight', () => {
  it('maps the pointer across the box onto the weight axis', () => {
    mockMedia()
    const { element } = mockElement()

    renderHook(() => useHeroWeight({ current: element }))

    // Left edge: the light end.
    pointerMove(element, RECT.left)
    expect(weightOf(element)).toBe('300')

    // Halfway across: halfway up the axis.
    pointerMove(element, RECT.left + RECT.width / 2)
    expect(weightOf(element)).toBe('550')

    // Right edge: the heavy end.
    pointerMove(element, RECT.left + RECT.width)
    expect(weightOf(element)).toBe('800')
  })

  it('clamps coordinates outside the box to the ends of the axis', () => {
    mockMedia()
    const { element } = mockElement()

    renderHook(() => useHeroWeight({ current: element }))

    // A pointer captured outside the hero reads past either end; the axis
    // stops at 300 and 800 rather than following it out.
    pointerMove(element, RECT.left - 5000)
    expect(weightOf(element)).toBe('300')

    pointerMove(element, RECT.left + RECT.width + 5000)
    expect(weightOf(element)).toBe('800')
  })

  it('writes only --hero-wght', () => {
    mockMedia()
    const { element } = mockElement()

    renderHook(() => useHeroWeight({ current: element }))
    pointerMove(element, RECT.left + 100)

    // The whole treatment is one custom property; the axis and the transition
    // are index.css's.
    expect(element.getAttribute('style')).toBe('--hero-wght: 425;')
  })

  it('returns to the rest weight on pointerleave', () => {
    mockMedia()
    const { element } = mockElement()

    renderHook(() => useHeroWeight({ current: element }))

    pointerMove(element, RECT.left + RECT.width)
    expect(weightOf(element)).not.toBe('600')

    element.dispatchEvent(new MouseEvent('pointerleave'))

    // The same value index.css declares as the `var(--hero-wght, 600)`
    // default, so leaving the hero is indistinguishable from never having
    // entered it.
    expect(weightOf(element)).toBe('600')
  })

  it('skips a zero-width rect rather than dividing by it', () => {
    mockMedia()
    const element = document.createElement('div')

    renderHook(() => useHeroWeight({ current: element }))

    // jsdom's own all-zero rect: no layout, so nothing to map onto.
    pointerMove(element, 200)
    expect(weightOf(element)).toBe('')
  })

  it.each(['(hover: none)', '(prefers-reduced-motion: reduce)'])(
    'attaches nothing and writes nothing when %s matches',
    (query) => {
      const media = mockMedia([query])
      const { element, listenerCount } = mockElement()

      renderHook(() => useHeroWeight({ current: element }))

      expect(listenerCount('pointermove')).toBe(0)
      expect(listenerCount('pointerleave')).toBe(0)

      pointerMove(element, RECT.left + 200)
      element.dispatchEvent(new MouseEvent('pointerleave'))

      // Left on the utility's own default weight, never written at all.
      expect(weightOf(element)).toBe('')
      // Suites elsewhere stub matchMedia with one shared object and count its
      // listeners; the hook must not add to that.
      expect(media.listenerCount()).toBe(0)
    },
  )

  it('removes both listeners on unmount', () => {
    mockMedia()
    const { element, listenerCount } = mockElement()

    const { unmount } = renderHook(() => useHeroWeight({ current: element }))
    expect(listenerCount('pointermove')).toBe(1)
    expect(listenerCount('pointerleave')).toBe(1)

    unmount()

    expect(listenerCount('pointermove')).toBe(0)
    expect(listenerCount('pointerleave')).toBe(0)

    element.style.removeProperty('--hero-wght')
    pointerMove(element, RECT.left + 200)
    expect(weightOf(element)).toBe('')
  })

  it('does nothing when the ref is empty', () => {
    mockMedia()

    expect(() => renderHook(() => useHeroWeight({ current: null }))).not.toThrow()
  })
})
