/*
 * Which hashes name the `~/snake` page, and nothing else.
 *
 * `src/tools/fragment.ts` is the sibling of this file, and it is much bigger
 * for one reason: the tools page keeps its whole state — the tool, the input,
 * the options — in the fragment, so it needs an encoder and a parser. The game
 * carries no payload. A board is not something a link can restore, and the
 * score is not worth sharing mid-run, so `#/snake` is the whole of the route and
 * this module is the one predicate `App.tsx` needs to render it.
 *
 * Kept out of the component anyway, rather than inlined as a string compare,
 * so the route string has exactly one definition — the nav entry in
 * `src/data/routes.ts` and the router in `App.tsx` would otherwise agree only
 * by coincidence.
 */

/** The hash path that selects the game page. */
export const SNAKE_ROUTE = '/snake'

/**
 * True when `hash` addresses the game page: `#/snake` or `#/snake/`, optionally
 * carrying a query string the page itself ignores.
 *
 * Matching is on the whole path, not a prefix, so a hash that merely starts
 * with the same letters (`#/snakes`) is not the game route. The leading `#`
 * and the `#!` of older hash-routing conventions are both stripped, matching
 * what `isToolsRoute` accepts, because the two routes are reached the same way.
 */
export function isSnakeRoute(hash: string): boolean {
  const path = hash.replace(/^#!?/, '').split('?')[0]
  return path === SNAKE_ROUTE || path === `${SNAKE_ROUTE}/`
}
