/*
 * The light/dark switch.
 *
 * A plain <button> rather than a styled checkbox: the control performs an
 * action ("switch to dark theme") and needs no form value, so a button with
 * `aria-pressed` is the honest role. Every decision about *what* a theme is,
 * and about storage, belongs to ../theme.ts — this component only renders the
 * current state and calls `setTheme`.
 */

import { useEffect, useState } from 'react'

import { FOCUS_RING, TAP_TARGET } from '../styles.ts'
import {
  applyTheme,
  getInitialTheme,
  setTheme,
  watchPreferredTheme,
  type Theme,
} from '../theme.ts'

/** Sun for light, crescent for dark: different shapes, so the state is not
 * carried by color alone. */
function ThemeIcon({ theme }: { theme: Theme }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-5"
    >
      {theme === 'dark' ? (
        <path d="M16 12.6A6.6 6.6 0 0 1 7.4 4a6.6 6.6 0 1 0 8.6 8.6Z" />
      ) : (
        <>
          <circle cx="10" cy="10" r="3.5" />
          <path d="M10 2.5v1.5M10 16v1.5M2.5 10h1.5M16 10h1.5M4.7 4.7l1.1 1.1M14.2 14.2l1.1 1.1M15.3 4.7l-1.1 1.1M5.8 14.2l-1.1 1.1" />
        </>
      )}
    </svg>
  )
}

export function ThemeToggle() {
  // main.tsx has already applied this same value before the first render, so
  // the button starts out agreeing with the class on <html>.
  const [theme, setThemeState] = useState<Theme>(getInitialTheme)

  // Keep <html> in step with state. A no-op on mount after main.tsx ran; it
  // does the work when the state changes on its own — an OS switch while
  // nothing is stored — and when the toggle is rendered in isolation.
  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  // Follow the OS for as long as the user has not chosen; the watcher itself
  // stops reporting once a choice is stored.
  useEffect(() => watchPreferredTheme(setThemeState), [])

  const isDark = theme === 'dark'
  const nextTheme: Theme = isDark ? 'light' : 'dark'

  return (
    <button
      type="button"
      // The name says what pressing does, and changes with the state, so
      // screen-reader users hear the outcome rather than a bare "theme".
      aria-label={`Switch to ${nextTheme} theme`}
      aria-pressed={isDark}
      onClick={() => {
        setTheme(nextTheme)
        setThemeState(nextTheme)
      }}
      className={`inline-flex ${TAP_TARGET} items-center justify-center rounded-pill border border-border-strong text-text hover:text-accent ${FOCUS_RING}`}
    >
      <ThemeIcon theme={theme} />
    </button>
  )
}
