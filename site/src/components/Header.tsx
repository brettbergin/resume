/*
 * The sticky top bar: wordmark, section nav, and — below the `md` breakpoint —
 * a menu button that opens a full-screen panel holding the same links.
 *
 * Both navs map over `sections`, so the nav and the page's anchors can never
 * drift apart; there is deliberately no second, hand-written list of links.
 *
 * The panel is a hand-rolled dialog (no headless UI dependency), which means
 * the three things a browser does not do for us are done here explicitly:
 * move focus in on open, keep Tab inside while open, and lock body scroll.
 *
 * `children` is a slot in the bar itself, next to the menu button, for
 * controls that belong to the header but are not navigation — the theme
 * toggle. It sits in the bar at *both* widths rather than being duplicated
 * into the panel, so there is only ever one toggle in the document.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'

import { summary } from '../data/resume.ts'
import { sections } from '../data/sections.ts'

/** Everything the panel can contain that takes focus. It holds only links and
 * the close button, so this stays a short selector rather than a general
 * focusable-element query. */
const FOCUSABLE = 'a[href], button:not([disabled])'

/** The `md` breakpoint, as a media query. 48rem is Tailwind's `md` (768px):
 * the width at which the inline nav takes over and every `md:hidden` piece of
 * the mobile menu stops being displayed. Kept in step with the `md:` classes
 * below by `Header.test.tsx`. */
const DESKTOP_QUERY = '(min-width: 48rem)'

/** Shared with every interactive element so keyboard users can always see
 * where they are. */
const FOCUS_RING =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

/** A 44x44 tap target (Tailwind's 11 = 2.75rem), the minimum comfortable
 * touch size. */
const TAP_TARGET = 'min-h-11 min-w-11'

function focusablesIn(container: HTMLElement | null): HTMLElement[] {
  if (!container) return []
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE))
}

export function Header({ children }: { children?: ReactNode }) {
  const [open, setOpen] = useState(false)
  const menuId = useId()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  /** Close and hand focus back to the control that opened the menu — for
   * dismissals (Escape, the close button) where focus would otherwise be lost
   * to <body>. Following a link instead moves focus onward, so that path just
   * calls `setOpen(false)`. */
  const dismiss = useCallback(() => {
    setOpen(false)
    buttonRef.current?.focus()
  }, [])

  // Focus the first thing in the panel as it opens, so the next Tab continues
  // from inside the menu rather than from wherever the button was.
  useEffect(() => {
    if (!open) return
    const [first] = focusablesIn(menuRef.current)
    first?.focus()
  }, [open])

  // Freeze the page behind the panel. The cleanup runs on close *and* on
  // unmount-while-open, and restores whatever was there before rather than
  // clearing the property outright.
  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [open])

  // Close the panel as soon as the viewport reaches `md`. Everything the open
  // state controls — the panel, the menu button, the focus trap, the body
  // scroll lock — is behind `md:hidden`, so a menu left open across the
  // breakpoint would strand `overflow: hidden` on <body> with no visible
  // control to clear it and no focused element for Escape to reach: an
  // unscrollable page recoverable only by reload. Crossing 768px in one
  // gesture is ordinary (a Galaxy Fold unfolds 344px -> 882px, an iPad mini
  // rotates 744px -> 1133px), and both start on the side where the menu
  // button is the only nav.
  useEffect(() => {
    const desktop = window.matchMedia(DESKTOP_QUERY)

    // Only the `change` edge needs handling: the panel can be open only after
    // a click on the menu button, which is itself `md:hidden`, so a mount at
    // desktop width always starts closed. (Reconciling `desktop.matches` here
    // as well would be a synchronous setState in an effect for a state that
    // cannot occur.)
    // `setOpen`, not `dismiss`: at this width the menu button is hidden, so
    // there is nothing to hand focus back to — the inline nav is on screen
    // instead.
    function handleChange(event: MediaQueryListEvent) {
      if (event.matches) setOpen(false)
    }

    desktop.addEventListener('change', handleChange)
    return () => {
      desktop.removeEventListener('change', handleChange)
    }
  }, [])

  /* Tab containment. Only the wrap points need intervening on: anywhere else
   * inside the panel the browser's own order is already correct. */
  function handleMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Tab') return

    const items = focusablesIn(menuRef.current)
    if (items.length === 0) return

    const first = items[0]
    const last = items[items.length - 1]
    const active = document.activeElement

    if (event.shiftKey) {
      if (active === first) {
        event.preventDefault()
        last.focus()
      }
      return
    }
    if (active === last) {
      event.preventDefault()
      first.focus()
    }
  }

  /* Escape is handled on the <header> rather than the panel so it also fires
   * when focus is on the menu button itself. */
  function handleHeaderKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (!open || event.key !== 'Escape') return
    event.preventDefault()
    dismiss()
  }

  return (
    <header
      onKeyDown={handleHeaderKeyDown}
      className="sticky top-0 z-40 h-14 border-b border-border bg-bg md:h-16"
    >
      <div className="mx-auto flex h-full max-w-5xl items-center justify-between gap-2 px-4 md:px-8">
        <span className="truncate text-base font-medium text-text">
          {summary.name}
        </span>

        {/* `gap-2` (8px), not less: these are 44px tap targets sitting next to
            each other on a phone, and adjacent targets need visible space
            between them to be hittable. */}
        <div className="flex items-center gap-2">
          {/* Inline nav from `md` up; below that the same links live in the
              panel, so this is hidden rather than squeezed. */}
          <nav
            aria-label="Primary"
            className="hidden md:flex md:items-center md:gap-2"
          >
            {sections.map((section) => (
              <a
                key={section.id}
                href={`#${section.id}`}
                className={`inline-flex ${TAP_TARGET} items-center justify-center rounded-pill px-3 text-sm text-muted hover:text-accent ${FOCUS_RING}`}
              >
                {section.label}
              </a>
            ))}
          </nav>

          {children}

          <button
            ref={buttonRef}
            type="button"
            aria-expanded={open}
            /* Only while the panel exists: the id it names is rendered with
               the panel, so advertising it when closed points at nothing. */
            aria-controls={open ? menuId : undefined}
            onClick={() => setOpen((wasOpen) => !wasOpen)}
            className={`inline-flex ${TAP_TARGET} items-center justify-center gap-2 rounded-pill border border-border px-3 text-sm text-text md:hidden ${FOCUS_RING}`}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              className="size-5"
            >
              <path d="M3 5.5h14M3 10h14M3 14.5h14" />
            </svg>
            Menu
          </button>
        </div>
      </div>

      {open ? (
        <div
          id={menuId}
          ref={menuRef}
          role="dialog"
          aria-modal="true"
          aria-label="Site menu"
          onKeyDown={handleMenuKeyDown}
          className="fixed inset-0 z-50 flex flex-col bg-bg md:hidden"
        >
          <div className="flex h-14 items-center justify-end border-b border-border px-4">
            <button
              type="button"
              onClick={dismiss}
              className={`inline-flex ${TAP_TARGET} items-center justify-center gap-2 rounded-pill border border-border px-3 text-sm text-text ${FOCUS_RING}`}
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                className="size-5"
              >
                <path d="M5 5l10 10M15 5L5 15" />
              </svg>
              Close
            </button>
          </div>

          <nav
            aria-label="Site sections"
            className="flex flex-col gap-2 overflow-y-auto p-4"
          >
            {sections.map((section) => (
              <a
                key={section.id}
                href={`#${section.id}`}
                onClick={() => setOpen(false)}
                className={`flex ${TAP_TARGET} items-center rounded-card px-4 text-lg text-text hover:bg-surface ${FOCUS_RING}`}
              >
                {section.label}
              </a>
            ))}
          </nav>
        </div>
      ) : null}
    </header>
  )
}
