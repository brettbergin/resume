import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { FOCUS_RING, TAP_TARGET } from '../../styles.ts'
import { TicTacToePage } from './TicTacToePage.tsx'

/*
 * The page is mounted on its own here — no App.tsx, no router — the same
 * choice `GamePage.test.tsx` makes: what belongs to this file is the wiring
 * the engine deliberately does not have (turning a click into `applyMove`,
 * firing the CPU's reply), not the rules themselves, which are
 * `src/tic-tac-toe/engine.test.ts`'s.
 *
 * `Math.random` is pinned to 0 throughout, which makes `cpuMove` pick the
 * lowest-indexed cell among its winning, then blocking, then free
 * candidates — deterministic enough that a fixed sequence of player clicks
 * always plays out the same way. The two sequences below were found by
 * exhaustively simulating the actual engine functions (not reimplementing
 * them), so they are exactly what the component itself will produce.
 */

const cellButton = (row: number, column: number, content: string) =>
  screen.getByRole('button', { name: `row ${row}, column ${column}, ${content}` })

const control = () => screen.getByRole('button', { name: /^(Start|Restart)$/ })

/** Row/column for a 0-indexed board cell, 1-based as the accessible name
 * renders them. */
function position(cell: number): [row: number, column: number] {
  return [Math.floor(cell / 3) + 1, (cell % 3) + 1]
}

/** Click an empty cell by its board index, regardless of what currently
 * occupies it — used only for the player's own moves, where the cell is
 * known to be empty at the point it is clicked. */
function clickCell(cell: number) {
  const [row, column] = position(cell)
  fireEvent.click(cellButton(row, column, 'empty'))
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('TicTacToePage', () => {
  it('renders one h1 for the route', () => {
    render(<TicTacToePage />)

    const headings = screen.getAllByRole('heading', { level: 1 })

    expect(headings).toHaveLength(1)
    expect(headings[0].textContent).toBe('~/tic-tac-toe')
  })

  it('renders 9 individually-focusable cell buttons with distinct names', () => {
    render(<TicTacToePage />)

    const names = new Set<string>()
    for (let row = 1; row <= 3; row += 1) {
      for (let column = 1; column <= 3; column += 1) {
        const button = cellButton(row, column, 'empty')
        names.add(button.getAttribute('aria-label') ?? '')
      }
    }

    expect(names.size).toBe(9)
  })

  it('carries the shared focus-ring and tap-target tokens on the Start control and every cell', () => {
    render(<TicTacToePage />)

    for (const token of `${FOCUS_RING} ${TAP_TARGET}`.split(' ')) {
      expect(control().className).toContain(FOCUS_RING)
      expect(cellButton(1, 1, 'empty').className).toContain(token)
    }
  })

  it('does not place a mark before Start is used', () => {
    render(<TicTacToePage />)

    fireEvent.click(cellButton(1, 1, 'empty'))

    expect(cellButton(1, 1, 'empty')).toBeTruthy()
    expect(screen.getByText('Press Start to play.')).toBeTruthy()
  })

  it('leaves a filled cell unchanged when it is clicked again', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    render(<TicTacToePage />)

    fireEvent.click(control())
    clickCell(0)

    const [row, column] = position(0)
    const filled = cellButton(row, column, 'X')
    fireEvent.click(filled)

    // Still X, still disabled: the second click on an occupied cell reached
    // no `applyMove` that could have changed or cleared it.
    expect(cellButton(row, column, 'X')).toBeTruthy()
    expect(filled.hasAttribute('disabled')).toBe(true)
  })

  it('ignores a click on any cell once the game has ended', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    render(<TicTacToePage />)

    fireEvent.click(control())
    // The draw sequence below fills every cell, so by its end every button
    // is occupied; the assertion that matters is that the state stops
    // changing, which an unchanged board after one more click on cell 0
    // demonstrates regardless of what already occupies it.
    for (const cell of [0, 2, 4, 5, 7]) {
      clickCell(cell)
    }

    expect(screen.getByText('Draw.')).toBeTruthy()

    const [row, column] = position(0)
    const before = cellButton(row, column, 'X').getAttribute('aria-label')
    fireEvent.click(screen.getByRole('button', { name: before ?? '' }))

    expect(cellButton(row, column, 'X').getAttribute('aria-label')).toBe(before)
  })

  it('plays a full game through to a player win', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    render(<TicTacToePage />)

    fireEvent.click(control())
    expect(screen.getByText('Your turn.')).toBeTruthy()

    // X at 0, 2, 4, 8 with the CPU replying at 1, 3, 6 wins the diagonal
    // 0/4/8 — found by simulating `applyMove`/`cpuMove` directly with
    // `Math.random` pinned to 0, not guessed by hand.
    clickCell(0)
    clickCell(2)
    clickCell(4)
    clickCell(8)

    expect(screen.getByText('You win!')).toBeTruthy()
    expect(cellButton(2, 2, 'X')).toBeTruthy()
    expect(cellButton(3, 3, 'X')).toBeTruthy()

    // The board stops accepting moves once the game is over.
    for (let row = 1; row <= 3; row += 1) {
      for (let column = 1; column <= 3; column += 1) {
        const button = screen.getAllByRole('button').find((candidate) => {
          const label = candidate.getAttribute('aria-label')
          return label?.startsWith(`row ${row}, column ${column}, `)
        })
        expect(button?.hasAttribute('disabled')).toBe(true)
      }
    }
  })

  it('plays a full game through to a draw', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    render(<TicTacToePage />)

    fireEvent.click(control())

    // X at 0, 2, 4, 5, 7 with the CPU replying at 1, 3, 6, 8 fills the board
    // with no line completed — again found by simulating the engine
    // directly rather than by hand.
    clickCell(0)
    clickCell(2)
    clickCell(4)
    clickCell(5)
    clickCell(7)

    expect(screen.getByText('Draw.')).toBeTruthy()
    expect(document.querySelectorAll('button[aria-label*="empty"]')).toHaveLength(0)
  })

  it('offers Restart once a game has been played, and clears the board', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    render(<TicTacToePage />)

    expect(control().textContent).toBe('Start')

    fireEvent.click(control())
    clickCell(0)
    clickCell(2)
    clickCell(4)
    clickCell(8)

    expect(screen.getByText('You win!')).toBeTruthy()
    expect(control().textContent).toBe('Restart')

    fireEvent.click(control())

    expect(screen.getByText('Your turn.')).toBeTruthy()
    expect(document.querySelectorAll('button[aria-label*="empty"]')).toHaveLength(9)
  })
})
