/*
 * The rules of tic-tac-toe plus a CPU opponent, with nothing else in them: no
 * canvas, no click handlers, no React. The whole game is `createInitialState`
 * plus `applyMove`, both of which take a state and hand back a new one, so a
 * renderer can be a function of the state and a test can drive a full game
 * without a DOM.
 *
 * State is returned fresh rather than mutated in place, the same reasoning as
 * `site/src/game/engine.ts`: a caller holding the previous state — an undo, a
 * React `useState` that needs a new reference to re-render — gets one that
 * still means what it meant. An illegal move (an occupied cell, or any move
 * once the game has ended) is rejected by handing back the same state
 * reference unchanged, so a caller can tell nothing happened with `=== `
 * instead of inspecting an error.
 *
 * `cpuMove` picks among equally good free cells via an injected `RandomSource`
 * — the shape `Math.random` already has — so a test can pin exactly which
 * cell the CPU lands on instead of depending on `Math.random`.
 */

/** A player's mark on the board. */
export type Mark = 'X' | 'O'

/** A cell index into the row-major 3x3 board, 0 (top-left) through 8
 * (bottom-right). */
export type Cell = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8

/** One board position: empty, or the mark occupying it. */
export type Square = Mark | null

/** A source of numbers in [0, 1), the shape `Math.random` already has. */
export type RandomSource = () => number

/** The 8 ways to win: 3 rows, 3 columns, 2 diagonals. */
const LINES: readonly (readonly [Cell, Cell, Cell])[] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
]

/**
 * Everything a renderer needs to draw the board and everything `applyMove`
 * needs to carry on from. `winner` and `isOver` are carried on the state
 * rather than re-derived by every caller, so a caller can tell the game is
 * over without re-running win detection itself.
 */
export interface GameState {
  /** Row-major, index 0 top-left through 8 bottom-right. */
  readonly board: readonly Square[]
  /** The mark that moves next. Meaningless once `isOver` is true. */
  readonly currentPlayer: Mark
  /** `null` until a line is completed. */
  readonly winner: Mark | null
  /** `true` once there is a winner or the board is full. */
  readonly isOver: boolean
}

/** A new game: an empty board, `X` to move first. */
export function createInitialState(): GameState {
  return {
    board: new Array(9).fill(null),
    currentPlayer: 'X',
    winner: null,
    isOver: false,
  }
}

/** The mark occupying every cell of a line, or `null` if the line is not a
 * single mark three times over. */
function lineWinner(board: readonly Square[], line: readonly [Cell, Cell, Cell]): Mark | null {
  const [a, b, c] = line
  if (board[a] !== null && board[a] === board[b] && board[b] === board[c]) return board[a]
  return null
}

/** The mark that has completed one of the 8 lines, or `null` if none has. */
export function findWinner(board: readonly Square[]): Mark | null {
  for (const line of LINES) {
    const winner = lineWinner(board, line)
    if (winner !== null) return winner
  }
  return null
}

/** The indices of every empty cell. */
export function freeCells(board: readonly Square[]): Cell[] {
  const free: Cell[] = []
  for (let i = 0; i < board.length; i += 1) {
    if (board[i] === null) free.push(i as Cell)
  }
  return free
}

const otherMark = (mark: Mark): Mark => (mark === 'X' ? 'O' : 'X')

/**
 * One player's move. Rejected — returning `state` unchanged — when the cell
 * is already occupied or the game has already ended; a caller comparing the
 * result to the state it passed in can tell the move was refused.
 */
export function applyMove(state: GameState, cell: Cell, mark: Mark): GameState {
  if (state.isOver) return state
  if (state.board[cell] !== null) return state

  const board = state.board.slice()
  board[cell] = mark

  const winner = findWinner(board)
  const isOver = winner !== null || freeCells(board).length === 0

  return {
    board,
    currentPlayer: otherMark(mark),
    winner,
    isOver,
  }
}

/** A free cell chosen uniformly from `cells` via `random`. */
function pick(cells: readonly Cell[], random: RandomSource): Cell {
  // Clamped rather than trusted: a stub returning 1 — or 1.0000001 out of a
  // seeded generator — would otherwise index past the end of the list.
  const index = Math.min(cells.length - 1, Math.max(0, Math.floor(random() * cells.length)))
  return cells[index]
}

/** The free cell that would complete a line for `mark`, if playing there
 * would win it the game right now — the same check used both to find the
 * CPU's own winning move and to find the move it must block. */
function winningCellFor(board: readonly Square[], mark: Mark, random: RandomSource): Cell | null {
  const winning = freeCells(board).filter((cell) => {
    const trial = board.slice()
    trial[cell] = mark
    return findWinner(trial) === mark
  })
  if (winning.length === 0) return null
  return pick(winning, random)
}

/**
 * The CPU's next move: take a winning move if one is available, else block
 * the opponent's immediate winning move if one is available, else take any
 * free cell. Ties within a tier are broken via `random`, so a test can pin
 * exactly which cell comes back.
 *
 * Returns `null` when there is no move to make — the game is already over,
 * or the board is full — rather than throwing, since "nothing to play" is an
 * ordinary outcome, not an exceptional one.
 */
export function cpuMove(state: GameState, random: RandomSource = Math.random): Cell | null {
  if (state.isOver) return null

  const mark = state.currentPlayer
  const opponent = otherMark(mark)
  const free = freeCells(state.board)
  if (free.length === 0) return null

  const winning = winningCellFor(state.board, mark, random)
  if (winning !== null) return winning

  const blocking = winningCellFor(state.board, opponent, random)
  if (blocking !== null) return blocking

  return pick(free, random)
}
