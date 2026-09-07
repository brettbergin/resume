/*
 * Publishes the repo-root `resume.pdf` as part of the built site.
 *
 * README.md calls the root PDF the source of truth, and GitHub Pages only
 * publishes `site/dist`, so the hero's "Download PDF" link needs the root file
 * to end up in the bundle. Copying it into `site/public/` would work, but it
 * would commit a second 267KB binary that silently goes stale the next time
 * the root one is regenerated — a wrong PDF is worse than a missing one. So
 * the file is read from the repo root at build time instead: one copy in git,
 * one copy in `dist/`, no way for them to disagree.
 *
 * The emitted name is `summary.resumePdfFileName`, the same value the hero
 * joins with `import.meta.env.BASE_URL` to build the href, and it is emitted
 * unhashed so that href stays a constant.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'

import type { Plugin } from 'vite'

import { summary } from '../src/data/resume.ts'

const fileName = summary.resumePdfFileName

export function resumePdf(): Plugin {
  // Filled in by `configResolved`, which is the only hook guaranteed to see
  // the merged config. Resolving the source from `import.meta.url` would not
  // work: Vite bundles this config into a timestamped temp file, so that URL
  // is not a stable anchor. `config.root` is `site/`, so the repo root — and
  // the PDF — is one level up.
  let sourcePath = ''
  let base = '/'

  const read = (): Buffer => readFileSync(sourcePath)

  return {
    name: 'resume-pdf',

    configResolved(config) {
      sourcePath = resolve(config.root, '..', fileName)
      base = config.base
    },

    generateBundle() {
      this.emitFile({ type: 'asset', fileName, source: read() })
    },

    // `npm run dev` serves under the same `/resume/` base as production, and
    // nothing else puts the root PDF on the dev server, so the link would 404
    // during the manual responsive checks. Serve the same bytes here.
    configureServer(server) {
      server.middlewares.use(
        (
          req: IncomingMessage,
          res: ServerResponse,
          next: (error?: unknown) => void,
        ) => {
          const path = (req.url ?? '').split('?')[0]
          if (path !== `/${fileName}` && path !== `${base}${fileName}`) {
            next()
            return
          }
          res.setHeader('Content-Type', 'application/pdf')
          res.end(read())
        },
      )
    },
  }
}
