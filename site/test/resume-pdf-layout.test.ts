import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateSync } from 'node:zlib'

import { describe, expect, it } from 'vitest'

/*
 * Pins the layout of the committed `resume.pdf`, which is rendered by hand and
 * so has no build step to get wrong twice.
 *
 * `resume.html` sets no `font-size` on `body`, so a plain
 * `weasyprint resume.html` render lays the resume out at the CSS-initial 16px
 * base — every text size 8/7 larger than the published resume and two pages
 * more of them. Every published `resume.pdf` has been rendered at a 14px base
 * instead (see the README's regeneration recipe). Nothing else notices: CI's
 * `cmp dist/resume.pdf ../resume.pdf` compares the emitted copy against the
 * root one and `site/vite/resume-pdf.ts` reads that same root file, so both
 * halves move together, and `resume-pdf.test.ts` only checks that the bytes
 * survive the plugin.
 *
 * So the artifact itself is asserted, straight off disk: how many pages it
 * lays out to, and what base size its text is set at. Both are read out of the
 * PDF's own content streams rather than re-rendered here — a test that shelled
 * out to WeasyPrint would need the renderer installed and would only prove the
 * command it ran itself was right, not the file that ships.
 */

const here = dirname(fileURLToPath(import.meta.url))
const rootPdf = readFileSync(resolve(here, '..', '..', 'resume.pdf'))

/**
 * The PDF's Flate-compressed streams, inflated and concatenated. WeasyPrint
 * packs both the page objects and the page content into them, so this is where
 * the page count and the text sizes live; the uncompressed envelope holds
 * neither.
 */
const streams = (pdf: Buffer): string => {
  let text = ''
  let at = 0
  for (;;) {
    // `\nstream` rather than `stream`, so the scan does not stop on the
    // `stream` inside a preceding `endstream`.
    const start = pdf.indexOf('\nstream', at)
    if (start === -1) return text
    let from = start + '\nstream'.length
    if (pdf[from] === 0x0d) from += 1
    if (pdf[from] === 0x0a) from += 1
    const end = pdf.indexOf('\nendstream', from)
    if (end === -1) return text
    // latin1: the inflated bytes are PDF syntax plus glyph indices, and only
    // the syntax is being read.
    text += `${inflateSync(pdf.subarray(from, end)).toString('latin1')}\n`
    at = end + '\nendstream'.length
  }
}

const content = streams(rootPdf)

/** One match per `/Type /Page` object, and none for the `/Pages` tree node. */
const pageCount = (): number =>
  (content.match(/\/Type\s*\/Page(?![a-zA-Z])/g) ?? []).length

/** Every distinct size operand of a `<font> <size> Tf` text-state operator. */
const textSizes = (): number[] => {
  const sizes = [...content.matchAll(/\/[^\s/[\]]+ (\d+(?:\.\d+)?) Tf/g)].map(
    (match) => Number(match[1]),
  )
  return [...new Set(sizes)].sort((a, b) => a - b)
}

describe('committed resume.pdf', () => {
  it('is a PDF', () => {
    expect(rootPdf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
  })

  it('lays out to the published five pages', () => {
    // Seven means it was rendered at the 16px default: same resume, bigger
    // type, two extra pages, the last of them carrying two reference entries.
    expect(pageCount()).toBe(5)
  })

  it('sets its body text at the 14px base', () => {
    // The smallest size on the page is body text; the rest of the scale is
    // derived from it, so this one number fixes the whole render.
    const [base] = textSizes()
    expect(base).toBe(14)
  })

  it('has no text scaled up from a 16px base', () => {
    // The 16px render's scale, size for size: 8/7 of the published one.
    const scaledUp = textSizes().filter((size) =>
      [16, 18.719727, 24, 32].includes(size),
    )
    expect(scaledUp).toEqual([])
  })

  it('carries every project link that resume.md lists', () => {
    // The PDF is rendered by hand from resume.md, so an edit to the source
    // that is not followed by a re-render ships the old content with every
    // other gate still green. The visible text cannot be read back out — the
    // fonts are subset, so the streams hold glyph indices, not letters — but a
    // link's target is stored as a literal ASCII string in its annotation
    // dictionary, and each project's repo name is part of its URL. So the set
    // of URLs is a complete stand-in for the set of projects.
    const md = readFileSync(resolve(here, '..', '..', 'resume.md'), 'utf8')
    // resume.md's only inline links are the project table's `[name](url)`.
    const projects = [...md.matchAll(/\[([^\]]+)\]\((https[^)]+)\)/g)]

    expect(projects.length).toBeGreaterThan(0)
    for (const [, name, url] of projects) {
      expect(content, `${name} is missing from resume.pdf`).toContain(url)
    }
  })
})
