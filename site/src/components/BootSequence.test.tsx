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
