import { describe, expect, it } from 'vitest'

import { SNAKE_ROUTE, isSnakeRoute } from './route.ts'

/*
 * The predicate `App.tsx` routes on, so the cases that matter are the hashes
 * a real address bar produces: the bare route, the one the browser leaves a
 * trailing slash on, and the near-misses that must stay on the resume.
 */
describe('isSnakeRoute', () => {
  it('matches the route, with or without a trailing slash or query', () => {
    expect(isSnakeRoute(`#${SNAKE_ROUTE}`)).toBe(true)
    expect(isSnakeRoute(`#${SNAKE_ROUTE}/`)).toBe(true)
    expect(isSnakeRoute(`#${SNAKE_ROUTE}?x=1`)).toBe(true)
    // The `#!` of older hash-routing conventions, accepted for the same
    // reason the tools route accepts it.
    expect(isSnakeRoute(`#!${SNAKE_ROUTE}`)).toBe(true)
  })

  it('does not match a hash that merely starts the same way', () => {
    expect(isSnakeRoute('#/snakes')).toBe(false)
    expect(isSnakeRoute('#/snake/food')).toBe(false)
  })

  it('does not match the resume anchors or the other route', () => {
    expect(isSnakeRoute('')).toBe(false)
    expect(isSnakeRoute('#')).toBe(false)
    expect(isSnakeRoute('#skills')).toBe(false)
    expect(isSnakeRoute('#/tools')).toBe(false)
  })
})
