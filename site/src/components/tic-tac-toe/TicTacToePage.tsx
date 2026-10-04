/*
 * The `~/tic-tac-toe` page: a 3x3 grid, a Start/Restart button and the CPU
 * opponent from `src/tic-tac-toe/engine.ts`. Mounted by `App.tsx` inside the
 * existing `<main>` exactly as `GamePage` is, so the header, the footer and
 * the skip link are the resume's — this file owns the page's content, not its
 * chrome, and renders its own `<h1>`.
 *
 * NO RULES LIVE HERE. Whose move it is, whether a cell can be played, who has
 * won and when the game is over all come from `createInitialState`,
 * `applyMove` and `cpuMove`; this component only ever turns an interaction
 * into a call to one of those and draws what comes back.
 *
 * What the component does own is everything the engine deliberately does
 * not:
 *
 * - THE PLAYER IS X, the CPU is O, and X moves first — a convention this file
 *   picks, since the engine itself is indifferent to which mark is "the
 *   player's".
 * - THE CPU'S REPLY, folded into the same `setState` update as the player's
 *   own move rather than a separate effect: the CPU's move is one pure
 *   function call away once the player's move leaves the game not over, so
 *   there is nothing to synchronise with and no render to wait for — a test
 *   sees both marks land from the one click, with no timer to advance.
 * - INPUT: a pointer click or an Enter/Space press on a cell, which a real
 *   `<button>` already turns into one `onClick` without a key handler of its
 *   own.
 *
 * Accessibility: unlike the snake board, the grid here IS the interaction
 * surface, so it is not `aria-hidden` — each cell is a real, individually
 * focusable button with an accessible name naming its position and contents
 * ("row 2, column 1, X"), disabled once it is filled, once the game has
 * ended, or while it is not the player's move. The turn/win/draw status is
 * published as text in a polite live region, the same tier the snake's score
 * and game-over text use. The Start/Restart button and every cell carry the
 * shared `FOCUS_RING`; cells also carry `TAP_TARGET` since, unlike the
 * button, their size comes from nothing but the token.
 */

import { useCallback, useState } from 'react'

import {
  applyMove,
  cpuMove,
  createInitialState,
  type Cell,
  type GameState,
} from '../../tic-tac-toe/engine.ts'
import { FOCUS_RING, TAP_TARGET, TAP_TARGET_HEIGHT } from '../../styles.ts'

/** The page's own heading, and the label of the route that reaches it. */
const TITLE = '~/tic-tac-toe'

/** The player always plays this mark, and always moves first. */
const PLAYER_MARK = 'X'
/** The CPU always plays this mark. */
const CPU_MARK = 'O'

/** The Start/Restart button. Same shape as `GamePage`'s. */
const BUTTON = `inline-flex ${TAP_TARGET_HEIGHT} items-center justify-center rounded-pill border border-border-strong px-4 text-base text-text hover:text-accent disabled:border-border disabled:text-muted ${FOCUS_RING}`

/** One board cell. A 44x44 tap target on both axes, since nothing about its
 * content sizes either one the way the Start button's label sizes its
 * width. */
const CELL_BUTTON = `flex ${TAP_TARGET} aspect-square items-center justify-center rounded-xs border border-border bg-surface font-mono text-xl text-text hover:border-border-strong disabled:text-muted ${FOCUS_RING}`

/** The text the live region shows: whose turn it is before the game ends,
 * then how it ended. */
function statusText(state: GameState, started: boolean): string {
  if (!started) return 'Press Start to play.'
  if (state.isOver) {
    if (state.winner === PLAYER_MARK) return 'You win!'
    if (state.winner === CPU_MARK) return 'CPU wins.'
    return 'Draw.'
  }
  return state.currentPlayer === PLAYER_MARK ? 'Your turn.' : "CPU's turn."
}

export function TicTacToePage() {
  const [state, setState] = useState<GameState>(() => createInitialState())
  const [started, setStarted] = useState(false)

  const start = useCallback(() => {
    setState(createInitialState())
    setStarted(true)
  }, [])

  const playCell = useCallback(
    (cell: Cell) => {
      if (!started || state.isOver) return
      if (state.currentPlayer !== PLAYER_MARK) return
      if (state.board[cell] !== null) return

      setState((previous) => {
        const afterPlayer = applyMove(previous, cell, PLAYER_MARK)
        if (afterPlayer.isOver) return afterPlayer

        // The CPU's reply, right away: nothing between the player's move and
        // this one needs rendering, so there is no reason to wait for a
        // second pass through the component to make it.
        const cpuCell = cpuMove(afterPlayer)
        return cpuCell === null ? afterPlayer : applyMove(afterPlayer, cpuCell, CPU_MARK)
      })
    },
    [started, state],
  )

  return (
    <div className="flex flex-col gap-6 py-8">
      <div>
        <h1 className="glow-text font-mono text-2xl font-medium">{TITLE}</h1>
        <p className="mt-2 text-base text-muted">
          Play X against the CPU. Click a square, or tab to it and press
          Enter or Space.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <button type="button" onClick={start} className={BUTTON}>
          {started ? 'Restart' : 'Start'}
        </button>

        {/* The turn, the win, the loss or the draw, as text — the one thing a
            screen reader needs from a page whose grid it can already read
            cell by cell. */}
        <div aria-live="polite">
          <p className="text-base text-text">{statusText(state, started)}</p>
        </div>
      </div>

      <div
        className="grid w-full max-w-xs gap-2"
        style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}
      >
        {state.board.map((square, index) => {
          const cell = index as Cell
          const row = Math.floor(index / 3) + 1
          const column = (index % 3) + 1
          const disabled =
            !started ||
            state.isOver ||
            state.currentPlayer !== PLAYER_MARK ||
            square !== null

          return (
            <button
              key={cell}
              type="button"
              aria-label={`row ${row}, column ${column}, ${square ?? 'empty'}`}
              disabled={disabled}
              onClick={() => playCell(cell)}
              className={CELL_BUTTON}
            >
              {square ?? ''}
            </button>
          )
        })}
      </div>
    </div>
  )
}
