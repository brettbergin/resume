/*
 * Which hashes name the `~/tic-tac-toe` page, and nothing else.
 *
 * Modeled on `src/game/route.ts`: tic-tac-toe carries no payload either — a
 * board is not something a link can restore — so `#/tic-tac-toe` is the
 * whole of the route and this module is the one predicate `App.tsx` needs
 * to render it.
 *
 * Kept out of the component anyway, rather than inlined as a string compare,
 * so the route string has exactly one definition — the nav entry in
 * `src/data/routes.ts` and the router in `App.tsx` would otherwise agree only
 * by coincidence.
 */

/** The hash path that selects the tic-tac-toe page. */
export const TIC_TAC_TOE_ROUTE = '/tic-tac-toe'

/**
 * True when `hash` addresses the tic-tac-toe page: `#/tic-tac-toe` or
 * `#/tic-tac-toe/`, optionally carrying a query string the page itself
 * ignores.
 *
 * Matching is on the whole path, not a prefix, so a hash that merely starts
 * with the same letters (`#/tic-tac-toes`) is not the route. The leading `#`
 * and the `#!` of older hash-routing conventions are both stripped, matching
 * what `isSnakeRoute` accepts, because the two routes are reached the same
 * way.
 */
export function isTicTacToeRoute(hash: string): boolean {
  const path = hash.replace(/^#!?/, '').split('?')[0]
  return path === TIC_TAC_TOE_ROUTE || path === `${TIC_TAC_TOE_ROUTE}/`
}
