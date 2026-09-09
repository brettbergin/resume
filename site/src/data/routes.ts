/*
 * The routes the header links to, as opposed to the sections it scrolls to.
 *
 * There is one today — `~/tools`, the security toolbox — and it is listed
 * here rather than in `sections.ts` because the two are not the same kind of
 * link. A section id is an on-page anchor: `App.tsx` renders an element with
 * that id, the nav's `#skills` scrolls to it, and `App.test.tsx` asserts that
 * every same-page `#`-link resolves to an element id. A route names a view
 * that *replaces* the sections, so nothing on the page ever carries `/tools`
 * as an id and that assertion would fail the moment a route was smuggled into
 * the section registry.
 *
 * The header renders these after the section links, inside the same navs, so
 * the page keeps exactly one navigation landmark at each width.
 */

import type { RouteLink } from './types.ts'

export const routes: readonly RouteLink[] = [
  { id: 'tools', label: '~/tools', href: '#/tools' },
] as const
