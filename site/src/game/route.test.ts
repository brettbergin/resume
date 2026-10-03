import { describe, expect, it } from 'vitest'

import { GAME_ROUTE, isGameRoute } from './route.ts'

/*
 * The predicate `App.tsx` routes on, so the cases that matter are the hashes
 * a real address bar produces: the bare route, the one the browser leaves a
 * trailing slash on, and the near-misses that must stay on the resume.
 */
describe('isGameRoute', () => {
  it('matches the route, with or without a trailing slash or query', () => {
    expect(isGameRoute(`#${GAME_ROUTE}`)).toBe(true)
    expect(isGameRoute(`#${GAME_ROUTE}/`)).toBe(true)
    expect(isGameRoute(`#${GAME_ROUTE}?x=1`)).toBe(true)
    // The `#!` of older hash-routing conventions, accepted for the same
    // reason the tools route accepts it.
    expect(isGameRoute(`#!${GAME_ROUTE}`)).toBe(true)
  })

  it('does not match a hash that merely starts the same way', () => {
    expect(isGameRoute('#/gamepad')).toBe(false)
    expect(isGameRoute('#/game/snake')).toBe(false)
  })

  it('does not match the resume anchors or the other route', () => {
    expect(isGameRoute('')).toBe(false)
    expect(isGameRoute('#')).toBe(false)
    expect(isGameRoute('#skills')).toBe(false)
    expect(isGameRoute('#/tools')).toBe(false)
  })
})
