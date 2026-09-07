/*
 * Theme seam. The palette itself lives in index.css as semantic tokens that
 * the `.dark` rule reassigns, so switching themes is just a class on <html>.
 *
 * Deliberately minimal: no persistence and no UI. A later issue adds the
 * user-facing switcher, and persistence, on top of `applyTheme`.
 */

export type Theme = 'light' | 'dark'

const DARK_QUERY = '(prefers-color-scheme: dark)'

/** Toggle the `dark` class that drives the dark palette. */
export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark')
}

/** The theme the OS/browser currently prefers. */
export function getPreferredTheme(): Theme {
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light'
}

/** Apply the OS/browser preference. Call once before the first render. */
export function applyInitialTheme(): void {
  applyTheme(getPreferredTheme())
}
