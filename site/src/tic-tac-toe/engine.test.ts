import { describe, expect, it } from 'vitest'

import {
  applyMove,
  cpuMove,
  createInitialState,
  findWinner,
  type GameState,
  type Square,
} from './engine.ts'

/*
 * Boards here are built by hand as flat 9-element arrays, row-major, so every
 * assertion can name the exact cell index (0 top-left through 8 bottom-right)
 * it expects rather than deriving it from the same arithmetic the engine
 * uses. Every test that reaches `cpuMove`'s tie-break passes its own
 * `RandomSource`, so nothing in here depends on `Math.random`.
 */

const zero = () => 0

const X: Square = 'X'
const O: Square = 'O'
const _ = null

/** A game positioned mid-play: whatever the test needs, with the rest left
 * at an in-progress default. */
function state(overrides: Partial<GameState> & { board: readonly Square[] }): GameState {
  return {
    currentPlayer: 'X',
    winner: null,
    isOver: false,
    ...overrides,
  }
}

describe('createInitialState', () => {
  it('starts with an empty board, X to move, nobody having won', () => {
    const game = createInitialState()

    expect(game.board).toEqual([_, _, _, _, _, _, _, _, _])
    expect(game.currentPlayer).toBe('X')
    expect(game.winner).toBeNull()
    expect(game.isOver).toBe(false)
  })
})

describe('findWinner', () => {
  it('detects each of the three rows', () => {
    expect(findWinner([X, X, X, _, _, _, _, _, _])).toBe('X')
    expect(findWinner([_, _, _, O, O, O, _, _, _])).toBe('O')
    expect(findWinner([_, _, _, _, _, _, X, X, X])).toBe('X')
  })

  it('detects each of the three columns', () => {
    expect(findWinner([X, _, _, X, _, _, X, _, _])).toBe('X')
    expect(findWinner([_, O, _, _, O, _, _, O, _])).toBe('O')
    expect(findWinner([_, _, X, _, _, X, _, _, X])).toBe('X')
  })

  it('detects each of the two diagonals', () => {
    expect(findWinner([X, _, _, _, X, _, _, _, X])).toBe('X')
    expect(findWinner([_, _, O, _, O, _, O, _, _])).toBe('O')
  })

  it('finds no winner on an empty or partial board', () => {
    expect(findWinner([_, _, _, _, _, _, _, _, _])).toBeNull()
    expect(findWinner([X, O, X, _, O, _, _, _, X])).toBeNull()
  })
})

describe('applyMove', () => {
  it('places the mark and hands the turn to the other player', () => {
    const start = createInitialState()

    const next = applyMove(start, 4, 'X')
    expect(next.board[4]).toBe('X')
    expect(next.currentPlayer).toBe('O')
    expect(next.isOver).toBe(false)
  })

  it('ends the game with a winner once a move completes a line', () => {
    const start = state({ board: [X, X, _, O, O, _, _, _, _] })

    const next = applyMove(start, 2, 'X')
    expect(next.winner).toBe('X')
    expect(next.isOver).toBe(true)
  })

  it('detects a draw: the board is full with no winning line', () => {
    const start = state({
      board: [X, O, X, X, O, O, O, X, _],
      currentPlayer: 'X',
    })

    const next = applyMove(start, 8, 'X')
    expect(next.winner).toBeNull()
    expect(next.isOver).toBe(true)
  })

  it('rejects a move onto an already-occupied cell', () => {
    const start = state({ board: [X, _, _, _, _, _, _, _, _] })

    const next = applyMove(start, 0, 'O')
    expect(next).toBe(start)
    expect(next.board[0]).toBe('X')
  })

  it('rejects any move once the game has ended', () => {
    const over = state({
      board: [X, X, X, O, O, _, _, _, _],
      winner: 'X',
      isOver: true,
    })

    const next = applyMove(over, 5, 'O')
    expect(next).toBe(over)
  })
})

describe('cpuMove', () => {
  it('takes a winning move when one is available', () => {
    // X has two in the top row and an empty third cell: taking it wins
    // immediately, which must outrank any block or free-cell choice.
    const start = state({ board: [X, X, _, O, O, _, _, _, _], currentPlayer: 'X' })

    expect(cpuMove(start, zero)).toBe(2)
  })

  it('blocks the opponent immediate winning move when it cannot win itself', () => {
    // O has two in the left column; X has no line of its own to complete, so
    // the only acceptable move is the block at cell 6.
    const start = state({ board: [O, X, _, O, _, _, _, _, X], currentPlayer: 'X' })

    expect(cpuMove(start, zero)).toBe(6)
  })

  it('picks a free cell, via the random source, when no win or block exists', () => {
    const start = state({ board: [X, O, _, _, _, _, _, _, _], currentPlayer: 'X' })

    // `zero` always picks the first free cell in index order.
    expect(cpuMove(start, zero)).toBe(2)
  })

  it('breaks ties among equally free cells using the injected random source', () => {
    const start = createInitialState()

    expect(cpuMove(start, () => 0)).toBe(0)
    expect(cpuMove(start, () => 1)).toBe(8)
  })

  it('prefers winning over blocking when both are available', () => {
    // X can win at 2 (completing the top row) and must also block O's
    // column at 7, but the win takes priority.
    const start = state({
      board: [X, X, _, O, _, _, O, _, X],
      currentPlayer: 'X',
    })

    expect(cpuMove(start, zero)).toBe(2)
  })

  it('returns null once the game is already over', () => {
    const over = state({
      board: [X, X, X, O, O, _, _, _, _],
      winner: 'X',
      isOver: true,
    })

    expect(cpuMove(over, zero)).toBeNull()
  })
})
