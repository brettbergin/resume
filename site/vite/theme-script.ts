/*
 * Generates the pre-paint theme script that index.html needs in <head>,
 * before the first paint reaches <body>.
 *
 * A classic (non-module) <script> can't import, so this is the one place the
 * script's text is allowed to retype getInitialTheme()'s precedence — a
 * valid stored choice wins, otherwise the OS preference decides. Everything
 * that branch reads (the storage key, the media query, the dark
 * theme-color) comes from THEME_STORAGE_KEY/DARK_QUERY in src/theme.ts and
 * site.themeColorDark in src/data/site.ts rather than being retyped a second
 * time here, so those can never drift from their real source the way a copy
 * hand-written in index.html could.
 */

import type { Plugin } from 'vite'

import { site } from '../src/data/site.ts'
import { DARK_QUERY, THEME_STORAGE_KEY } from '../src/theme.ts'

/**
 * The script body, ready to inline. Render-blocking on purpose: index.html's
 * placeholder comment explains why the tag this is inlined into must not
 * carry type="module", defer or async.
 */
export function themeScriptBody(): string {
  return `(function () {
  var stored = null
  try {
    stored = window.localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})
  } catch (error) {
    // Storage unavailable; fall through to the OS preference.
  }
  if (
    stored === 'dark' ||
    (stored !== 'light' &&
      window.matchMedia(${JSON.stringify(DARK_QUERY)}).matches)
  ) {
    document.documentElement.classList.add('dark')
    var themeColor = document.querySelector('meta[name="theme-color"]')
    if (themeColor) {
      themeColor.setAttribute('content', ${JSON.stringify(site.themeColorDark)})
    }
  }
})()`
}

/** Injects the pre-paint theme script into <head>, at both `vite build` and
 * `vite dev`/`vite preview` — `transformIndexHtml` runs in both. */
export function themeScript(): Plugin {
  return {
    name: 'theme-script',
    transformIndexHtml: {
      // `pre` so this runs — and its tag lands in <head> — ahead of Vite's
      // own build-html plugin, which is what injects the bundle's
      // `<script type="module">`/stylesheet tags. Without it, the build
      // (unlike dev) would place the app bundle tag before this one.
      order: 'pre',
      handler() {
        return [
          {
            tag: 'script',
            injectTo: 'head',
            children: themeScriptBody(),
          },
        ]
      },
    },
  }
}
