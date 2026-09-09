import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/*
 * The `~/tools` page's entire premise is that a real token, certificate or
 * private key can be pasted into it, because nothing leaves the browser. That
 * promise is made in prose on the page, so it needs a mechanical check behind
 * it: one accidental request — a telemetry ping, a "look up this issuer" call
 * added for convenience — turns the page from safe into actively dangerous,
 * and no amount of review catches that reliably over time.
 *
 * This is a *source* assertion. Intercepting network calls at runtime would
 * only cover the code paths a test happens to exercise, whereas the property
 * wanted here is that the capability is not referenced at all. The cost is
 * that a comment mentioning one of these names fails the check too, which is
 * the right way round: the names are cheap to avoid in prose.
 */

const here = dirname(fileURLToPath(import.meta.url))

/** Both halves of the page: the tool implementations and the components that
 * draw them. The promise is about the whole route, and a pane is as capable
 * of phoning home as a parser is — a "report this decode" button in the UI
 * would break the guarantee just as thoroughly. */
const SOURCE_ROOTS = [
  { prefix: 'src/tools', directory: resolve(here, '../src/tools') },
  {
    prefix: 'src/components/tools',
    directory: resolve(here, '../src/components/tools'),
  },
]

/** Every network-capable global a browser hands a module. Matched as plain
 * text: a source file has no business naming any of them. */
const NETWORK_APIS = [
  'fetch(',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'sendBeacon',
]

const networkApisIn = (source: string): string[] =>
  NETWORK_APIS.filter((api) => source.includes(api))

/** Every file under a root, recursively, as a path relative to it — the
 * vendored parsers in subdirectories are held to the same rule. */
function collect(directory: string, prefix = ''): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    return entry.isDirectory()
      ? collect(join(directory, entry.name), path)
      : [path]
  })
}

/** The roots that exist. Either may be absent — the components arrived after
 * the tools, and a step that has one but not the other should still get the
 * check over what it does have rather than an error from `readdirSync`. */
const presentRoots = SOURCE_ROOTS.filter(({ directory }) =>
  existsSync(directory),
)

const toolSources = presentRoots.flatMap(({ prefix, directory }) =>
  collect(directory).map((path) => ({
    path: `${prefix}/${path}`,
    source: readFileSync(join(directory, path), 'utf8'),
  })),
)

it('has tool sources to check', () => {
  // Guards the sweep itself, the way test/layout-contract.test.ts guards its
  // own: a rename or a moved directory must not turn this into a pass.
  expect(toolSources.map((file) => file.path)).toContain('src/tools/types.ts')
  expect(toolSources.length).toBeGreaterThan(2)
  // And guards each root's contribution: a root that is on disk but sweeps to
  // nothing is a broken walk, not an empty directory worth tolerating.
  for (const { prefix } of presentRoots) {
    expect(
      toolSources.filter((file) => file.path.startsWith(`${prefix}/`)),
    ).not.toHaveLength(0)
  }
})

describe.each(toolSources)('$path', ({ source }) => {
  it('references no network API', () => {
    expect(networkApisIn(source)).toEqual([])
  })
})

it('flags a source that reaches for the network', () => {
  // Synthetic regression coverage: the real sources are clean, so only a
  // made-up one can prove the detection fires at all. Each name is assembled
  // by concatenation so this file does not contain the literals it forbids.
  const badSource = [
    `await ${'fet' + 'ch('}'/api')`,
    `new ${'XMLHttp' + 'Request'}()`,
    `new ${'Web' + 'Socket'}('wss://x')`,
    `new ${'Event' + 'Source'}('/x')`,
    `navigator.${'send' + 'Beacon'}('/x')`,
  ].join('\n')

  expect(networkApisIn(badSource)).toHaveLength(NETWORK_APIS.length)
  expect(networkApisIn('const output = hexdump(bytes)')).toEqual([])
})
