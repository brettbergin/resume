/*
 * The `~/game` page: a board, a score, a Start/Restart button and the keyboard.
 * `App.tsx` renders it inside the shell's existing `<main>` when
 * `location.hash` names the route, the same way `ToolsPage` is mounted, so the
 * header, the footer and the skip link are the resume's — this file owns the
 * page's content, not its chrome, and renders its own `<h1>`.
 *
 * NO RULES LIVE HERE. Movement, growth, food placement, collisions and scoring
 * are `src/game/engine.ts`'s, and this component only ever calls
 * `createInitialState` and `tick` and draws what comes back. The temptation in
 * a game component is to "just" clamp a coordinate or add a point inline; two
 * copies of a rule is how a board starts disagreeing with its own score. The
 * only arithmetic in this file is laying cells out in a grid.
 *
 * What the component does own is everything the engine deliberately does not:
 *
 * - WHICH DIRECTION was asked for, in a ref rather than state. A key press
 *   between ticks must not re-render four hundred cells, and the interval
 *   below wants the newest value rather than the one captured when it was
 *   scheduled. The engine refuses a reversal into the neck itself, so this
 *   file stores whatever was pressed and lets `tick` decide.
 * - WHEN a tick happens: one `setInterval`, cleared on unmount and whenever
 *   the game is not running — which includes the moment the snake dies, so a
 *   dead game stops rather than relying on `tick` being a no-op.
 * - THE KEYS: arrows and WASD, case-insensitive, with `preventDefault` on the
 *   ones that are handled so that playing does not scroll the page out from
 *   under the board. A press carrying a modifier is left alone: Ctrl+A is the
 *   browser's, not the snake's.
 *
 * Accessibility: the grid is `aria-hidden`. Four hundred cells retitled on
 * every tick is not a board a screen reader can play, and announcing them
 * would bury the two things that actually change — the score and the end of
 * the game — which are published as text in a polite live region instead.
 * The controls are real buttons carrying the shared FOCUS_RING and
 * TAP_TARGET_HEIGHT floors from src/styles.ts.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  createInitialState,
  tick,
  type Direction,
  type GameState,
} from '../../game/engine.ts'
import { FOCUS_RING, TAP_TARGET_HEIGHT } from '../../styles.ts'

/** The page's own heading, and the label of the route that reaches it. */
const TITLE = '~/game'

/** How long a cell lasts. Fast enough to feel like Snake, slow enough that a
 * turn pressed on sight still lands before the wall does. Exported so a test
 * can advance a fake timer by exactly one tick instead of guessing. */
export const TICK_MS = 140

/** Every key the board answers to, by `event.key` lowercased — which turns
 * `ArrowUp` into `arrowup` and both `W` and `w` into `w`, so the letters are
 * case-insensitive without a second table for shifted presses. */
const KEY_DIRECTIONS: Record<string, Direction> = {
  arrowup: 'up',
  arrowdown: 'down',
  arrowleft: 'left',
  arrowright: 'right',
  w: 'up',
  s: 'down',
  a: 'left',
  d: 'right',
}

/** The Start/Restart button. Same shape as the `~/tools` pane's buttons, and
 * like them it declares the 44px floor and the focus ring from the shared
 * tokens rather than writing the utilities out again. */
const BUTTON = `inline-flex ${TAP_TARGET_HEIGHT} items-center justify-center rounded-pill border border-border-strong px-4 text-base text-text hover:text-accent disabled:border-border disabled:text-muted ${FOCUS_RING}`

/** What a cell is drawn as. `data-fill` is the same value, so a test can ask
 * where the head is without reading colours back out of a class list. */
type Fill = 'head' | 'body' | 'food' | 'empty'

const FILLS: Record<Fill, string> = {
  head: 'bg-accent',
  body: 'bg-accent/60',
  food: 'bg-text',
  empty: '',
}

/** What occupies a cell. The snake is checked head-first so the head wins the
 * tie on the tick it folds back over its own neck. */
function fillAt(state: GameState, x: number, y: number): Fill {
  const index = state.snake.findIndex(
    (segment) => segment.x === x && segment.y === y,
  )
  if (index === 0) return 'head'
  if (index > 0) return 'body'
  if (state.food !== null && state.food.x === x && state.food.y === y) {
    return 'food'
  }
  return 'empty'
}

export function GamePage() {
  /* A board exists before the first press so there is something to look at;
   * it just does not advance until Start is clicked. */
  const [state, setState] = useState<GameState>(() => createInitialState())
  const [running, setRunning] = useState(false)
  /** Whether a game has ever been started, which is the whole difference
   * between the button reading Start and reading Restart. */
  const [started, setStarted] = useState(false)

  /* The newest key press, read by the interval rather than by a render. */
  const requested = useRef<Direction | undefined>(undefined)

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      // Browser and OS shortcuts stay the browser's.
      if (event.ctrlKey || event.metaKey || event.altKey) return

      const direction = KEY_DIRECTIONS[event.key.toLowerCase()]
      if (direction === undefined) return

      // Only for the keys actually handled: the arrows scroll the page
      // otherwise, and the board would walk off the top of the viewport
      // while being played.
      event.preventDefault()
      requested.current = direction
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  useEffect(() => {
    if (!running || !state.alive) return

    const interval = setInterval(() => {
      setState((previous) => tick(previous, requested.current))
    }, TICK_MS)
    return () => clearInterval(interval)
    // `state.alive` rather than `state`: re-subscribing on every tick would
    // tear down and rebuild the interval each time, resetting the phase of
    // the clock the snake moves on. The only transition that matters here is
    // the one that stops it.
  }, [running, state.alive])

  const start = useCallback(() => {
    requested.current = undefined
    setState(createInitialState())
    setStarted(true)
    setRunning(true)
  }, [])

  const over = started && !state.alive
  const rows = Array.from({ length: BOARD_HEIGHT }, (_, y) => y)
  const columns = Array.from({ length: BOARD_WIDTH }, (_, x) => x)

  return (
    <div className="flex flex-col gap-6 py-8">
      <div>
        <h1 className="glow-text font-mono text-2xl font-medium">{TITLE}</h1>
        <p className="mt-2 text-base text-muted">
          Arrow keys or WASD to steer. Walls and your own tail are fatal.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={start}
          // Disabled only mid-game: restarting a run in progress by
          // mis-clicking the control you just used to begin it is the one
          // thing a player never means to do.
          disabled={running && state.alive}
          className={BUTTON}
        >
          {started ? 'Restart' : 'Start'}
        </button>

        {/* The score and the end of the game, as text — this is the part a
            screen reader is given in place of the grid below. One polite
            region around both, so a death announces the final score and the
            words together rather than as two interruptions. */}
        <div aria-live="polite" className="flex flex-wrap items-center gap-4">
          <p className="text-base text-text">score: {state.score}</p>
          {over && <p className="text-base text-accent">game over</p>}
        </div>
      </div>

      <div
        aria-hidden="true"
        className="grid w-full max-w-lg gap-px rounded-card border border-border bg-surface p-2"
        style={{
          gridTemplateColumns: `repeat(${BOARD_WIDTH}, minmax(0, 1fr))`,
        }}
      >
        {rows.map((y) =>
          columns.map((x) => {
            const fill = fillAt(state, x, y)
            return (
              <div
                key={`${x},${y}`}
                data-cell={`${x},${y}`}
                data-fill={fill}
                className={`aspect-square rounded-xs ${FILLS[fill]}`}
              />
            )
          }),
        )}
      </div>
    </div>
  )
}
