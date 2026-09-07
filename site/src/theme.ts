/*
 * Theme seam. The palette itself lives in index.css as semantic tokens that
 * the `.dark` rule reassigns, so switching themes is just a class on <html>.
 *
 * Two rules hold the whole module together:
 *
 * - Nothing is written to storage until the user actually toggles. An
 *   untouched visitor keeps following the OS, and while that is true a change
 *   to `prefers-color-scheme` is followed live (see `watchPreferredTheme`).
 *   Once a choice is stored, it wins and OS changes are ignored.
 * - Every localStorage access is wrapped in try/catch. Safari in private mode
 *   throws on the property access itself, and a theme lookup must never be
 *   the reason the page fails to render — a throw degrades to the OS
 *   preference.
 */

export type Theme = 'light' | 'dark'

const DARK_QUERY = '(prefers-color-scheme: dark)'

/**
 * Where the user's choice is persisted.
 *
 * Namespaced deliberately: GitHub Pages project pages all share the single
 * https://brettbergin.github.io origin, and therefore one localStorage, so a
 * bare `theme` key would collide with the owner's other project sites.
 */
export const THEME_STORAGE_KEY = 'resume-theme'

function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark'
}

/** Toggle the `dark` class that drives the dark palette. */
export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark')
}

/** The theme the OS/browser currently prefers. */
export function getPreferredTheme(): Theme {
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light'
}

/**
 * The user's persisted choice, or `null` when there is nothing usable to read.
 * Anything that is not exactly 'light' or 'dark' — an absent key, an empty
 * string, 'DARK', 'null', a JSON blob left by some other version of this code
 * — counts as nothing, so callers fall back to the OS preference rather than
 * trusting a value they cannot interpret.
 */
export function getStoredTheme(): Theme | null {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
    return isTheme(stored) ? stored : null
  } catch {
    return null
  }
}

/** The stored choice if there is a valid one, otherwise the OS preference. */
export function getInitialTheme(): Theme {
  return getStoredTheme() ?? getPreferredTheme()
}

/** Apply a theme *and* remember it. This is the only writer of storage. */
export function setTheme(theme: Theme): void {
  applyTheme(theme)
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // Storage is unavailable (private mode, blocked cookies). The class is
    // already applied, so the toggle still works for this page view; it just
    // will not survive a reload.
  }
}

/**
 * Follow the OS preference for as long as the user has made no choice.
 * Returns a cleanup that removes the listener — call it from the effect that
 * installed the watcher so nothing is left attached after unmount.
 */
export function watchPreferredTheme(
  onChange: (theme: Theme) => void,
): () => void {
  const query = window.matchMedia(DARK_QUERY)

  function handleChange(event: MediaQueryListEvent) {
    // A stored choice outranks the OS: the user has already said what they
    // want, so their machine switching at sunset must not undo it.
    if (getStoredTheme() !== null) return
    onChange(event.matches ? 'dark' : 'light')
  }

  query.addEventListener('change', handleChange)
  return () => {
    query.removeEventListener('change', handleChange)
  }
}

/**
 * Apply the stored choice, or the OS preference when there is none. Called
 * once from main.tsx before the first render, so a reload comes up in the
 * user's theme with no flash of the wrong palette. Reads storage; never
 * writes it.
 */
export function applyInitialTheme(): void {
  applyTheme(getInitialTheme())
}
