/*
 * The rules of classic Snake, with nothing else in them: no canvas, no
 * keyboard, no timer, no React. The whole game is `createInitialState` plus
 * `tick`, both of which take a state and hand back a new one, so a renderer
 * can be a function of the state and a test can drive a hundred turns without
 * a DOM. Every rule a player would recognise — the snake advances a cell at a
 * time, eating lengthens it, a wall or its own flank kills it, you cannot turn
 * straight back into your own neck — lives here, so the UI never has to decide
 * any of them a second time and get a different answer.
 *
 * State is returned fresh rather than mutated in place. A tick is cheap at
 * these board sizes (a 20x20 board is 400 cells, a snake a few dozen at most),
 * and a caller holding the previous state — an undo, a replay, a React
 * `useState` that needs a new reference to re-render — gets one that still
 * means what it meant.
 *
 * Food is placed by picking uniformly from the cells the snake is *not* on,
 * rather than by guessing a cell and retrying until it misses. Enumerating the
 * free cells costs one pass over the board and makes two things true that
 * retrying does not: food can never land under the snake, and a nearly-full
 * board terminates instead of spinning on a shrinking target. The random
 * source is a parameter, so a test passes `() => 0` and knows exactly which
 * cell it gets.
 */

/** A cell on the board. `x` grows rightwards, `y` downwards, both from 0. */
export interface Cell {
  readonly x: number
  readonly y: number
}

export type Direction = 'up' | 'down' | 'left' | 'right'

/** A source of numbers in [0, 1), the shape `Math.random` already has. */
export type RandomSource = () => number

/** How far one step in each direction moves the head. `up` is -1 on `y`
 * because row 0 is the top row. */
const STEPS: Record<Direction, Cell> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
}

const OPPOSITES: Record<Direction, Direction> = {
  up: 'down',
  down: 'up',
  left: 'right',
  right: 'left',
}

/** The default board. Square, and large enough that the snake has somewhere to
 * go, but small enough to read as a grid of cells rather than of pixels. */
export const BOARD_WIDTH = 20
export const BOARD_HEIGHT = 20

/** What one eaten piece of food is worth. One point per segment keeps the
 * score and the snake's length the same number, which is what a player reading
 * both at once expects. */
export const FOOD_SCORE = 1

/**
 * Everything a renderer needs to draw the board and everything `tick` needs to
 * carry on from. `width` and `height` travel with the state so a caller that
 * started a smaller board does not have to remember which one it asked for.
 */
export interface GameState {
  readonly width: number
  readonly height: number
  /** Head first, tail last. Never empty while the game is running. */
  readonly snake: readonly Cell[]
  /** The direction the next tick will move in unless it is overridden. */
  readonly direction: Direction
  /** `null` only when the snake covers every cell and there is nowhere left
   * to put food. */
  readonly food: Cell | null
  readonly score: number
  /** `false` once the snake has hit a wall or itself. A dead game's ticks are
   * no-ops, so a caller that keeps ticking does not have to check first. */
  readonly alive: boolean
}

export interface InitialStateOptions {
  width?: number
  height?: number
  /** Where the snake starts, head first. Defaults to a single cell at the
   * centre of the board. */
  snake?: readonly Cell[]
  direction?: Direction
  /** Where the first food goes. Defaults to a cell chosen by `random`. */
  food?: Cell
  random?: RandomSource
}

const sameCell = (a: Cell, b: Cell): boolean => a.x === b.x && a.y === b.y

const occupies = (snake: readonly Cell[], cell: Cell): boolean =>
  snake.some((segment) => sameCell(segment, cell))

const inBounds = (cell: Cell, width: number, height: number): boolean =>
  cell.x >= 0 && cell.x < width && cell.y >= 0 && cell.y < height

/**
 * A cell for the next piece of food: uniformly chosen from the cells the snake
 * does not occupy, which is why it can never appear under the snake. Returns
 * `null` when the snake covers the board — a won game, and the only state in
 * which `GameState.food` is `null`.
 */
export function placeFood(
  snake: readonly Cell[],
  random: RandomSource = Math.random,
  width: number = BOARD_WIDTH,
  height: number = BOARD_HEIGHT,
): Cell | null {
  const free: Cell[] = []
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const cell = { x, y }
      if (!occupies(snake, cell)) free.push(cell)
    }
  }
  if (free.length === 0) return null

  // Clamped rather than trusted: a stub returning 1 — or 1.0000001 out of a
  // seeded generator — would otherwise index past the end of the list.
  const index = Math.min(free.length - 1, Math.max(0, Math.floor(random() * free.length)))
  return free[index]
}

/** A new game: a one-cell snake in the middle of the board, heading right,
 * with one piece of food down. */
export function createInitialState(options: InitialStateOptions = {}): GameState {
  const width = options.width ?? BOARD_WIDTH
  const height = options.height ?? BOARD_HEIGHT
  const random = options.random ?? Math.random
  const snake = options.snake ?? [{ x: Math.floor(width / 2), y: Math.floor(height / 2) }]

  return {
    width,
    height,
    snake,
    direction: options.direction ?? 'right',
    food: options.food ?? placeFood(snake, random, width, height),
    score: 0,
    alive: true,
  }
}

/**
 * The direction the next step will actually be taken in. A turn is refused
 * only when it is a straight reversal and the snake has a neck to reverse
 * into: with a single-cell snake there is no body behind the head, so turning
 * around is an ordinary turn. A refused turn keeps the current direction and
 * is otherwise uneventful — reversing is a slip of the fingers, not a way to
 * lose.
 */
export function resolveDirection(
  state: GameState,
  requested: Direction | undefined,
): Direction {
  if (requested === undefined) return state.direction
  if (state.snake.length > 1 && requested === OPPOSITES[state.direction]) {
    return state.direction
  }
  return requested
}

/**
 * One step of the game. `requestedDirection` is the turn the player asked for
 * this tick, if any; it is applied through `resolveDirection`, so a reversal
 * into the neck is ignored rather than fatal.
 *
 * Collisions set `alive` to `false` and leave the rest of the state as it was
 * at the moment of the crash — the snake stays where a renderer last drew it —
 * instead of throwing. Running out of board is not an exceptional condition,
 * it is how most games of Snake end.
 */
export function tick(
  state: GameState,
  requestedDirection?: Direction,
  random: RandomSource = Math.random,
): GameState {
  if (!state.alive) return state

  const direction = resolveDirection(state, requestedDirection)
  const step = STEPS[direction]
  const head = state.snake[0]
  const next: Cell = { x: head.x + step.x, y: head.y + step.y }

  if (!inBounds(next, state.width, state.height)) {
    return { ...state, direction, alive: false }
  }

  const eating = state.food !== null && sameCell(next, state.food)

  // The tail cell empties as the snake moves, so following your own tail is
  // legal — unless this is the tick the snake grows, when the tail stays put
  // and the cell is still occupied. Food never spawns on the snake, so the
  // growing case can only collide with the tail, never further up the body.
  const body = eating ? state.snake : state.snake.slice(0, -1)
  if (occupies(body, next)) {
    return { ...state, direction, alive: false }
  }

  if (!eating) {
    return { ...state, direction, snake: [next, ...body] }
  }

  const snake = [next, ...state.snake]
  return {
    ...state,
    direction,
    snake,
    food: placeFood(snake, random, state.width, state.height),
    score: state.score + FOOD_SCORE,
  }
}
