/*
 * Site-level metadata: the strings the SEO and social-preview tags need.
 *
 * None of this is rendered by React, and that is the point. Link-preview
 * crawlers (Slack, Discord, iMessage, X) and most indexers fetch the HTML and
 * read it without executing JavaScript, so a `<meta>` tag injected at runtime
 * is invisible to them — the shared link falls back to a bare URL. The
 * literal tags in `index.html` are therefore the deliverable, and this module
 * is what pins the values they duplicate: the image generator, `robots.txt`
 * and `sitemap.xml` read from here too, and `site.test.ts` asserts the tags
 * and this module still agree.
 *
 * `title` is built from `summary` in `resume.ts` rather than retyped so a
 * change to the name or job title propagates. `description` is not: the
 * professional summary is ~700 characters and every consumer truncates well
 * short of that, so the preview blurb is written for the ~155-character
 * budget it actually gets.
 */

import { summary } from './resume.ts'

/** Deployed URL of the site. Absolute, https, trailing slash — the same
 * project-page URL that `base` in `vite.config.ts` and the Live URL rows in
 * both READMEs name, and the base every absolute URL below is built on.
 * Crawlers reject a relative `og:image`, which is the usual reason a preview
 * shows text but no picture. */
const url = 'https://brettbergin.github.io/resume/'

const ogImageFileName = 'og-image.png'

export const site = {
  url,

  /** `<title>` and `og:title`. Kept under ~60 characters so search results
   * and preview cards show it whole. */
  title: `${summary.name} — ${summary.title}`,

  /** `<meta name="description">` and `og:description`. */
  description:
    'Senior application security engineer with 10+ years building vulnerability management, DevSecOps, and cloud security programs at enterprise scale.',

  /** Static social card in `public/`, published at the site root. */
  ogImageFileName,
  /** Absolute URL of the card — relative ones are silently ignored. */
  ogImageUrl: `${url}${ogImageFileName}`,
  /** The 1200x630 the card is drawn at, declared to consumers so they can
   * reserve the right aspect ratio before the image loads. */
  ogImageWidth: 1200,
  ogImageHeight: 630,
  ogImageAlt: `Social preview card reading “${summary.name} — ${summary.title}”`,

  /** iOS home-screen icon in `public/`, published at the site root. */
  appleTouchIconFileName: 'apple-touch-icon.png',

  /** `theme-color`, one per palette, so mobile browser chrome matches the
   * page instead of guessing. These are `--color-bg` as each palette in
   * `src/index.css` resolves it: `--color-white` for light,
   * `--color-neutral-950` for dark. */
  themeColorLight: '#ffffff',
  themeColorDark: '#0a0a0a',
} as const
