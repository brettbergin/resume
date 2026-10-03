import { describe, expect, it } from 'vitest'

import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  createInitialState,
  placeFood,
  tick,
  type Cell,
  type GameState,
} from './engine.ts'

/*
 * The boards here are built by hand and are small — 5x5, sometimes 3x3 — so
 * every assertion can name the cell it expects rather than deriving it from
 * the same arithmetic the engine uses. The default 20x20 board is checked only
 * where the default itself is the subject.
 *
 * Every test that can reach food placement passes its own random source, so
 * nothing in here depends on `Math.random`. `() => 0` picks the first free
 * cell in row-major order, which on these boards is a cell the test can write
 * down.
 */

const zero = () => 0

/** A game positioned mid-play: whatever the test needs, with the rest left at
 * the engine's defaults for a 5x5 board. */
function state(overrides: Partial<GameState> & { snake: readonly Cell[] }): GameState {
  return {
    width: 5,
    height: 5,
    direction: 'right',
    food: null,
    score: 0,
    alive: true,
    ...overrides,
  }
}

describe('createInitialState', () => {
  it('starts one snake segment in the middle of the default board, alive', () => {
    const game = createInitialState({ random: zero })

    expect(game.width).toBe(BOARD_WIDTH)
    expect(game.height).toBe(BOARD_HEIGHT)
    expect(game.snake).toEqual([{ x: 10, y: 10 }])
    expect(game.score).toBe(0)
    expect(game.alive).toBe(true)
  })

  it('places the first food off the snake, from the given random source', () => {
    const game = createInitialState({ random: zero })

    expect(game.food).toEqual({ x: 0, y: 0 })
    expect(game.snake).not.toContainEqual(game.food)
  })
})

describe('moving', () => {
  it('advances one cell per tick in the current direction', () => {
    const start = state({ snake: [{ x: 1, y: 1 }], direction: 'right' })

    const once = tick(start)
    expect(once.snake).toEqual([{ x: 2, y: 1 }])

    const twice = tick(once)
    expect(twice.snake).toEqual([{ x: 3, y: 1 }])
  })

  it('turns when asked, and keeps the new direction on later ticks', () => {
    const start = state({ snake: [{ x: 1, y: 1 }], direction: 'right' })

    const turned = tick(start, 'down')
    expect(turned.snake[0]).toEqual({ x: 1, y: 2 })
    expect(turned.direction).toBe('down')
    expect(tick(turned).snake[0]).toEqual({ x: 1, y: 3 })
  })

  it('moves the whole body along, leaving the length unchanged', () => {
    const start = state({
      snake: [
        { x: 2, y: 1 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ],
      direction: 'right',
    })

    const next = tick(start)
    expect(next.snake).toEqual([
      { x: 3, y: 1 },
      { x: 2, y: 1 },
      { x: 1, y: 1 },
    ])
  })

  it('leaves the score alone on a tick that eats nothing', () => {
    const start = state({ snake: [{ x: 1, y: 1 }], food: { x: 4, y: 4 }, score: 3 })

    expect(tick(start).score).toBe(3)
    expect(tick(start).food).toEqual({ x: 4, y: 4 })
  })
})

describe('eating', () => {
  const start = state({
    snake: [
      { x: 2, y: 2 },
      { x: 1, y: 2 },
    ],
    direction: 'right',
    food: { x: 3, y: 2 },
    score: 1,
  })

  it('grows the snake by one segment, keeping the tail in place', () => {
    const next = tick(start, undefined, zero)

    expect(next.snake).toEqual([
      { x: 3, y: 2 },
      { x: 2, y: 2 },
      { x: 1, y: 2 },
    ])
  })

  it('increases the score', () => {
    expect(tick(start, undefined, zero).score).toBe(2)
  })

  it('spawns new food away from the grown snake', () => {
    const next = tick(start, undefined, zero)

    expect(next.food).toEqual({ x: 0, y: 0 })
    expect(next.snake).not.toContainEqual(next.food)
  })

  it('stays alive and does not eat the same food twice', () => {
    const next = tick(start, undefined, zero)

    expect(next.alive).toBe(true)
    expect(tick(next, undefined, zero).score).toBe(2)
  })
})

describe('food placement', () => {
  it('never lands on a cell the snake occupies, whatever the random source', () => {
    // Every cell of a 3x3 board but (2, 2) is snake, so a placement that did
    // not consult the snake would land on one of the eight almost every time.
    const snake: Cell[] = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 1 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
      { x: 0, y: 2 },
      { x: 1, y: 2 },
    ]

    for (let draw = 0; draw < 100; draw += 1) {
      const food = placeFood(snake, () => draw / 100, 3, 3)
      expect(food).toEqual({ x: 2, y: 2 })
    }
  })

  it('spreads over the free cells as the random source moves', () => {
    const snake: Cell[] = [{ x: 0, y: 0 }]

    expect(placeFood(snake, () => 0, 2, 2)).toEqual({ x: 1, y: 0 })
    expect(placeFood(snake, () => 0.5, 2, 2)).toEqual({ x: 0, y: 1 })
    // A source that returns 1 is out of contract — [0, 1) — but indexing past
    // the last free cell would be worse than clamping to it.
    expect(placeFood(snake, () => 1, 2, 2)).toEqual({ x: 1, y: 1 })
  })

  it('has nowhere to go once the snake covers the board', () => {
    const snake: Cell[] = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ]

    expect(placeFood(snake, zero, 2, 2)).toBeNull()
  })
})

describe('ending the game', () => {
  it('ends on the wall rather than throwing', () => {
    const start = state({ snake: [{ x: 4, y: 2 }], direction: 'right' })

    const next = tick(start)
    expect(next.alive).toBe(false)
    expect(next.snake).toEqual([{ x: 4, y: 2 }])
  })

  it('ends at each of the four edges', () => {
    expect(tick(state({ snake: [{ x: 0, y: 2 }], direction: 'left' })).alive).toBe(false)
    expect(tick(state({ snake: [{ x: 2, y: 0 }], direction: 'up' })).alive).toBe(false)
    expect(tick(state({ snake: [{ x: 2, y: 4 }], direction: 'down' })).alive).toBe(false)
    expect(tick(state({ snake: [{ x: 4, y: 2 }], direction: 'right' })).alive).toBe(false)
  })

  it('ends when the head runs into the body', () => {
    const start = state({
      snake: [
        { x: 2, y: 1 },
        { x: 2, y: 2 },
        { x: 1, y: 2 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ],
      direction: 'left',
      food: { x: 4, y: 4 },
    })

    const next = tick(start)
    expect(next.alive).toBe(false)
    expect(next.score).toBe(0)
  })

  it('allows the head into the cell the tail is leaving', () => {
    const start = state({
      snake: [
        { x: 2, y: 1 },
        { x: 2, y: 2 },
        { x: 1, y: 2 },
        { x: 1, y: 1 },
      ],
      direction: 'left',
      food: { x: 4, y: 4 },
    })

    const next = tick(start)
    expect(next.alive).toBe(true)
    expect(next.snake[0]).toEqual({ x: 1, y: 1 })
  })

  it('ignores further ticks once the game is over', () => {
    const dead = tick(state({ snake: [{ x: 4, y: 2 }], direction: 'right' }))

    expect(tick(dead, 'up')).toBe(dead)
  })
})

describe('reversing direction', () => {
  const start = state({
    snake: [
      { x: 2, y: 2 },
      { x: 1, y: 2 },
      { x: 0, y: 2 },
    ],
    direction: 'right',
    food: { x: 4, y: 4 },
  })

  it('ignores a turn straight back into the neck instead of ending the game', () => {
    const next = tick(start, 'left')

    expect(next.alive).toBe(true)
    expect(next.direction).toBe('right')
    expect(next.snake[0]).toEqual({ x: 3, y: 2 })
  })

  it('still accepts the perpendicular turns', () => {
    expect(tick(start, 'up').snake[0]).toEqual({ x: 2, y: 1 })
    expect(tick(start, 'down').snake[0]).toEqual({ x: 2, y: 3 })
  })

  it('lets a one-segment snake turn around, having no neck to hit', () => {
    const single = state({ snake: [{ x: 2, y: 2 }], direction: 'right' })

    const next = tick(single, 'left')
    expect(next.alive).toBe(true)
    expect(next.snake[0]).toEqual({ x: 1, y: 2 })
  })
})
