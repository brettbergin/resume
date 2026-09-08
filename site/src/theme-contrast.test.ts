import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/*
 * Pins the two halves of issue #11's palette criterion over src/index.css read
 * as text:
 *
 * - Token parity. "The light and dark theme token sets define the same set of
 *   tokens, so neither theme falls back to an undefined value" — every
 *   property the `.dark` block reassigns has to exist in `@theme`, and every
 *   semantic `@theme` property (one whose value is a `var(--color-…)` alias
 *   rather than a literal ramp value) has to be reassigned in `.dark`. A token
 *   added to one block and forgotten in the other is exactly the fallback case.
 *
 * - Contrast. Each semantic token is resolved through the ramps to a concrete
 *   hex and the WCAG 2.x relative-luminance ratio is computed per theme. This
 *   is arithmetic on declared values, not a rendering check: it catches a token
 *   moved down the ramp, and says nothing about what a browser composites (a
 *   translucent overlay, a hover state, an image behind text). Those stay the
 *   human review items in #11's review checklist.
 *
 * Both palettes already satisfy every threshold below, so a failure here means
 * a token moved, not that a threshold is wrong.
 */

const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(resolve(here, 'index.css'), 'utf8')

/*
 * `--color-white` is Tailwind's own default token, not a declaration in this
 * file, so resolution would otherwise dead-end on it. It is seeded here rather
 * than treated as unresolvable; every *other* dangling reference must fail,
 * since that is precisely the "falls back to an undefined value" case.
 */
const TAILWIND_DEFAULTS: Record<string, string> = { '--color-white': '#ffffff' }

/** The custom properties declared directly inside the named block. */
function declarationsIn(selector: string): Map<string, string> {
  // The blocks in this file contain no nested braces, so the first `}` after
  // the opening `{` really is the block's end.
  const block = new RegExp(`${selector}\\s*\\{([^}]*)\\}`).exec(css)
  if (block === null) throw new Error(`no ${selector} block in src/index.css`)

  const declarations = new Map<string, string>()
  for (const [, name, value] of block[1].matchAll(
    /(--[\w-]+)\s*:\s*([^;]+);/g,
  )) {
    declarations.set(name, value.trim())
  }
  return declarations
}

const theme = declarationsIn('@theme')
const dark = declarationsIn('\\.dark')

/** True for a value that is a single `var(--color-…)` alias — i.e. a semantic
 * token pointing at a ramp entry, as opposed to a literal ramp value. */
function aliasTarget(value: string): string | null {
  const alias = /^var\((--color-[\w-]+)\)$/.exec(value)
  return alias === null ? null : alias[1]
}

/**
 * Follow a token through the ramps to a literal hex, failing on any reference
 * that does not resolve. `overrides` is the theme's own `.dark` reassignments,
 * which shadow the `@theme` declaration of the same name.
 */
function resolveToken(name: string, overrides: Map<string, string>): string {
  const seen = new Set<string>()
  let current = name

  for (;;) {
    if (seen.has(current)) throw new Error(`cyclic reference at ${current}`)
    seen.add(current)

    const value =
      overrides.get(current) ?? theme.get(current) ?? TAILWIND_DEFAULTS[current]
    if (value === undefined) {
      throw new Error(`${current} is referenced but never declared`)
    }

    const next = aliasTarget(value)
    if (next === null) {
      if (!/^#[0-9a-f]{6}$/i.test(value)) {
        throw new Error(`${current} resolves to ${value}, not a 6-digit hex`)
      }
      return value.toLowerCase()
    }
    current = next
  }
}

/** WCAG 2.x relative luminance of a `#rrggbb` color. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((at) => {
    const srgb = Number.parseInt(hex.slice(at, at + 2), 16) / 255
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

/** WCAG 2.x contrast ratio between two `#rrggbb` colors, 1:1 to 21:1. */
function contrast(a: string, b: string): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (lighter + 0.05) / (darker + 0.05)
}

/*
 * 4.5:1 is WCAG 2.1 AA 1.4.3 (Contrast Minimum) for body text; 3:1 is AA
 * 1.4.11 (Non-text Contrast) for the visual boundary of a control, which is
 * what `--color-border-strong` exists for. `--color-border` is deliberately
 * absent: it draws decorative rules — the header and footer rules, the
 * timeline, the chips and the three card sections — none of which is the only
 * thing identifying a component.
 */
const PAIRS: { foreground: string; background: string; minimum: number }[] = [
  { foreground: '--color-text', background: '--color-bg', minimum: 4.5 },
  { foreground: '--color-text', background: '--color-surface', minimum: 4.5 },
  { foreground: '--color-muted', background: '--color-bg', minimum: 4.5 },
  { foreground: '--color-muted', background: '--color-surface', minimum: 4.5 },
  { foreground: '--color-accent', background: '--color-bg', minimum: 4.5 },
  { foreground: '--color-accent', background: '--color-surface', minimum: 4.5 },
  {
    foreground: '--color-accent-contrast',
    background: '--color-accent',
    minimum: 4.5,
  },
  { foreground: '--color-border-strong', background: '--color-bg', minimum: 3 },
  {
    foreground: '--color-border-strong',
    background: '--color-surface',
    minimum: 3,
  },
]

/** The light theme takes no overrides; the dark theme takes `.dark`'s. */
const THEMES: { name: string; overrides: Map<string, string> }[] = [
  { name: 'light', overrides: new Map<string, string>() },
  { name: 'dark', overrides: dark },
]

describe('theme tokens', () => {
  it('declares the same token set in both themes', () => {
    // Neither block may be empty, or the parse silently found nothing and
    // every assertion below would hold vacuously.
    expect(theme.size).toBeGreaterThan(0)
    expect(dark.size).toBeGreaterThan(0)

    // Nothing is reassigned in the dark palette that the light one does not
    // declare: a `.dark`-only token has no light value to fall back to.
    for (const name of dark.keys()) {
      expect(theme.has(name), `${name} is set in .dark but not @theme`).toBe(
        true,
      )
    }

    // ...and every semantic token — one aliasing a ramp entry rather than
    // being a ramp entry — gets a dark value, so none is left showing its
    // light value on a dark background.
    const semantic = [...theme].filter(([, value]) => aliasTarget(value))
    expect(semantic.length).toBeGreaterThan(0)
    for (const [name] of semantic) {
      expect(dark.has(name), `${name} is set in @theme but not .dark`).toBe(
        true,
      )
    }
  })

  it('declares --color-border-strong in both palettes', () => {
    expect(theme.get('--color-border-strong')).toBe('var(--color-neutral-500)')
    expect(dark.get('--color-border-strong')).toBe('var(--color-neutral-400)')
  })

  it('declares --color-glow and --color-accent-dim in both palettes', () => {
    /*
     * The two tokens the glow and specular treatments read. They are pinned
     * here rather than left to the parity case above because `--color-glow`
     * is a `color-mix()` literal, not a `var(--color-…)` alias, so the
     * "every semantic token is reassigned in .dark" rule does not reach it:
     * dropping it from `.dark` would silently leave the dark theme glowing
     * in the light accent.
     */
    for (const token of ['--color-glow', '--color-accent-dim']) {
      expect(theme.has(token), `${token} is missing from @theme`).toBe(true)
      expect(dark.has(token), `${token} is missing from .dark`).toBe(true)
      expect(
        theme.get(token),
        `${token} has the same value in both palettes`,
      ).not.toBe(dark.get(token))
    }

    // The glow is a shadow color and nothing else, so it carries alpha and is
    // exempt from the contrast pairs below; keep it that way.
    expect(theme.get('--color-glow')).toContain('transparent')
    expect(dark.get('--color-glow')).toContain('transparent')

    // The specular gradient stop stays a ramp alias, so it resolves.
    expect(aliasTarget(theme.get('--color-accent-dim') ?? '')).not.toBe(null)
    expect(aliasTarget(dark.get('--color-accent-dim') ?? '')).not.toBe(null)
  })

  it('resolves every semantic token through the ramps in both themes', () => {
    for (const { name, overrides } of THEMES) {
      for (const [token, value] of theme) {
        if (!aliasTarget(value)) continue
        expect(
          resolveToken(token, overrides),
          `${token} in the ${name} theme`,
        ).toMatch(/^#[0-9a-f]{6}$/)
      }
    }
  })

  it('fails a token that references an undeclared property', () => {
    // The guard the resolution above rests on: an alias pointing at nothing
    // must throw rather than quietly yield a color.
    expect(() => resolveToken('--color-nonexistent', new Map())).toThrow(
      /never declared/,
    )
  })

  it.each(THEMES)('meets WCAG AA contrast in the $name theme', ({
    overrides,
  }) => {
    expect(PAIRS.length).toBeGreaterThan(0)

    for (const { foreground, background, minimum } of PAIRS) {
      const ratio = contrast(
        resolveToken(foreground, overrides),
        resolveToken(background, overrides),
      )
      expect(ratio, `${foreground} on ${background}`).toBeGreaterThanOrEqual(
        minimum,
      )
    }
  })

  it('exercises both themes', () => {
    // `it.each` above runs per theme; if THEMES were ever trimmed to one, the
    // contrast case would still pass while checking half the palette.
    expect(THEMES.map(({ name }) => name)).toEqual(['light', 'dark'])
  })
})
