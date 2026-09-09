import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from '../App.tsx'
import { Cursor } from './Cursor.tsx'

/*
 * The reticle is two `fixed`, `aria-hidden` divs whose position is written
 * imperatively, so every case here reads the inline transform back off the
 * elements rather than looking at a rendered position: jsdom applies no
 * stylesheet and lays nothing out, and `size-5` is a class it knows nothing
 * about.
 *
 * jsdom has no PointerEvent and `clientX`/`clientY` are read-only on the base
 * Event, so the pointer events are dispatched as MouseEvents carrying the
 * coordinates — the same trick src/useTilt.test.ts uses.
 */

/** The two elements, by the classes that identify each: the shared `fixed`
 * plus their own size. Nothing else in the shell is a fixed, aria-hidden,
 * rounded box of either size — the boot overlay is fixed and aria-hidden but
 * neither sized nor rounded, and the header's icons are `size-5` but are
 * `<svg>`s inside a button. */
const RING = '[aria-hidden="true"].fixed.size-5.rounded-full'
const DOT = '[aria-hidden="true"].fixed.size-1.rounded-full'

const ROOT_CLASS = 'custom-cursor'

const GUARD_QUERIES = [
  '(hover: none)',
  '(pointer: coarse)',
  '(prefers-reduced-motion: reduce)',
]

/** matchMedia answering per query, as theme.test.ts and useTilt.test.ts do,
 * and counting listeners: the component must register none. */
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

function ring(): HTMLElement | null {
  return document.querySelector<HTMLElement>(RING)
}

function dot(): HTMLElement | null {
  return document.querySelector<HTMLElement>(DOT)
}

function hasRootClass(): boolean {
  return document.documentElement.classList.contains(ROOT_CLASS)
}

function pointerMove(clientX: number, clientY: number) {
  window.dispatchEvent(
    new MouseEvent('pointermove', { clientX, clientY, bubbles: true }),
  )
}

/** The pointer leaving the document rather than one element for another: a
 * `pointerout` that reaches the window with a null `relatedTarget`, which is
 * what a browser sends when the pointer goes up into the tab bar or off onto
 * another monitor. */
function pointerLeavesDocument() {
  document.documentElement.dispatchEvent(
    new MouseEvent('pointerout', { bubbles: true, relatedTarget: null }),
  )
}

/** The transform both elements are parked at before the first pointer event,
 * and again once the pointer leaves the document. */
const OFF_SCREEN_TRANSFORM =
  'translate3d(calc(-100px - 50%), calc(-100px - 50%), 0)'

/** A full-bleed overlay in front of the page, built as a raw element rather
 * than by rendering the component that ships one: what Cursor has to detect is
 * the `data-overlay` attribute, and the boot overlay is `aria-hidden inert`
 * rather than a dialog, so there is no role to key off. The classes are the
 * ones BootSequence.tsx actually carries. */
function appendOverlay(): HTMLDivElement {
  const overlay = document.createElement('div')
  overlay.setAttribute('data-overlay', 'boot')
  overlay.setAttribute('aria-hidden', 'true')
  overlay.className = 'dark fixed inset-0 z-50 bg-bg'
  document.body.append(overlay)
  return overlay
}

/** A link in the document to hover, outside the render container so no JSX
 * anchor is needed; bubbling carries the event up to the window listener. */
function appendLink(): HTMLAnchorElement {
  const link = document.createElement('a')
  link.href = '#anchor'
  link.textContent = 'a link'
  document.body.append(link)
  return link
}

beforeEach(() => {
  mockMedia()
})

afterEach(() => {
  vi.unstubAllGlobals()
  document.documentElement.classList.remove(ROOT_CLASS)
  for (const link of document.querySelectorAll('body > a')) link.remove()
  for (const overlay of document.querySelectorAll('body > [data-overlay]')) {
    overlay.remove()
  }
  window.sessionStorage.clear()
})

describe('Cursor guards', () => {
  it.each(GUARD_QUERIES)(
    'renders nothing and leaves the OS arrow alone when %s matches',
    (query) => {
      const media = mockMedia([query])

      render(<Cursor />)

      expect(ring()).toBeNull()
      expect(dot()).toBeNull()
      expect(hasRootClass()).toBe(false)

      // Suites elsewhere stub matchMedia with one shared object and count its
      // listeners; the component must not add to that.
      expect(media.listenerCount()).toBe(0)
    },
  )
})

describe('Cursor', () => {
  it('renders exactly two fixed, aria-hidden elements', () => {
    render(<Cursor />)

    expect(document.querySelectorAll(RING)).toHaveLength(1)
    expect(document.querySelectorAll(DOT)).toHaveLength(1)
    for (const element of [ring()!, dot()!]) {
      expect(element.className).toContain('pointer-events-none')
      expect(element.getAttribute('aria-hidden')).toBe('true')
    }
  })

  it('hides the OS arrow while mounted and hands it back on unmount', () => {
    const { unmount } = render(<Cursor />)
    expect(hasRootClass()).toBe(true)

    unmount()

    expect(hasRootClass()).toBe(false)
  })

  it('centres both elements on the pointer, and lags only the ring', () => {
    render(<Cursor />)

    pointerMove(120, 240)

    // Centred inside the same transform that positions it, because a
    // `-translate-*` class would be overwritten by this inline one.
    expect(dot()!.style.transform).toBe(
      'translate3d(calc(120px - 50%), calc(240px - 50%), 0)',
    )
    expect(ring()!.style.transform).toContain(
      'translate3d(calc(120px - 50%), calc(240px - 50%), 0)',
    )

    pointerMove(0, 0)
    expect(dot()!.style.transform).toBe(
      'translate3d(calc(0px - 50%), calc(0px - 50%), 0)',
    )

    // The lag, and the only difference between the two: the dot is written the
    // same position in the same tick and goes there immediately. The duration
    // is the `reticle-lag` utility in src/index.css (pinned by
    // test/rice-contract.test.ts) rather than an inline style, which no
    // stylesheet — including the reduced-motion block — could override.
    expect(ring()!.className).toContain('reticle-lag')
    expect(ring()!.style.transition).toBe('')
    expect(dot()!.className).not.toContain('reticle-lag')
    expect(dot()!.style.transition).toBe('')
  })

  it('parks both elements off-screen when the pointer leaves the document', () => {
    // Moving up into the tab bar or the URL bar, or off onto a second
    // monitor: no further pointermove arrives and the window keeps focus, so
    // without this both elements sit painted at the edge of the viewport with
    // no pointer near them.
    render(<Cursor />)

    pointerMove(200, 4)
    expect(dot()!.style.transform).toBe(
      'translate3d(calc(200px - 50%), calc(4px - 50%), 0)',
    )

    act(() => {
      pointerLeavesDocument()
    })

    expect(dot()!.style.transform).toBe(OFF_SCREEN_TRANSFORM)
    expect(ring()!.style.transform).toContain(OFF_SCREEN_TRANSFORM)

    // And the next real move brings them straight back.
    pointerMove(300, 300)
    expect(dot()!.style.transform).toBe(
      'translate3d(calc(300px - 50%), calc(300px - 50%), 0)',
    )
  })

  it('expands and re-colours the ring over a link, and restores it after', () => {
    render(<Cursor />)
    const link = appendLink()

    pointerMove(50, 50)
    expect(ring()!.style.transform).toContain('scale(1)')
    expect(ring()!.className).toContain('border-text')

    act(() => {
      link.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }))
    })

    expect(ring()!.style.transform).toContain('scale(2)')
    expect(ring()!.className).toContain('border-accent')
    expect(ring()!.className).not.toContain('border-text')
    // The dot is unchanged: it is the precise point, whatever it is over.
    expect(dot()!.style.transform).toBe(
      'translate3d(calc(50px - 50%), calc(50px - 50%), 0)',
    )

    act(() => {
      // `relatedTarget` is the element the pointer moved *onto*: this is one
      // element for another inside the page, not the pointer leaving the
      // document, so the reticle stays where it is.
      link.dispatchEvent(
        new MouseEvent('pointerout', {
          bubbles: true,
          relatedTarget: document.body,
        }),
      )
    })

    expect(ring()!.style.transform).toContain('scale(1)')
    expect(ring()!.className).toContain('border-text')
    expect(dot()!.style.transform).toBe(
      'translate3d(calc(50px - 50%), calc(50px - 50%), 0)',
    )
  })

  it('leaves the ring at rest over a non-interactive element', () => {
    render(<Cursor />)

    act(() => {
      document.body.dispatchEvent(
        new MouseEvent('pointerover', { bubbles: true }),
      )
    })

    expect(ring()!.style.transform).toContain('scale(1)')
    expect(ring()!.className).toContain('border-text')
  })

  it('suspends itself while the window is blurred, without unmounting', () => {
    render(<Cursor />)
    pointerMove(80, 90)

    act(() => {
      window.dispatchEvent(new Event('blur'))
    })

    expect(ring()).toBeNull()
    expect(dot()).toBeNull()
    expect(hasRootClass()).toBe(false)

    act(() => {
      window.dispatchEvent(new Event('focus'))
    })

    expect(hasRootClass()).toBe(true)
    // Re-created elements are painted at the position the pointer was last
    // seen at, rather than waiting for the next move.
    expect(dot()!.style.transform).toBe(
      'translate3d(calc(80px - 50%), calc(90px - 50%), 0)',
    )
  })

  it('suspends itself while a full-bleed overlay is in the document', async () => {
    // Mounted with the overlay already there, which is the first-load case:
    // the boot overlay is in the DOM before Cursor's effect runs. Over it the
    // reticle is the page's `--color-text` — #111827 in the light palette — on
    // the overlay's own dark-palette `bg-bg`, #0a0a0a, so painting it while
    // `custom-cursor` has taken the OS arrow away leaves no visible pointer.
    const overlay = appendOverlay()

    render(<Cursor />)

    expect(ring()).toBeNull()
    expect(dot()).toBeNull()
    expect(hasRootClass()).toBe(false)

    overlay.remove()

    // The MutationObserver's callback is delivered asynchronously.
    await waitFor(() => {
      expect(hasRootClass()).toBe(true)
    })
    expect(ring()).not.toBeNull()
    expect(dot()).not.toBeNull()
  })

  it('suspends itself when an overlay appears after it has mounted', async () => {
    render(<Cursor />)
    expect(hasRootClass()).toBe(true)

    const overlay = appendOverlay()

    await waitFor(() => {
      expect(hasRootClass()).toBe(false)
    })
    expect(ring()).toBeNull()

    overlay.remove()

    await waitFor(() => {
      expect(hasRootClass()).toBe(true)
    })
  })

  it('suspends itself for an element that gains the attribute in place', async () => {
    // The other shape an overlay can take: today's two mount and unmount,
    // which `childList` sees, but an element already in the document that is
    // shown by gaining the attribute has to count too — hence the
    // MutationObserver's attribute filter.
    render(<Cursor />)
    const overlay = document.createElement('div')
    overlay.className = 'fixed inset-0'
    document.body.append(overlay)

    await waitFor(() => {
      expect(hasRootClass()).toBe(true)
    })

    overlay.setAttribute('data-overlay', 'later')

    await waitFor(() => {
      expect(hasRootClass()).toBe(false)
    })

    overlay.removeAttribute('data-overlay')

    await waitFor(() => {
      expect(hasRootClass()).toBe(true)
    })
    overlay.remove()
  })

  it('stops listening once unmounted', () => {
    const { unmount } = render(<Cursor />)
    unmount()

    expect(() => {
      pointerMove(10, 10)
      window.dispatchEvent(new Event('blur'))
      document.body.append(document.createElement('span'))
    }).not.toThrow()

    expect(hasRootClass()).toBe(false)
    expect(ring()).toBeNull()
  })
})

describe('Cursor in the app', () => {
  beforeEach(() => {
    // The boot overlay is not the subject here, and it sits in front of the
    // header until it finishes; BootSequence skips it when this flag is set.
    window.sessionStorage.setItem('resume-boot-seen', '1')
  })

  it('is mounted exactly once, outside <main>', () => {
    render(<App />)

    expect(document.querySelectorAll(RING)).toHaveLength(1)
    expect(document.querySelectorAll(DOT)).toHaveLength(1)
    expect(screen.getByRole('main').contains(ring())).toBe(false)
    expect(hasRootClass()).toBe(true)
  })

  it('hands the OS arrow back while the mobile menu is open', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /^menu$/i }))
    expect(screen.getByRole('dialog')).toBeDefined()

    // The MutationObserver that spots the dialog delivers its callback
    // asynchronously, so the suspension lands a tick after the click.
    await waitFor(() => {
      expect(hasRootClass()).toBe(false)
    })
    expect(ring()).toBeNull()
    expect(dot()).toBeNull()

    await user.click(screen.getByRole('button', { name: /^close$/i }))

    await waitFor(() => {
      expect(hasRootClass()).toBe(true)
    })
    expect(ring()).not.toBeNull()
  })
})

/*
 * The first load of a fresh session, which is the one case where suspending on
 * an overlay is not a nicety: BootSequence's overlay is a `dark` subtree
 * painting `bg-bg` (#0a0a0a), and the reticle is the page's `--color-text`,
 * #111827 in the light palette, so a painted reticle over it is near-black on
 * near-black while `custom-cursor` has already taken the OS arrow away — no
 * pointer of any kind for the ~2.3s the overlay plays, including for the
 * pointerdown that dismisses it.
 *
 * Nothing here sets `resume-boot-seen` (the other App suite above does), so
 * the overlay actually plays, and the fake timers are BootSequence.test.tsx's
 * idiom for running it to completion.
 */
describe('Cursor during the boot sequence', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    act(() => {
      vi.runOnlyPendingTimers()
    })
    vi.useRealTimers()
  })

  it('hands the OS arrow back for as long as the boot overlay is on screen', async () => {
    render(<App />)

    // The overlay is not a dialog — it is `aria-hidden inert` — so the
    // attribute is what marks it as something to suspend for.
    const overlay = document.querySelector('[data-overlay]')
    expect(overlay).not.toBeNull()
    // And the palette that makes the suspension necessary: its own `dark`
    // subtree, so it is #0a0a0a under a light page too.
    expect(overlay?.className).toContain('dark')
    expect(overlay?.className).toContain('bg-bg')

    expect(hasRootClass()).toBe(false)
    expect(ring()).toBeNull()
    expect(dot()).toBeNull()

    // Dismissed the way the overlay's own listener is dismissed: a pointerdown
    // the reader has to aim, with the native arrow to aim it.
    await act(async () => {
      window.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    })

    // Still fading, so still in front of the page and still suspended.
    expect(document.querySelector('[data-overlay]')).not.toBeNull()
    expect(hasRootClass()).toBe(false)

    await act(async () => {
      vi.advanceTimersByTime(300)
    })

    expect(document.querySelector('[data-overlay]')).toBeNull()
    expect(hasRootClass()).toBe(true)
    expect(ring()).not.toBeNull()
    expect(dot()).not.toBeNull()
  })
})
