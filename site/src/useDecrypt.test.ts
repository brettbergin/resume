import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useDecrypt } from './useDecrypt.ts'

/*
 * The hook returns a string and schedules one interval, so every case here
 * either reads the returned value back or counts the timers vitest knows
 * about: `vi.getTimerCount()` is what proves the guarded paths schedule
 * nothing at all rather than scheduling a run that happens to do nothing.
 *
 * TEXT deliberately shares no character with the hook's glyph set, so any
 * scrambled position is visibly different from the real one.
 */

const TEXT = 'Experience'
const FRAME_MS = 40
const FRAME_COUNT = 20

/** Replace matchMedia with one that answers per query, the way useTilt.test.ts
 * does, so reduced motion can be set independently. Also counts listeners,
 * since the hook must register none. */
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

/** Run the animation to the end, collecting what was painted on the way. */
function collectFrames(read: () => string): string[] {
  const frames = [read()]
  for (let tick = 0; tick <= FRAME_COUNT; tick += 1) {
    act(() => {
      vi.advanceTimersByTime(FRAME_MS)
    })
    frames.push(read())
  }
  return frames
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('useDecrypt', () => {
  it('returns the text verbatim and schedules nothing while inactive', () => {
    mockMedia()

    const { result } = renderHook(() => useDecrypt(TEXT, false))

    expect(result.current).toBe(TEXT)
    expect(vi.getTimerCount()).toBe(0)

    act(() => {
      vi.advanceTimersByTime(10 * FRAME_COUNT * FRAME_MS)
    })
    expect(result.current).toBe(TEXT)
  })

  it('scrambles every frame at full length and settles on the text', () => {
    mockMedia()

    const { result, rerender } = renderHook(
      ({ active }: { active: boolean }) => useDecrypt(TEXT, active),
      { initialProps: { active: false } },
    )

    rerender({ active: true })

    const frames = collectFrames(() => result.current)

    for (const frame of frames) {
      expect(frame).toHaveLength(TEXT.length)
    }
    expect(frames.some((frame) => frame !== TEXT)).toBe(true)
    expect(frames.at(-1)).toBe(TEXT)
    // Settled for good: the interval is gone and nothing repaints.
    expect(vi.getTimerCount()).toBe(0)
  })

  it('resolves left to right', () => {
    mockMedia()

    const { result } = renderHook(() => useDecrypt(TEXT, true))

    // Halfway through, the left half reads true and the whole string still
    // matches the real text in length.
    act(() => {
      vi.advanceTimersByTime((FRAME_COUNT / 2) * FRAME_MS)
    })

    expect(result.current).toHaveLength(TEXT.length)
    expect(result.current.slice(0, TEXT.length / 2)).toBe(
      TEXT.slice(0, TEXT.length / 2),
    )
    expect(result.current).not.toBe(TEXT)
  })

  it('does not restart once it has settled', () => {
    mockMedia()

    const { result, rerender } = renderHook(
      ({ active }: { active: boolean }) => useDecrypt(TEXT, active),
      { initialProps: { active: true } },
    )

    act(() => {
      vi.advanceTimersByTime((FRAME_COUNT + 1) * FRAME_MS)
    })
    expect(result.current).toBe(TEXT)

    rerender({ active: false })
    rerender({ active: true })

    expect(vi.getTimerCount()).toBe(0)
    expect(result.current).toBe(TEXT)
  })

  it('returns the text immediately under reduced motion', () => {
    const media = mockMedia(['(prefers-reduced-motion: reduce)'])

    const { result } = renderHook(() => useDecrypt(TEXT, true))

    expect(result.current).toBe(TEXT)
    expect(vi.getTimerCount()).toBe(0)
    // Suites elsewhere stub matchMedia with one shared object and count its
    // listeners; the hook must not add to that.
    expect(media.listenerCount()).toBe(0)
  })

  it('clears the interval on unmount mid-animation', () => {
    mockMedia()

    const { result, unmount } = renderHook(() => useDecrypt(TEXT, true))

    act(() => {
      vi.advanceTimersByTime(2 * FRAME_MS)
    })
    const painted = result.current
    expect(painted).not.toBe(TEXT)

    unmount()
    expect(vi.getTimerCount()).toBe(0)

    // No further updates: advancing past the whole run leaves the last value
    // alone, and React logs no update-after-unmount warning.
    act(() => {
      vi.advanceTimersByTime(10 * FRAME_COUNT * FRAME_MS)
    })
    expect(result.current).toBe(painted)
  })
})
