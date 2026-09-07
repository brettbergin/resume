import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { summary } from '../src/data/resume.ts'
import { site } from '../src/data/site.ts'

/*
 * The SEO and social-preview tags in `index.html`, pinned against the values
 * `src/data/site.ts` declares.
 *
 * The tags have to be literals in the HTML — crawlers fetch the document and
 * read it without running the bundle — so the strings are duplicated out of
 * `site.ts`, and duplication is what rots. This is the same arrangement the
 * inline theme script has with `theme.ts` in `test/index-html.test.ts`, and it
 * fails the same way if either half moves alone: a title that no longer
 * matches the page, a description that was updated in one place, an `og:image`
 * that quietly went relative and shows as a preview with no picture.
 *
 * The head is parsed into a lookup keyed by `name`/`property`/`rel` rather
 * than grepped for whole tags: asserting on a hand-written attribute string
 * would break on a reformat that changed nothing a crawler sees.
 */

const here = dirname(fileURLToPath(import.meta.url))
const siteDir = resolve(here, '..')
const publicDir = resolve(siteDir, 'public')

const html = readFileSync(resolve(siteDir, 'index.html'), 'utf8')
const head = html.slice(html.indexOf('<head'), html.indexOf('</head>'))

/** The attributes of one tag, as a plain lookup. Values are HTML-decoded for
 * the entities a `content` attribute realistically carries. */
const parseAttributes = (source: string): Record<string, string> => {
  const attributes: Record<string, string> = {}
  for (const match of source.matchAll(/([\w:-]+)="([^"]*)"/g)) {
    attributes[match[1]] = match[2]
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&')
  }
  return attributes
}

/** Every `<meta>` and `<link>` in <head>, keyed by whichever attribute names
 * it: `name` for the plain metas and Twitter's, `property` for Open Graph
 * (which is RDFa, not HTML metadata), `rel` for the links. */
const collect = (tagName: string, keys: string[]): Record<string, Record<string, string>> => {
  const byKey: Record<string, Record<string, string>> = {}
  for (const match of head.matchAll(
    new RegExp(`<${tagName}\\b([^>]*)>`, 'g'),
  )) {
    const attributes = parseAttributes(match[1])
    const key = keys.map((candidate) => attributes[candidate]).find(Boolean)
    if (key !== undefined) byKey[key] = attributes
  }
  return byKey
}

const metas = collect('meta', ['name', 'property'])
const links = collect('link', ['rel'])

/** `<title>` as the parser sees it: one element, its text. */
const title = /<title>([\s\S]*?)<\/title>/.exec(head)?.[1].trim()

/** The content of a meta tag, or undefined if the tag is missing — so a
 * missing tag fails as `undefined`, not as an exception in the helper. */
const content = (key: string): string | undefined => metas[key]?.content

describe('index.html metadata', () => {
  describe('page identity', () => {
    it('has the title site.ts declares', () => {
      expect(title).toBe(site.title)
      // The placeholder the Vite scaffold ships.
      expect(title).not.toBe('site')
    })

    it('has the description site.ts declares', () => {
      expect(content('description')).toBe(site.description)
    })

    it('canonicalises to the deployed URL', () => {
      // A canonical pointing anywhere but the Pages URL splits the indexing of
      // the site between two addresses.
      expect(links['canonical']?.href).toBe(site.url)
    })
  })

  describe('open graph', () => {
    it('declares a website with the site name', () => {
      expect(content('og:type')).toBe('website')
      expect(content('og:site_name')).toBe(summary.name)
    })

    it('repeats the title, description and url', () => {
      expect(content('og:title')).toBe(site.title)
      expect(content('og:description')).toBe(site.description)
      expect(content('og:url')).toBe(site.url)
    })

    it('points at the card by absolute URL', () => {
      // Relative image URLs are silently dropped by most consumers, which is
      // the usual cause of a preview that shows text and no picture.
      expect(content('og:image')).toBe(site.ogImageUrl)
      expect(content('og:image')).toMatch(/^https:\/\//)
      expect(content('og:image')).toBe(
        'https://brettbergin.github.io/resume/og-image.png',
      )
    })

    it('declares the card dimensions and alt text', () => {
      // Strings, because that is what an attribute is; the numbers come from
      // site.ts so the tags cannot drift from the generated PNG.
      expect(content('og:image:width')).toBe(String(site.ogImageWidth))
      expect(content('og:image:height')).toBe(String(site.ogImageHeight))
      expect(content('og:image:alt')).toBe(site.ogImageAlt)
    })
  })

  describe('twitter card', () => {
    it('asks for the large card', () => {
      // Without this X renders the small square card and crops the 1200x630
      // image to junk.
      expect(content('twitter:card')).toBe('summary_large_image')
    })

    it('repeats the title and description', () => {
      expect(content('twitter:title')).toBe(site.title)
      expect(content('twitter:description')).toBe(site.description)
    })

    it('points at the card by absolute URL', () => {
      expect(content('twitter:image')).toBe(site.ogImageUrl)
      expect(content('twitter:image')).toMatch(/^https:\/\//)
    })
  })

  describe('icons', () => {
    it('keeps the SVG favicon', () => {
      expect(links['icon']?.type).toBe('image/svg+xml')
      expect(links['icon']?.href).toBe('/favicon.svg')
    })

    it('links the apple touch icon published in public/', () => {
      // Root-relative on purpose: Vite rewrites these for the /resume/ base at
      // build time, so a hand-written prefix would double it.
      expect(links['apple-touch-icon']?.href).toBe(
        `/${site.appleTouchIconFileName}`,
      )
    })
  })

  describe('mobile', () => {
    it('keeps the viewport tag byte-for-byte', () => {
      // Without it mobile browsers render a zoomed-out desktop layout, and it
      // is exactly the line that gets lost while reworking a head.
      expect(content('viewport')).toBe('width=device-width, initial-scale=1.0')
    })

    it('declares the light palette background as theme-color', () => {
      expect(content('theme-color')).toBe(site.themeColorLight)
    })

    it('declares theme-color before the inline theme script', () => {
      // The script updates this tag as it applies the theme, and
      // querySelector only finds an element the parser has already reached.
      const themeColorAt = head.indexOf('name="theme-color"')
      const scriptAt = head.indexOf('<script')

      expect(themeColorAt).toBeGreaterThan(-1)
      expect(scriptAt).toBeGreaterThan(themeColorAt)
    })
  })
})

/*
 * `public/robots.txt` and `public/sitemap.xml`, pinned the same way the head
 * is. Vite copies `public/` verbatim, so unlike everything else in the site
 * these two files cannot interpolate `site.ts` — the URLs in them are typed
 * out, and typed-out URLs are what silently point at the wrong host after a
 * move. The assertions below are the only thing connecting them back.
 */
describe('crawler files in public/', () => {
  const robots = readFileSync(resolve(publicDir, 'robots.txt'), 'utf8')
  const sitemap = readFileSync(resolve(publicDir, 'sitemap.xml'), 'utf8')

  describe('robots.txt', () => {
    it('allows every crawler everything', () => {
      expect(robots).toMatch(/^User-agent: \*$/m)
      expect(robots).toMatch(/^Allow: \/$/m)
      expect(robots).not.toMatch(/^Disallow: \/\s*$/m)
    })

    it('points at the sitemap by absolute URL', () => {
      // Relative Sitemap: lines are invalid — the directive is defined as an
      // absolute URL, and the site URL it hangs off lives in site.ts.
      const line = /^Sitemap: (.+)$/m.exec(robots)?.[1]

      expect(line).toBe(`${site.url}sitemap.xml`)
    })

    it('records why the file is inert on a project page', () => {
      // The caveat is the reason this file is not a lie: crawlers fetch
      // robots.txt from the origin root only, and this site is a project page
      // under /resume/ on an origin whose root is served elsewhere. Losing the
      // comment would leave a file that looks like it controls crawling.
      expect(robots).toMatch(/^#/)
      expect(robots).toMatch(/origin root/)
      expect(robots).toMatch(/custom domain/)
    })
  })

  describe('sitemap.xml', () => {
    it('is a sitemaps.org 0.9 urlset', () => {
      expect(sitemap).toContain(
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      )
    })

    it('lists the site URL and nothing else', () => {
      // One page, in-page anchors for navigation; a fragment is not a
      // separate URL, so a second entry here would be a duplicate.
      const locs = [...sitemap.matchAll(/<loc>([^<]*)<\/loc>/g)].map(
        (match) => match[1],
      )

      expect(locs).toEqual([site.url])
    })

    it('carries no lastmod', () => {
      // Deliberate: nothing in this repo would keep a hardcoded date honest,
      // and a date frozen at the day the file was written is worse than none.
      expect(sitemap).not.toContain('<lastmod>')
    })
  })
})
