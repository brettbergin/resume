import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BOARD_HEIGHT, BOARD_WIDTH } from '../../game/engine.ts'
import { BEST_SCORE_STORAGE_KEY } from '../../game/score.ts'
import { FOCUS_RING, TAP_TARGET_HEIGHT } from '../../styles.ts'
import { GamePage, TICK_MS } from './GamePage.tsx'

/*
 * The page is mounted on its own here — no App.tsx, no router — because the
 * only thing it owns is the wiring the engine deliberately does not have: the
 * clock, the keyboard and the button. The rules themselves are covered next to
 * `src/game/engine.ts`, so nothing below asserts a score or a growth rule; it
 * asserts that a key press reaches `tick`, that the clock does not run before
 * Start and does not run after a death, and that the control comes back.
 *
 * Fake timers throughout: the real interval would make every assertion a wait,
 * and driving it by hand is what lets a test walk the snake into a wall in one
 * `act` block. Food is placed by the engine from `Math.random`, so no test
 * here asserts where it lands — only where the *head* goes, which is the same
 * cell whether it ate on the way or not.
 */

/** Where `createInitialState()` puts the one-cell snake. Mirrors the engine's
 * own default rather than importing a private constant. */
const START = `${Math.floor(BOARD_WIDTH / 2)},${Math.floor(BOARD_HEIGHT / 2)}`

const head = () => document.querySelector('[data-fill="head"]')

const headCell = () => head()?.getAttribute('data-cell')

const control = () => screen.getByRole('button')

/** Let the board advance `count` ticks of the component's own interval. */
function advance(count: number) {
  act(() => {
    vi.advanceTimersByTime(TICK_MS * count)
  })
}

/**
 * Walk the snake into the one piece of food on the board and come back with a
 * score of 1.
 *
 * With `Math.random` pinned to 0 the engine puts food in the first free cell
 * it enumerates, which on a fresh board is the top-left corner, so the route
 * is known: left along the middle row to the left wall, then up it. The last
 * tick arrives on the food rather than past it, so the snake is still alive
 * and the run can simply be left where it stands.
 */
function playUntilFirstFood() {
  vi.spyOn(Math, 'random').mockReturnValue(0)

  fireEvent.click(control())
  fireEvent.keyDown(window, { key: 'ArrowLeft' })
  advance(Math.floor(BOARD_WIDTH / 2))
  fireEvent.keyDown(window, { key: 'ArrowUp' })
  advance(Math.floor(BOARD_HEIGHT / 2))
}

beforeEach(() => {
  // Storage-backed state: every test starts from a browser that has never
  // seen this page, and leaves one behind for the next.
  window.localStorage.clear()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  window.localStorage.clear()
})

describe('GamePage', () => {
  it('renders one h1 for the route', () => {
    render(<GamePage />)

    const headings = screen.getAllByRole('heading', { level: 1 })

    expect(headings).toHaveLength(1)
    expect(headings[0].textContent).toBe('~/snake')
  })

  it('draws a cell for every square of the engine board', () => {
    render(<GamePage />)

    expect(document.querySelectorAll('[data-cell]')).toHaveLength(
      BOARD_WIDTH * BOARD_HEIGHT,
    )
    expect(headCell()).toBe(START)
  })

  it('shows the live score, starting at zero', () => {
    render(<GamePage />)

    expect(screen.getByText('score: 0')).toBeTruthy()
  })

  it('offers a Start control and does not advance the board until it is used', () => {
    vi.useFakeTimers()
    render(<GamePage />)

    expect(control().textContent).toBe('Start')

    advance(10)

    expect(headCell()).toBe(START)
    expect(screen.queryByText('game over')).toBeNull()
  })

  it('carries the shared focus-ring and tap-target tokens on its control', () => {
    render(<GamePage />)

    const classes = control().className

    for (const token of `${FOCUS_RING} ${TAP_TARGET_HEIGHT}`.split(' ')) {
      expect(classes).toContain(token)
    }
  })

  it('moves the head one cell per tick in the direction pressed', () => {
    vi.useFakeTimers()
    render(<GamePage />)

    fireEvent.click(control())
    fireEvent.keyDown(window, { key: 'ArrowUp' })
    advance(1)

    const x = Math.floor(BOARD_WIDTH / 2)
    const y = Math.floor(BOARD_HEIGHT / 2)

    expect(headCell()).toBe(`${x},${y - 1}`)

    fireEvent.keyDown(window, { key: 'a' })
    advance(1)

    expect(headCell()).toBe(`${x - 1},${y - 1}`)
  })

  it('accepts WASD in either case', () => {
    vi.useFakeTimers()
    render(<GamePage />)

    fireEvent.click(control())
    fireEvent.keyDown(window, { key: 'S' })
    advance(1)

    const x = Math.floor(BOARD_WIDTH / 2)
    const y = Math.floor(BOARD_HEIGHT / 2)

    expect(headCell()).toBe(`${x},${y + 1}`)
  })

  it('stops the arrow keys scrolling the page while it is mounted', () => {
    render(<GamePage />)

    const handled = new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      cancelable: true,
    })
    const ignored = new KeyboardEvent('keydown', {
      key: 'Tab',
      cancelable: true,
    })
    window.dispatchEvent(handled)
    window.dispatchEvent(ignored)

    expect(handled.defaultPrevented).toBe(true)
    expect(ignored.defaultPrevented).toBe(false)
  })

  it('leaves modifier combinations to the browser', () => {
    render(<GamePage />)

    const event = new KeyboardEvent('keydown', {
      key: 'a',
      ctrlKey: true,
      cancelable: true,
    })
    window.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
  })

  it('releases the keyboard on unmount', () => {
    const { unmount } = render(<GamePage />)
    unmount()

    const event = new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      cancelable: true,
    })
    window.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
  })

  it('ends the game at the wall, offers a Restart and stops the clock', () => {
    vi.useFakeTimers()
    render(<GamePage />)

    fireEvent.click(control())
    fireEvent.keyDown(window, { key: 'ArrowUp' })

    // Half a board of ticks walks the head from the middle row to row 0; one
    // more runs it into the wall above.
    advance(Math.floor(BOARD_HEIGHT / 2) + 1)

    expect(screen.getByText('game over')).toBeTruthy()

    const dead = headCell()
    expect(dead).toBe(`${Math.floor(BOARD_WIDTH / 2)},0`)

    // A dead board does not keep moving, and the control is back.
    advance(10)

    expect(headCell()).toBe(dead)
    expect(control().hasAttribute('disabled')).toBe(false)
    expect(control().textContent).toBe('Restart')
  })

  it('restarts from a fresh board when the control is used again', () => {
    vi.useFakeTimers()
    render(<GamePage />)

    fireEvent.click(control())
    fireEvent.keyDown(window, { key: 'ArrowUp' })
    advance(Math.floor(BOARD_HEIGHT / 2) + 1)

    expect(screen.getByText('game over')).toBeTruthy()

    fireEvent.click(control())

    expect(screen.queryByText('game over')).toBeNull()
    expect(headCell()).toBe(START)
    expect(screen.getByText('score: 0')).toBeTruthy()

    // The previous run's direction does not carry over: the fresh state
    // heads right, as the engine's default does.
    advance(1)

    expect(headCell()).toBe(
      `${Math.floor(BOARD_WIDTH / 2) + 1},${Math.floor(BOARD_HEIGHT / 2)}`,
    )
  })

  it('disables the control while a game is running', () => {
    vi.useFakeTimers()
    render(<GamePage />)

    fireEvent.click(control())

    expect(control().hasAttribute('disabled')).toBe(true)
  })
})

describe('GamePage best score', () => {
  it('shows a best of zero on a first visit, with nothing in storage', () => {
    render(<GamePage />)

    expect(screen.getByText('best: 0')).toBeTruthy()
    expect(window.localStorage.getItem(BEST_SCORE_STORAGE_KEY)).toBeNull()
  })

  it('reads the stored best on mount', () => {
    window.localStorage.setItem(BEST_SCORE_STORAGE_KEY, '7')

    render(<GamePage />)

    expect(screen.getByText('best: 7')).toBeTruthy()
  })

  it('raises the displayed best as soon as it is beaten, and persists it', () => {
    vi.useFakeTimers()
    render(<GamePage />)

    playUntilFirstFood()

    // Mid-run, with no reload and no death in between: the point counted
    // against the stored best the moment it was scored.
    expect(screen.getByText('score: 1')).toBeTruthy()
    expect(screen.getByText('best: 1')).toBeTruthy()
    expect(window.localStorage.getItem(BEST_SCORE_STORAGE_KEY)).toBe('1')
  })

  it('leaves a higher stored best alone after a weaker run', () => {
    window.localStorage.setItem(BEST_SCORE_STORAGE_KEY, '7')
    vi.useFakeTimers()
    render(<GamePage />)

    playUntilFirstFood()

    expect(screen.getByText('score: 1')).toBeTruthy()
    expect(screen.getByText('best: 7')).toBeTruthy()
    expect(window.localStorage.getItem(BEST_SCORE_STORAGE_KEY)).toBe('7')
  })

  it('keeps the best across a restart within the same visit', () => {
    vi.useFakeTimers()
    render(<GamePage />)

    playUntilFirstFood()
    // One more tick up runs the snake off the top of the board, which is what
    // frees the control to restart.
    advance(1)
    fireEvent.click(control())

    // A new run starts over at zero; the best does not.
    expect(screen.getByText('score: 0')).toBeTruthy()
    expect(screen.getByText('best: 1')).toBeTruthy()
  })

  it('renders with no best rather than throwing when storage is blocked', () => {
    // The whole object goes, the way Safari in private mode makes even the
    // property access throw — which is the case the page must survive.
    const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage')
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('SecurityError: storage access is denied')
      },
    })
    vi.useFakeTimers()

    try {
      expect(() => render(<GamePage />)).not.toThrow()
      expect(screen.getByText('best: 0')).toBeTruthy()

      playUntilFirstFood()

      // The run is still scored and the best still climbs on screen; only the
      // part that would outlive the tab is lost.
      expect(screen.getByText('best: 1')).toBeTruthy()
    } finally {
      if (descriptor) {
        Object.defineProperty(window, 'localStorage', descriptor)
      } else {
        delete (window as { localStorage?: Storage }).localStorage
      }
    }
  })
})
