import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  applyInitialTheme,
  applyTheme,
  getInitialTheme,
  getPreferredTheme,
  getStoredTheme,
  setTheme,
  THEME_STORAGE_KEY,
  watchPreferredTheme,
  type Theme,
} from './theme.ts'

/*
 * Every case below seeds localStorage by hand with `setItem`, never through
 * `setTheme`, so the module is read against raw values a real browser could
 * be holding — including ones written by an older version of this code, or by
 * something else entirely on the shared brettbergin.github.io origin.
 */

type Listener = (event: MediaQueryListEvent) => void

/** Replace window.matchMedia with a query whose value we can change and whose
 * listeners we can count, since jsdom never fires media query changes. */
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
    /** Simulate the OS flipping. */
    change(theme: Theme) {
      matches = theme === 'dark'
      for (const listener of [...listeners]) {
        listener({ matches } as MediaQueryListEvent)
      }
    },
  }
}

/** The raw stored values that must resolve to a theme, and the ones that must
 * be treated as "nothing stored". `undefined` means the key is absent. */
const STORED_VALUE_CASES: { label: string; raw?: string; stored: Theme | null }[] =
  [
    { label: 'no key at all', stored: null },
    { label: "'light'", raw: 'light', stored: 'light' },
    { label: "'dark'", raw: 'dark', stored: 'dark' },
    { label: "'DARK' (wrong case)", raw: 'DARK', stored: null },
    { label: 'an empty string', raw: '', stored: null },
    { label: "the string 'null'", raw: 'null', stored: null },
    { label: 'a JSON object string', raw: '{"theme":"dark"}', stored: null },
    { label: 'arbitrary garbage', raw: 'not-a-theme-🙃', stored: null },
  ]

beforeEach(() => {
  window.localStorage.clear()
  document.documentElement.classList.remove('dark')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  window.localStorage.clear()
  document.documentElement.classList.remove('dark')
})

describe('applyTheme', () => {
  it('adds and removes the dark class on <html>', () => {
    applyTheme('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    applyTheme('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })
})

describe('getPreferredTheme', () => {
  it('reports what prefers-color-scheme says', () => {
    mockPreferredTheme('dark')
    expect(getPreferredTheme()).toBe('dark')

    mockPreferredTheme('light')
    expect(getPreferredTheme()).toBe('light')
  })
})

describe.each(['light', 'dark'] as const)(
  'with the OS preferring %s',
  (osTheme) => {
    describe.each(STORED_VALUE_CASES)(
      'and $label in localStorage',
      ({ raw, stored }) => {
        beforeEach(() => {
          mockPreferredTheme(osTheme)
          if (raw !== undefined) {
            window.localStorage.setItem(THEME_STORAGE_KEY, raw)
          }
        })

        it(`getStoredTheme returns ${String(stored)}`, () => {
          expect(getStoredTheme()).toBe(stored)
        })

        it(`getInitialTheme returns ${stored ?? `the OS value (${osTheme})`}`, () => {
          expect(getInitialTheme()).toBe(stored ?? osTheme)
        })

        it('applyInitialTheme applies that theme and writes nothing', () => {
          const setItem = vi.spyOn(window.localStorage, 'setItem')

          applyInitialTheme()

          expect(document.documentElement.classList.contains('dark')).toBe(
            (stored ?? osTheme) === 'dark',
          )
          expect(setItem).not.toHaveBeenCalled()
        })
      },
    )
  },
)

describe('getStoredTheme', () => {
  it('reads the namespaced key, not a bare "theme" key', () => {
    mockPreferredTheme('light')
    window.localStorage.setItem('theme', 'dark')

    expect(getStoredTheme()).toBeNull()
    expect(getInitialTheme()).toBe('light')
  })

  it('tolerates a localStorage getter that throws', () => {
    mockPreferredTheme('dark')
    const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage')
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('SecurityError: storage access is denied')
      },
    })

    try {
      expect(getStoredTheme()).toBeNull()
      expect(getInitialTheme()).toBe('dark')
      expect(() => applyInitialTheme()).not.toThrow()
      expect(document.documentElement.classList.contains('dark')).toBe(true)
      expect(() => setTheme('light')).not.toThrow()
      expect(document.documentElement.classList.contains('dark')).toBe(false)
    } finally {
      if (descriptor) {
        Object.defineProperty(window, 'localStorage', descriptor)
      } else {
        delete (window as { localStorage?: Storage }).localStorage
      }
    }
  })

  it('tolerates a getItem that throws', () => {
    mockPreferredTheme('dark')
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError: storage access is denied')
    })

    expect(getStoredTheme()).toBeNull()
    expect(getInitialTheme()).toBe('dark')
  })
})

describe('setTheme', () => {
  it('applies the theme and persists it under the namespaced key', () => {
    mockPreferredTheme('light')

    setTheme('dark')

    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')

    setTheme('light')

    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')
  })

  it('still applies the theme when the write throws', () => {
    mockPreferredTheme('light')
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })

    expect(() => setTheme('dark')).not.toThrow()
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })
})

describe('watchPreferredTheme', () => {
  it('reports OS changes while nothing is stored', () => {
    const media = mockPreferredTheme('light')
    const onChange = vi.fn()

    watchPreferredTheme(onChange)
    media.change('dark')

    expect(onChange).toHaveBeenCalledWith('dark')

    media.change('light')
    expect(onChange).toHaveBeenLastCalledWith('light')
  })

  it('ignores OS changes once the user has stored a choice', () => {
    const media = mockPreferredTheme('light')
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light')
    const onChange = vi.fn()

    watchPreferredTheme(onChange)
    media.change('dark')

    expect(onChange).not.toHaveBeenCalled()
  })

  it('still reports when the stored value is invalid', () => {
    const media = mockPreferredTheme('light')
    window.localStorage.setItem(THEME_STORAGE_KEY, '{"theme":"dark"}')
    const onChange = vi.fn()

    watchPreferredTheme(onChange)
    media.change('dark')

    expect(onChange).toHaveBeenCalledWith('dark')
  })

  it('removes its listener on cleanup', () => {
    const media = mockPreferredTheme('light')
    const onChange = vi.fn()

    const stop = watchPreferredTheme(onChange)
    expect(media.listenerCount()).toBe(1)

    stop()
    expect(media.listenerCount()).toBe(0)

    media.change('dark')
    expect(onChange).not.toHaveBeenCalled()
  })
})
