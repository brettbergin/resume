import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { summary } from '../data/resume.ts'
import { BootSequence } from './BootSequence.tsx'

const BOOT_STORAGE_KEY = 'resume-boot-seen'

/** jsdom never fires media query changes, so `matchMedia` is stubbed with a
 * query we control — same pattern as Header.test.tsx and theme.test.ts. */
function stubReducedMotion(matches: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      media: '(prefers-reduced-motion: reduce)',
      matches,
      addEventListener() {},
      removeEventListener() {},
    })),
  )
}

beforeEach(() => {
  stubReducedMotion(false)
  window.sessionStorage.clear()
  window.history.pushState({}, '', '/')
  vi.useFakeTimers()
})

afterEach(() => {
  act(() => {
    vi.runOnlyPendingTimers()
  })
  vi.useRealTimers()
  vi.unstubAllGlobals()
  window.sessionStorage.clear()
  window.history.pushState({}, '', '/')
})

function overlayIn(container: HTMLElement): HTMLElement | null {
  return container.querySelector('[aria-hidden="true"]')
}

describe('skip conditions', () => {
  it('renders null when the session flag is already set', () => {
    window.sessionStorage.setItem(BOOT_STORAGE_KEY, '1')

    const { container } = render(<BootSequence />)

    expect(container.firstChild).toBeNull()
  })

  it('renders null under prefers-reduced-motion', () => {
    stubReducedMotion(true)

    const { container } = render(<BootSequence />)

    expect(container.firstChild).toBeNull()
  })

  it('renders null with ?noboot in the URL', () => {
    window.history.pushState({}, '', '/?noboot=1')

    const { container } = render(<BootSequence />)

    expect(container.firstChild).toBeNull()
  })

  it('tolerates a sessionStorage getter that throws', () => {
    vi.spyOn(window.sessionStorage, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError: storage access is denied')
    })

    let container: HTMLElement | undefined
    expect(() => {
      ;({ container } = render(<BootSequence />))
    }).not.toThrow()

    // An unreadable flag is treated as "not seen", so the overlay still
    // mounts rather than silently disappearing.
    expect(overlayIn(container!)).not.toBeNull()
  })
})

describe('the overlay', () => {
  it('mounts hidden from assistive technology and inert to interaction', () => {
    const { container } = render(<BootSequence />)

    const overlay = overlayIn(container)

    expect(overlay).not.toBeNull()
    expect(overlay!.getAttribute('aria-hidden')).toBe('true')
    expect(overlay!.hasAttribute('inert')).toBe(true)
  })

  it('marks itself as an overlay, so the custom cursor suspends over it', () => {
    // Being neither a dialog nor announced, this attribute is the only thing
    // src/components/Cursor.tsx can find it by — and it has to, because the
    // reticle is drawn in the page's `--color-text` (#111827 in the light
    // palette) over this overlay's own dark-palette `bg-bg`, #0a0a0a, with
    // the OS arrow already hidden.
    const overlay = overlayIn(render(<BootSequence />).container)

    expect(overlay!.getAttribute('data-overlay')).toBe('boot')
  })

  it('is its own dark subtree, so the terminal is dark under either theme', () => {
    // index.css scopes both its `.dark { … }` tokens and its `dark` variant to
    // `.dark, .dark *` — the class on any ancestor, not only <html> — so this
    // is what makes `bg-bg`/`text-text`/`text-accent` inside resolve to the
    // dark palette on a light page, and what makes `glow-text` paint at all.
    const overlay = overlayIn(render(<BootSequence />).container)

    expect(overlay!.classList.contains('dark')).toBe(true)
    expect(overlay!.classList.contains('bg-bg')).toBe(true)
    expect(overlay!.classList.contains('text-text')).toBe(true)
  })

  it('paints in semantic tokens only, never a raw ramp colour', () => {
    // The rule the rest of src/components/ follows by convention, and the one
    // this overlay broke: a hard-coded `neutral-*` does not follow the palette,
    // which is how it kept the pre-neon navy after the cut-over. Checked both
    // while the script is typing and once the name and title are on screen,
    // since they are the later half of the markup.
    const { container } = render(<BootSequence />)

    expect(container.innerHTML).not.toContain('neutral-')

    act(() => {
      vi.runOnlyPendingTimers()
    })

    expect(container.textContent).toContain(summary.name)
    expect(container.innerHTML).not.toContain('neutral-')
  })

  it('blinks a block cursor while typing, and takes it away on close', () => {
    const { container } = render(<BootSequence />)

    const cursor = () =>
      [...container.querySelectorAll('p')].find((p) => p.textContent === '▌')

    expect(cursor()).toBeDefined()
    expect(cursor()!.className).toContain('blink')
    expect(cursor()!.className).toContain('text-accent')

    act(() => {
      vi.runOnlyPendingTimers()
    })
    act(() => {
      vi.advanceTimersByTime(300)
    })

    // Nothing left to type, and nothing left to blink at.
    expect(overlayIn(container)).toBeNull()
    expect(cursor()).toBeUndefined()
  })

  it('eventually types out the visitor’s name and title on its own', () => {
    const { container } = render(<BootSequence />)

    act(() => {
      vi.runOnlyPendingTimers()
    })

    expect(container.textContent).toContain(summary.name)
    expect(container.textContent).toContain(summary.title)
  })

  it('unmounts on its own once the script finishes, and marks the session', () => {
    const { container } = render(<BootSequence />)

    act(() => {
      vi.runOnlyPendingTimers()
    })
    act(() => {
      vi.advanceTimersByTime(300)
    })

    expect(overlayIn(container)).toBeNull()
    expect(window.sessionStorage.getItem(BOOT_STORAGE_KEY)).toBe('1')
  })
})

describe('dismissal', () => {
  it('a keydown ends it early, fades it out, and sets the session flag', () => {
    const { container } = render(<BootSequence />)

    expect(overlayIn(container)).not.toBeNull()

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }))
    })

    // finish() writes the flag immediately, before the fade finishes.
    expect(window.sessionStorage.getItem(BOOT_STORAGE_KEY)).toBe('1')
    expect(overlayIn(container)).not.toBeNull()

    act(() => {
      vi.advanceTimersByTime(300)
    })

    expect(overlayIn(container)).toBeNull()
  })

  it('a pointerdown ends it early the same way', () => {
    const { container } = render(<BootSequence />)

    act(() => {
      window.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    })
    act(() => {
      vi.advanceTimersByTime(300)
    })

    expect(overlayIn(container)).toBeNull()
    expect(window.sessionStorage.getItem(BOOT_STORAGE_KEY)).toBe('1')
  })

  it('does not throw when sessionStorage.setItem throws on dismissal', () => {
    vi.spyOn(window.sessionStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })

    render(<BootSequence />)

    expect(() => {
      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }))
      })
    }).not.toThrow()
  })
})
