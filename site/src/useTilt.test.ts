import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useTilt } from './useTilt.ts'

/*
 * The hook only ever writes custom properties, so every case here reads them
 * back off the element's inline style rather than looking for a transform:
 * the transform itself is index.css's business.
 *
 * jsdom lays nothing out — `getBoundingClientRect` is all zeros — so the test
 * element carries a stubbed rect, and the hook's own zero-size guard would
 * otherwise swallow every write.
 *
 * The hook caches that rect on `pointerenter`, so every case that expects a
 * write enters the element first, the way a real pointer would.
 */

const RECT = { left: 100, top: 50, width: 200, height: 100 }

/** Replace matchMedia with one that answers per query, the way theme.test.ts
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

/** A detached element with a real rect and a countable listener list. The rect
 * is swappable, so a test can move the element the way a scroll would. */
function mockElement() {
  const element = document.createElement('div')
  let rect = RECT
  element.getBoundingClientRect = () =>
    ({
      ...rect,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      x: rect.left,
      y: rect.top,
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

  return {
    element,
    setRect: (next: typeof RECT) => {
      rect = next
    },
    listenerCount: (type: string) => listeners.get(type) ?? 0,
  }
}

/** jsdom has no PointerEvent, and clientX/clientY are read-only on the base
 * Event, so dispatch a MouseEvent carrying the coordinates. */
function pointerMove(element: HTMLElement, clientX: number, clientY: number) {
  element.dispatchEvent(
    new MouseEvent('pointermove', { clientX, clientY, bubbles: true }),
  )
}

/** What tells the hook to measure the element. */
function pointerEnter(element: HTMLElement) {
  element.dispatchEvent(new MouseEvent('pointerenter', { bubbles: true }))
}

function readProperties(element: HTMLElement) {
  return {
    '--tilt-x': element.style.getPropertyValue('--tilt-x'),
    '--tilt-y': element.style.getPropertyValue('--tilt-y'),
    '--spec-x': element.style.getPropertyValue('--spec-x'),
    '--spec-y': element.style.getPropertyValue('--spec-y'),
  }
}

const REST = {
  '--tilt-x': '0deg',
  '--tilt-y': '0deg',
  '--spec-x': '50%',
  '--spec-y': '50%',
}

const NOTHING_WRITTEN = {
  '--tilt-x': '',
  '--tilt-y': '',
  '--spec-x': '',
  '--spec-y': '',
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('useTilt', () => {
  it('writes all four properties on pointermove', () => {
    mockMedia()
    const { element } = mockElement()

    renderHook(() => useTilt({ current: element }))

    // Three quarters across, one quarter down.
    pointerEnter(element)
    pointerMove(element, RECT.left + 150, RECT.top + 25)

    expect(readProperties(element)).toEqual({
      '--tilt-x': '4deg',
      '--tilt-y': '4deg',
      '--spec-x': '75%',
      '--spec-y': '25%',
    })
  })

  it('tilts toward the pointer and never past max', () => {
    mockMedia()
    const { element } = mockElement()

    renderHook(() => useTilt({ current: element }, { max: 12 }))
    pointerEnter(element)

    // Bottom-left corner: rotation is negative on both axes and saturated.
    pointerMove(element, RECT.left, RECT.top + RECT.height)
    expect(readProperties(element)).toEqual({
      '--tilt-x': '-12deg',
      '--tilt-y': '-12deg',
      '--spec-x': '0%',
      '--spec-y': '100%',
    })

    // Well outside the box, and still bounded by max.
    pointerMove(element, RECT.left + 5000, RECT.top - 5000)
    expect(readProperties(element)).toEqual({
      '--tilt-x': '12deg',
      '--tilt-y': '12deg',
      '--spec-x': '100%',
      '--spec-y': '0%',
    })

    // Dead centre is the rest rotation.
    pointerMove(element, RECT.left + RECT.width / 2, RECT.top + RECT.height / 2)
    expect(readProperties(element)).toEqual(REST)
  })

  it('resets the properties on pointerleave', () => {
    mockMedia()
    const { element } = mockElement()

    renderHook(() => useTilt({ current: element }))

    pointerEnter(element)
    pointerMove(element, RECT.left + 200, RECT.top)
    expect(readProperties(element)).not.toEqual(REST)

    element.dispatchEvent(new MouseEvent('pointerleave'))

    expect(readProperties(element)).toEqual(REST)
  })

  it.each(['(hover: none)', '(prefers-reduced-motion: reduce)'])(
    'attaches nothing and writes nothing when %s matches',
    (query) => {
      const media = mockMedia([query])
      const { element, listenerCount } = mockElement()

      renderHook(() => useTilt({ current: element }))

      expect(listenerCount('pointerenter')).toBe(0)
      expect(listenerCount('pointermove')).toBe(0)
      expect(listenerCount('pointerleave')).toBe(0)

      pointerEnter(element)
      pointerMove(element, RECT.left + 200, RECT.top)
      element.dispatchEvent(new MouseEvent('pointerleave'))

      expect(readProperties(element)).toEqual(NOTHING_WRITTEN)
      // Suites elsewhere stub matchMedia with one shared object and count its
      // listeners; the hook must not add to that.
      expect(media.listenerCount()).toBe(0)
    },
  )

  it('writes nothing on a pointermove that no pointerenter preceded', () => {
    mockMedia()
    const { element } = mockElement()

    renderHook(() => useTilt({ current: element }))

    pointerMove(element, RECT.left + 150, RECT.top + 25)

    expect(readProperties(element)).toEqual(NOTHING_WRITTEN)
  })

  it('calls getBoundingClientRect once on pointerenter, never on pointermove', () => {
    mockMedia()
    const { element } = mockElement()
    const measure = vi.spyOn(element, 'getBoundingClientRect')

    renderHook(() => useTilt({ current: element }))

    pointerEnter(element)
    for (const offset of [10, 20, 30]) {
      pointerMove(element, RECT.left + offset, RECT.top + offset)
    }

    // The whole point of the cache: the moves read the box the enter measured
    // rather than forcing a layout flush each sample.
    expect(measure).toHaveBeenCalledTimes(1)
  })

  it.each(['resize', 'scroll'])(
    're-measures the element on window %s',
    (type) => {
      mockMedia()
      const { element, setRect } = mockElement()

      renderHook(() => useTilt({ current: element }))
      pointerEnter(element)

      // The card slides 300px up the viewport; the same client coordinate is
      // now the bottom-right corner rather than the centre.
      setRect({ ...RECT, top: RECT.top - 300 })
      window.dispatchEvent(new Event(type))

      pointerMove(element, RECT.left + RECT.width, RECT.top + RECT.height - 300)
      expect(readProperties(element)).toEqual({
        '--tilt-x': '8deg',
        '--tilt-y': '-8deg',
        '--spec-x': '100%',
        '--spec-y': '100%',
      })
    },
  )

  it('removes every listener on unmount', () => {
    mockMedia()
    const { element, listenerCount } = mockElement()
    const removeFromWindow = vi.spyOn(window, 'removeEventListener')

    const { unmount } = renderHook(() => useTilt({ current: element }))
    expect(listenerCount('pointerenter')).toBe(1)
    expect(listenerCount('pointermove')).toBe(1)
    expect(listenerCount('pointerleave')).toBe(1)

    unmount()

    expect(listenerCount('pointerenter')).toBe(0)
    expect(listenerCount('pointermove')).toBe(0)
    expect(listenerCount('pointerleave')).toBe(0)
    for (const type of ['resize', 'scroll']) {
      expect(removeFromWindow).toHaveBeenCalledWith(type, expect.any(Function))
    }

    element.style.removeProperty('--tilt-x')
    pointerMove(element, RECT.left + 200, RECT.top)
    expect(element.style.getPropertyValue('--tilt-x')).toBe('')
  })

  it('does nothing when the ref is empty', () => {
    mockMedia()

    expect(() => renderHook(() => useTilt({ current: null }))).not.toThrow()
  })
})
