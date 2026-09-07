/*
 * Regenerates the three committed image assets in `public/`:
 * `favicon.svg` (hand-authored, only read here), `apple-touch-icon.png` and
 * `og-image.png`.
 *
 * The two PNGs are committed rather than built, because they have to be
 * fetchable by crawlers that never run the build — but a committed binary is
 * exactly the thing that goes stale, so the generator that produces it is
 * committed alongside and is re-runnable: `npm run generate:images` rewrites
 * both, byte for byte, from `src/data/site.ts` and `src/data/resume.ts`. Same
 * reasoning as `vite/resume-pdf.ts`, one step further — that plugin avoids a
 * second copy of the PDF entirely; here a second copy is unavoidable, so the
 * next best thing is that the copy can always be re-derived and compared.
 *
 * No text is retyped: the card's name, job title, location and GitHub URL all
 * come from the data modules, so editing the resume changes the social
 * preview.
 *
 * Determinism is the property that makes the above worth anything, and it is
 * why the render is set up the way it is. Inter is read out of
 * `node_modules/@fontsource-variable/inter` — the same typeface the site
 * loads, pinned by the lockfile — and handed to resvg as the only font in its
 * database with `loadSystemFonts: false`. With system fonts on, the bytes
 * would depend on which fonts the machine running this happens to have, and
 * CI would produce a different card than a laptop. There is deliberately no
 * headless browser or system rasteriser in the pipeline for the same reason.
 *
 * Run with plain `node`: Node 24 strips the types itself, and both tsconfigs
 * set `erasableSyntaxOnly` so nothing in here can grow syntax it cannot strip.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Resvg } from '@resvg/resvg-js'
import { decompress } from 'wawoff2'

import { contact, summary } from '../src/data/resume.ts'
import { site } from '../src/data/site.ts'

const here = dirname(fileURLToPath(import.meta.url))
const siteDir = resolve(here, '..')
const publicDir = resolve(siteDir, 'public')

/** The variable Inter the site itself loads, latin subset, upright. */
const interWoff2 = resolve(
  siteDir,
  'node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2',
)

/* The card's palette, written as the literals `src/index.css` resolves the
 * dark theme's custom properties to. The card is always dark: it is shown on
 * someone else's surface, and a dark card reads as deliberate against both a
 * light and a dark chat client. */
const background = site.themeColorDark
const accent = '#2563eb' /* --color-brand-600 */
const accentText = '#60a5fa' /* --color-brand-400 */
const mutedText = '#9ca3af' /* --color-neutral-400 */

/** Every edge of the card is croppable — Slack, Discord and X each trim a
 * different amount — so nothing is drawn outside this inset. */
const margin = 80

/** `&`, `<` and the quote characters are the only ones that can break out of
 * a text node or an attribute in the templates below. Resume content is
 * unlikely to contain them, which is precisely why it would be missed. */
const escapeXml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

/** The GitHub URL as a person reads it: no scheme, no trailing slash. Derived
 * rather than retyped so it cannot drift from `contact.githubUrl`. */
const githubLabel = contact.githubUrl
  .replace(/^https?:\/\//, '')
  .replace(/\/$/, '')

/*
 * The card. Laid out in absolute user units at the final 1200x630 so the
 * numbers below are the pixels that ship.
 *
 * Baselines, top to bottom: the accent rule sits above the name as a masthead
 * rule; the name is the one thing that survives every thumbnail size, so it
 * gets ~84px; the job title reads as the subtitle in brand blue; the contact
 * line is muted and sits well clear of the bottom crop.
 *
 * There are no `font-weight` attributes because they would be dead markup:
 * resvg renders a variable font at its default instance only, so every weight
 * from 100 to 900 produces byte-identical output with this Inter (verified by
 * rendering the same string at 400 and 700). The name gets its semibold
 * emphasis from a 2px same-colour stroke instead — a hairline outline on an
 * 84px glyph, which is what a faux-bold is.
 */
const ogSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${site.ogImageWidth}" height="${site.ogImageHeight}" viewBox="0 0 ${site.ogImageWidth} ${site.ogImageHeight}">
  <rect width="${site.ogImageWidth}" height="${site.ogImageHeight}" fill="${background}" />
  <rect x="${margin}" y="140" width="140" height="10" rx="5" fill="${accent}" />
  <g font-family="Inter Variable" fill="#ffffff">
    <text x="${margin}" y="268" font-size="84" stroke="#ffffff" stroke-width="2">${escapeXml(summary.name)}</text>
    <text x="${margin}" y="336" font-size="40" fill="${accentText}">${escapeXml(summary.title)}</text>
    <text x="${margin}" y="480" font-size="26" fill="${mutedText}">${escapeXml(contact.location)}</text>
    <text x="${margin}" y="520" font-size="26" fill="${mutedText}">${escapeXml(githubLabel)}</text>
  </g>
</svg>
`

/**
 * resvg takes fonts as file paths, not buffers, and the packaged Inter is
 * WOFF2, which it cannot read. `decompress` unwraps the WOFF2 container back
 * into the SFNT it holds; the TTF is scratch, so it goes to the OS temp dir
 * rather than into the repo.
 */
const unpackFont = async (): Promise<string> => {
  const ttf = await decompress(readFileSync(interWoff2))
  const ttfPath = join(tmpdir(), 'resume-site-inter-latin-wght-normal.ttf')
  writeFileSync(ttfPath, ttf)
  return ttfPath
}

const renderPng = (svg: string, width: number, fontPath: string): Buffer =>
  new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    font: {
      fontFiles: [fontPath],
      // The whole point: render from the pinned Inter and nothing else, so
      // the output does not depend on the machine.
      loadSystemFonts: false,
      defaultFontFamily: 'Inter Variable',
    },
  })
    .render()
    .asPng()

const write = (fileName: string, bytes: Buffer): void => {
  const target = resolve(publicDir, fileName)
  writeFileSync(target, bytes)
  console.log(`wrote public/${fileName} (${bytes.length} bytes)`)
}

const fontPath = await unpackFont()

write(site.ogImageFileName, renderPng(ogSvg, site.ogImageWidth, fontPath))

// The iOS home-screen icon is the favicon at 180x180 rather than a second
// drawing, so the two cannot drift. 180 is the size iOS asks for; it
// downsamples from there for the smaller slots.
const faviconSvg = readFileSync(resolve(publicDir, 'favicon.svg'), 'utf8')

write(site.appleTouchIconFileName, renderPng(faviconSvg, 180, fontPath))
