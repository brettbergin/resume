import { describe, expect, it } from 'vitest'

import { TIC_TAC_TOE_ROUTE, isTicTacToeRoute } from './route.ts'

/*
 * The predicate `App.tsx` routes on, so the cases that matter are the hashes
 * a real address bar produces: the bare route, the one the browser leaves a
 * trailing slash on, and the near-misses that must stay on the resume.
 */
describe('isTicTacToeRoute', () => {
  it('matches the route, with or without a trailing slash or query', () => {
    expect(isTicTacToeRoute(`#${TIC_TAC_TOE_ROUTE}`)).toBe(true)
    expect(isTicTacToeRoute(`#${TIC_TAC_TOE_ROUTE}/`)).toBe(true)
    expect(isTicTacToeRoute(`#${TIC_TAC_TOE_ROUTE}?x=1`)).toBe(true)
    // The `#!` of older hash-routing conventions, accepted for the same
    // reason the snake route accepts it.
    expect(isTicTacToeRoute(`#!${TIC_TAC_TOE_ROUTE}`)).toBe(true)
  })

  it('does not match a hash that merely starts the same way', () => {
    expect(isTicTacToeRoute('#/tic-tac-toes')).toBe(false)
    expect(isTicTacToeRoute('#/tic-tac-toe/extra')).toBe(false)
  })

  it('does not match the resume anchors or the other routes', () => {
    expect(isTicTacToeRoute('')).toBe(false)
    expect(isTicTacToeRoute('#')).toBe(false)
    expect(isTicTacToeRoute('#skills')).toBe(false)
    expect(isTicTacToeRoute('#/tools')).toBe(false)
    expect(isTicTacToeRoute('#/snake')).toBe(false)
  })
})
