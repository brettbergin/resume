import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SectionHeading } from './SectionHeading.tsx'

/*
 * Two halves, and the split matters.
 *
 * The first is what the heading *is* regardless of animation: an <h2> keeping
 * the id its section wrapper is labelled by, an aria-hidden `NN /` prefix, and
 * an accessible name that is exactly the label. jsdom implements no
 * IntersectionObserver, so those cases run through the component's own
 * no-observer path — which is also the path src/App.test.tsx and
 * src/a11y.test.tsx take when they render the whole page.
 *
 * The second half needs an observer, so it installs a fake one that hands back
 * its callback: the point is not that a browser calls it at the right scroll
 * position (jsdom cannot scroll and would not lay the heading out anyway) but
 * that one intersecting entry starts the scramble, that the scramble never
 * changes the string's length or what a screen reader is told, that it settles
 * on the label, and that the heading is unobserved so it cannot restart.
 */

const LABEL = 'Achievements'
const HEADING_ID = 'achievements-heading'

/** The whole `<h2>`, however its inner spans are arranged. */
function heading(): HTMLElement {
  return screen.getByRole('heading', { level: 2 })
}

/** What is actually painted: the heading's text with the `sr-only` copy taken
 * out, which is what a sighted reader sees and what the animation moves. The
 * clone keeps the separator between the prefix and the label, so the string
 * compared below is the one that would be on screen. */
function paintedText(): string {
  const clone = heading().cloneNode(true) as HTMLElement
  clone.querySelector('.sr-only')?.remove()
  return clone.textContent ?? ''
}

/** Everything the `sr-only` span holds — the string assistive tech reads. */
function announcedText(): string {
  return heading().querySelector('.sr-only')?.textContent ?? ''
}

function stubMatchMedia(matches: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      media: query,
      matches,
      addEventListener() {},
      removeEventListener() {},
    })),
  )
}

beforeEach(() => {
  // The default across the suite: motion allowed. Individual cases override.
  stubMatchMedia(false)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('SectionHeading structure', () => {
  it('keeps the id its section wrapper is labelled by, on the h2 itself', () => {
    render(
      <SectionHeading id={HEADING_ID} index={5}>
        {LABEL}
      </SectionHeading>,
    )

    // App.tsx's <section aria-labelledby="achievements-heading"> resolves here
    // and nowhere else.
    expect(heading().id).toBe(HEADING_ID)
    expect(document.getElementById(HEADING_ID)).toBe(heading())
  })

  it('paints the section number from `index`, zero-padded, and hides it', () => {
    render(
      <SectionHeading id={HEADING_ID} index={5}>
        {LABEL}
      </SectionHeading>,
    )

    const prefix = screen.getByText('05 /')

    expect(prefix.getAttribute('aria-hidden')).toBe('true')
    // Mono and accent: the prefix is the one part of the heading in the
    // terminal typeface, and the accent is what makes it read as a marker.
    expect(prefix.className.split(/\s+/)).toEqual(
      expect.arrayContaining(['font-mono', 'text-accent']),
    )
  })

  it('numbers past nine without padding, so a tenth section still reads right', () => {
    render(
      <SectionHeading id={HEADING_ID} index={12}>
        {LABEL}
      </SectionHeading>,
    )

    expect(screen.getByText('12 /')).toBeDefined()
  })

  it('names itself with the label alone — no number, no painted copy', () => {
    render(
      <SectionHeading id={HEADING_ID} index={5}>
        {LABEL}
      </SectionHeading>,
    )

    // The prefix and the scrambling span are both aria-hidden, so the name
    // computation sees only the sr-only span.
    expect(heading()).toBe(
      screen.getByRole('heading', { level: 2, name: LABEL }),
    )
  })

  it('keeps the real label in the DOM in an sr-only span', () => {
    render(
      <SectionHeading id={HEADING_ID} index={5}>
        {LABEL}
      </SectionHeading>,
    )

    expect(announcedText()).toBe(LABEL)
  })

  it('leaves a selection exactly one copy of the label to take', () => {
    /* `sr-only` clips its span rather than hiding it, so all three spans are
     * in the selection and in the copy buffer unless something says
     * otherwise: copying the heading would hand back `05 /
     * AchievementsAchievements`. The two painted spans are the ones nobody
     * should copy, so they carry `select-none` and the `sr-only` copy is what
     * is left selectable. jsdom implements no selection model and applies no
     * stylesheet, so this is the class list — the behaviour itself is a
     * browser check in site/README.md. */
    render(
      <SectionHeading id={HEADING_ID} index={5}>
        {LABEL}
      </SectionHeading>,
    )

    const spans = [...heading().querySelectorAll('span')]
    const selectable = spans.filter(
      (span) => !span.className.split(/\s+/).includes('select-none'),
    )

    expect(spans.length).toBe(3)
    expect(selectable.map((span) => span.textContent)).toEqual([LABEL])
    // And the one still selectable is the sr-only copy, not a painted span.
    expect(selectable[0]?.className.split(/\s+/)).toContain('sr-only')
  })

  it('carries glow-text, so the halo treatment has no exception', () => {
    render(
      <SectionHeading id={HEADING_ID} index={5}>
        {LABEL}
      </SectionHeading>,
    )

    expect(heading().className.split(/\s+/)).toContain('glow-text')
  })
})

describe('SectionHeading without an IntersectionObserver', () => {
  it('paints the label as-is and never scrambles', () => {
    // jsdom implements none, which is the state under test: the shell suites
    // render the whole page and stub no observer.
    expect(typeof IntersectionObserver).toBe('undefined')

    render(
      <SectionHeading id={HEADING_ID} index={5}>
        {LABEL}
      </SectionHeading>,
    )

    expect(paintedText()).toBe(`05 / ${LABEL}`)
  })
})

describe('SectionHeading under reduced motion', () => {
  it('installs no observer and paints the label already resolved', () => {
    stubMatchMedia(true)

    const observe = vi.fn()
    vi.stubGlobal(
      'IntersectionObserver',
      // A plain function, not an arrow: the component calls it with `new`.
      vi.fn(function () {
        return { observe, unobserve: vi.fn(), disconnect: vi.fn() }
      }),
    )

    render(
      <SectionHeading id={HEADING_ID} index={5}>
        {LABEL}
      </SectionHeading>,
    )

    expect(observe).not.toHaveBeenCalled()
    expect(paintedText()).toBe(`05 / ${LABEL}`)
  })
})

describe('SectionHeading when it scrolls into view', () => {
  /** The fake observer's captured callback and its spies. */
  type Harness = {
    intersect: () => void
    observe: ReturnType<typeof vi.fn>
    unobserve: ReturnType<typeof vi.fn>
    disconnect: ReturnType<typeof vi.fn>
    options: () => IntersectionObserverInit | undefined
  }

  function stubObserver(): Harness {
    const observe = vi.fn()
    const unobserve = vi.fn()
    const disconnect = vi.fn()
    let fire: IntersectionObserverCallback | undefined
    let options: IntersectionObserverInit | undefined

    vi.stubGlobal(
      'IntersectionObserver',
      // A plain function rather than an arrow, because the component calls it
      // with `new`; returning an object makes that `new` yield this harness.
      vi.fn(function (
        callback: IntersectionObserverCallback,
        init?: IntersectionObserverInit,
      ) {
        fire = callback
        options = init
        return { observe, unobserve, disconnect }
      }),
    )

    return {
      observe,
      unobserve,
      disconnect,
      options: () => options,
      intersect() {
        const target = observe.mock.calls[0]?.[0] as Element
        act(() => {
          fire?.(
            [{ isIntersecting: true, target } as IntersectionObserverEntry],
            {} as IntersectionObserver,
          )
        })
      },
    }
  }

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function renderHeading() {
    return render(
      <SectionHeading id={HEADING_ID} index={5}>
        {LABEL}
      </SectionHeading>,
    )
  }

  it('watches the h2 at half visibility', () => {
    const observer = stubObserver()

    renderHeading()

    expect(observer.observe).toHaveBeenCalledTimes(1)
    expect(observer.observe.mock.calls[0][0]).toBe(heading())
    // Half the heading on screen, not the default "one pixel".
    expect(observer.options()?.threshold).toBe(0.5)
  })

  it('scrambles on the first intersecting entry and settles on the label', () => {
    const observer = stubObserver()

    renderHeading()

    // Before it is on screen, the label is simply the label.
    expect(paintedText()).toBe(`05 / ${LABEL}`)

    observer.intersect()

    // The very first painted frame is already noise — no flash of real text
    // before the effect's first tick.
    const firstFrame = paintedText()

    expect(firstFrame).not.toBe(`05 / ${LABEL}`)
    // Same length throughout, so the heading never reflows while it resolves.
    expect(firstFrame).toHaveLength(`05 / ${LABEL}`.length)
    // ...and the number in front of it does not scramble.
    expect(firstFrame.startsWith('05 / ')).toBe(true)

    // One frame in, still mid-resolve and still the right length.
    act(() => {
      vi.advanceTimersByTime(40 * 5)
    })

    const midFrame = paintedText()

    expect(midFrame).toHaveLength(`05 / ${LABEL}`.length)

    // The whole run is 20 frames of 40ms.
    act(() => {
      vi.advanceTimersByTime(40 * 20)
    })

    expect(paintedText()).toBe(`05 / ${LABEL}`)
  })

  it('tells a screen reader the real label at every frame', () => {
    const observer = stubObserver()

    renderHeading()
    observer.intersect()

    expect(announcedText()).toBe(LABEL)
    expect(heading()).toBe(
      screen.getByRole('heading', { level: 2, name: LABEL }),
    )

    act(() => {
      vi.advanceTimersByTime(40 * 5)
    })

    expect(announcedText()).toBe(LABEL)
  })

  it('unobserves after the first hit, so a heading resolves once', () => {
    const observer = stubObserver()

    renderHeading()

    expect(observer.unobserve).not.toHaveBeenCalled()

    observer.intersect()

    expect(observer.unobserve).toHaveBeenCalledTimes(1)
    expect(observer.unobserve.mock.calls[0][0]).toBe(heading())
  })

  it('disconnects on unmount', () => {
    const observer = stubObserver()

    const { unmount } = renderHeading()
    unmount()

    expect(observer.disconnect).toHaveBeenCalledTimes(1)
  })
})
