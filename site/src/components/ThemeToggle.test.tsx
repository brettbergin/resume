import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { THEME_STORAGE_KEY, type Theme } from '../theme.ts'
import { ThemeToggle } from './ThemeToggle.tsx'

/*
 * State is seeded with `localStorage.setItem` and read back with `getItem`,
 * never through the module under test, so these assertions still hold if the
 * storage key or the parsing changes shape.
 *
 * jsdom never fires media query changes, so `matchMedia` is stubbed with a
 * query we control.
 */

type Listener = (event: MediaQueryListEvent) => void

function mockPreferredTheme(initial: Theme) {
  let matches = initial === 'dark'
  const listeners = new Set<Listener>()

  const query = {
    media: '(prefers-color-scheme: dark)',
    get matches() {
      return matches
    },
    addEventListener(_type: 'change', listener: Listener) {
      listeners.add(listener)
    },
    removeEventListener(_type: 'change', listener: Listener) {
      listeners.delete(listener)
    },
  }

  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => query),
  )

  return {
    listenerCount: () => listeners.size,
    change(theme: Theme) {
      matches = theme === 'dark'
      for (const listener of [...listeners]) {
        listener({ matches } as MediaQueryListEvent)
      }
    },
  }
}

function isDarkApplied() {
  return document.documentElement.classList.contains('dark')
}

beforeEach(() => {
  window.localStorage.clear()
  document.documentElement.classList.remove('dark')
})

afterEach(() => {
  vi.unstubAllGlobals()
  window.localStorage.clear()
  document.documentElement.classList.remove('dark')
})

describe('ThemeToggle', () => {
  it('renders a single button whose name says what it will do', () => {
    mockPreferredTheme('light')
    render(<ThemeToggle />)

    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(1)

    const button = buttons[0]
    expect(button.getAttribute('aria-label')).toBe('Switch to dark theme')
    expect(button.getAttribute('aria-pressed')).toBe('false')
    // The state is drawn, not coloured: an inline icon, hidden from the
    // accessibility tree because the button's name already carries the state.
    expect(button.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('gives the button a 44x44 tap target and a visible focus ring', () => {
    mockPreferredTheme('light')
    render(<ThemeToggle />)

    const className = screen.getByRole('button').className
    expect(className).toContain('min-h-11')
    expect(className).toContain('min-w-11')
    expect(className).toContain('focus-visible:outline-2')
  })

  it('toggles the dark class, persists the choice, and updates its own state', async () => {
    const user = userEvent.setup()
    mockPreferredTheme('light')
    render(<ThemeToggle />)

    const button = screen.getByRole('button')
    expect(isDarkApplied()).toBe(false)

    await user.click(button)

    expect(isDarkApplied()).toBe(true)
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(button.getAttribute('aria-label')).toBe('Switch to light theme')
    expect(screen.getByRole('button', { name: 'Switch to light theme' })).toBe(
      button,
    )

    await user.click(button)

    expect(isDarkApplied()).toBe(false)
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')
    expect(button.getAttribute('aria-pressed')).toBe('false')
    expect(button.getAttribute('aria-label')).toBe('Switch to dark theme')
  })

  it('is operable from the keyboard', async () => {
    const user = userEvent.setup()
    mockPreferredTheme('light')
    render(<ThemeToggle />)

    const button = screen.getByRole('button')
    await user.tab()
    expect(document.activeElement).toBe(button)

    await user.keyboard('{Enter}')
    expect(isDarkApplied()).toBe(true)
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
  })

  it('renders in the dark state when dark is already stored', () => {
    mockPreferredTheme('light')
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark')

    render(<ThemeToggle />)

    const button = screen.getByRole('button')
    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(button.getAttribute('aria-label')).toBe('Switch to light theme')
    expect(isDarkApplied()).toBe(true)
  })

  it('follows the OS preference when nothing is stored', () => {
    mockPreferredTheme('dark')

    render(<ThemeToggle />)

    expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('true')
    expect(isDarkApplied()).toBe(true)
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull()
  })

  it('follows a live OS change while nothing is stored', () => {
    const media = mockPreferredTheme('light')
    render(<ThemeToggle />)

    act(() => media.change('dark'))

    expect(isDarkApplied()).toBe(true)
    expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('true')
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull()
  })

  it('ignores OS changes after the user has toggled', async () => {
    const user = userEvent.setup()
    const media = mockPreferredTheme('light')
    render(<ThemeToggle />)

    await user.click(screen.getByRole('button'))
    expect(isDarkApplied()).toBe(true)

    act(() => media.change('light'))

    expect(isDarkApplied()).toBe(true)
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
  })

  it('removes its media query listener on unmount', () => {
    const media = mockPreferredTheme('light')
    const { unmount } = render(<ThemeToggle />)

    expect(media.listenerCount()).toBeGreaterThan(0)

    unmount()

    expect(media.listenerCount()).toBe(0)
  })
})
