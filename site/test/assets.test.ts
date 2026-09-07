import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { site } from '../src/data/site.ts'

/*
 * The committed image assets, checked as artefacts rather than as source.
 * `scripts/generate-images.ts` produces them, but the files in `public/` are
 * what actually ships — a crawler fetches the PNG, it never runs the
 * generator — so what is asserted here is the bytes on disk.
 *
 * Everything a wrong image costs is silent: a card that is not 1200x630 gets
 * letterboxed or cropped by every consumer, an apple-touch-icon that is not
 * 180x180 gets resampled into mush on the home screen, and a favicon still
 * carrying Vite's default logo just looks like nobody finished the site.
 * None of it fails a build or shows up in a diff you can read.
 *
 * The dimensions are read straight out of the PNG's IHDR chunk instead of
 * shelling out to a tool: `file` and ImageMagick are not dependencies of this
 * project and are not installed in CI, and the header is a dozen bytes at a
 * fixed offset. See the PNG spec, ss 5.2-5.3: an 8-byte signature, then the
 * IHDR chunk whose width and height are big-endian u32 at offsets 16 and 20.
 */

const here = dirname(fileURLToPath(import.meta.url))
const publicDir = resolve(here, '../public')

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

interface Png {
  bytes: Buffer
  width: number
  height: number
}

/** Reads a PNG's declared size out of its header, asserting it is a PNG
 * first — otherwise a truncated or wrong-format file reads as a plausible
 * pair of numbers rather than failing. */
const readPng = (fileName: string): Png => {
  const bytes = readFileSync(resolve(publicDir, fileName))
  expect(bytes.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true)
  return {
    bytes,
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  }
}

describe('og-image.png', () => {
  const png = readPng(site.ogImageFileName)

  it('is the 1200x630 the meta tags declare', () => {
    // Asserted against `site.ts` rather than against literals so the tags and
    // the file cannot be changed apart.
    expect(png.width).toBe(site.ogImageWidth)
    expect(png.height).toBe(site.ogImageHeight)
    expect(png.width).toBe(1200)
    expect(png.height).toBe(630)
  })

  it('stays small enough to preview quickly', () => {
    // X's hard limit is 5MB, but a card holding four lines of text has no
    // business being anywhere near that; a megabyte means something went in
    // that should not have, like a photo or an unoptimised export.
    expect(png.bytes.length).toBeLessThan(1024 * 1024)
  })
})

describe('apple-touch-icon.png', () => {
  const png = readPng(site.appleTouchIconFileName)

  it('is the 180x180 iOS asks for', () => {
    expect(png.width).toBe(180)
    expect(png.height).toBe(180)
  })
})

describe('favicon.svg', () => {
  const svg = readFileSync(resolve(publicDir, 'favicon.svg'), 'utf8')

  it('is an SVG with a viewBox', () => {
    // Without a viewBox the icon does not scale to the many sizes a browser
    // and iOS ask it for.
    expect(svg).toContain('<svg')
    expect(svg).toMatch(/viewBox="0 0 \d+ \d+"/)
  })

  it('is drawn in the brand colour', () => {
    expect(svg.toLowerCase()).toContain('#2563eb')
  })

  it('is not Vite\'s default logo any more', () => {
    // The scaffold ships a purple bolt; this is the colour that gives it away.
    expect(svg.toLowerCase()).not.toContain('#863bff')
  })
})
