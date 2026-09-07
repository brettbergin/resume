import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { summary } from '../src/data/resume.ts'
import { resumePdf } from '../vite/resume-pdf.ts'

/*
 * The download link is only as good as the asset behind it, and neither half
 * of that is exercised by rendering a component: the file has to be emitted
 * into `dist/` under the name the href is built from, and the dev server has
 * to serve it under the same base so the link can be clicked before deploy.
 *
 * Both hooks are driven directly with stand-in `config`/`server`/`req`/`res`
 * objects — a real build or dev server would cost seconds per assertion and
 * test Vite rather than this plugin. What the real build produces is checked
 * once, by ci.yml's "Compare emitted PDF with the repo-root one" step, which
 * runs `cmp dist/resume.pdf ../resume.pdf` after the build.
 */

const here = dirname(fileURLToPath(import.meta.url))
const siteDir = resolve(here, '..')

/** The base the site is really built with; see `vite.config.ts`. */
const base = '/resume/'
const fileName = summary.resumePdfFileName
const rootPdf = readFileSync(resolve(siteDir, '..', fileName))

interface EmittedAsset {
  type: string
  fileName: string
  source: Uint8Array
}

type Handler = (this: unknown, ...args: unknown[]) => unknown

/** Vite hooks are declared as either a function or `{ handler }`; ours are
 * plain functions, but the declared type covers both. */
const call = (hook: unknown, self: unknown, ...args: unknown[]): unknown => {
  const fn = (
    typeof hook === 'function' ? hook : (hook as { handler: unknown }).handler
  ) as Handler
  return fn.apply(self, args)
}

/** A plugin that has seen the resolved config, as it would in a real build. */
const configured = () => {
  const plugin = resumePdf()
  call(plugin.configResolved, plugin, { root: siteDir, base })
  return plugin
}

/** Runs `generateBundle` against a fake plugin context and returns what it
 * asked Rollup to emit. */
const emit = (): EmittedAsset[] => {
  const emitted: EmittedAsset[] = []
  const context = {
    emitFile: (file: EmittedAsset) => {
      emitted.push(file)
      return 'ref'
    },
  }
  call(configured().generateBundle, context, {}, {}, false)
  return emitted
}

interface Served {
  headers: Record<string, string>
  body?: Uint8Array
  nextCalled: boolean
}

/** Registers the dev middleware, sends it one request, and reports what came
 * back. */
const request = (url: string): Served => {
  const handlers: unknown[] = []
  const server = { middlewares: { use: (fn: unknown) => handlers.push(fn) } }
  call(configured().configureServer, undefined, server)
  // One handler, so the plugin cannot quietly grow a second one that shadows
  // this one's behaviour.
  expect(handlers).toHaveLength(1)

  const served: Served = { headers: {}, nextCalled: false }
  const res = {
    setHeader: (name: string, value: string) => {
      served.headers[name.toLowerCase()] = value
    },
    end: (body?: Uint8Array) => {
      served.body = body
    },
  }
  call(
    handlers[0],
    undefined,
    { url },
    res,
    () => {
      served.nextCalled = true
    },
  )
  return served
}

describe('resume-pdf build output', () => {
  it('emits the PDF under the name the data module declares', () => {
    const [asset, ...rest] = emit()
    expect(asset?.type).toBe('asset')
    expect(asset?.fileName).toBe(summary.resumePdfFileName)
    expect(rest).toHaveLength(0)
  })

  it('emits the repo-root PDF byte for byte', () => {
    const [asset] = emit()
    // Compared as a number so a mismatch prints a verdict rather than a
    // 267KB diff.
    expect(Buffer.compare(Buffer.from(asset!.source), rootPdf)).toBe(0)
  })
})

describe('resume-pdf dev server', () => {
  it('serves the PDF at the URL the href resolves to', () => {
    const served = request(`${base}${fileName}`)
    expect(served.nextCalled).toBe(false)
    expect(served.headers['content-type']).toBe('application/pdf')
    expect(Buffer.compare(Buffer.from(served.body!), rootPdf)).toBe(0)
  })

  it('ignores a query string on that URL', () => {
    const served = request(`${base}${fileName}?download=1`)
    expect(served.nextCalled).toBe(false)
    expect(served.headers['content-type']).toBe('application/pdf')
  })

  it('leaves every other request to the rest of the stack', () => {
    const served = request(`${base}index.html`)
    expect(served.nextCalled).toBe(true)
    expect(served.body).toBeUndefined()
    expect(served.headers).toEqual({})
  })
})
