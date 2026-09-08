import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/*
 * Pins the "rice" contract — the neon accent's glow, the 3D card tilt and the
 * hover sweep — over src/index.css and the component sources read as text.
 *
 * WHAT THIS SUITE CAN CHECK, in the style of test/layout-contract.test.ts:
 * that each treatment is *declared* where it has to be. The four utilities
 * exist in index.css with the pieces that make them work (the perspective, the
 * custom properties the hook writes, the two pseudo-elements); the glows are
 * scoped to `.dark`, so light mode is the printable variant rather than a
 * dimmer copy of the dark one; the single `prefers-reduced-motion` block names
 * the tilt and the sweep and neutralises both; and the components that are
 * supposed to carry each class actually carry it.
 *
 * The one exception, at the bottom of the file, is arithmetic rather than a
 * source pin: the sweep bar is a translucent overlay painted between a
 * control's background and its label, so the contrast pair it creates exists
 * in no palette token and src/theme-contrast.test.ts — which is arithmetic on
 * declared tokens and says so — cannot see it. Those cases composite the
 * band's own centre stop and opacity over each palette's fills and measure
 * what is left.
 *
 * WHAT IT CANNOT CHECK: anything about rendering. These tests run in jsdom,
 * which applies no stylesheet at all — Tailwind never runs, `@utility` output
 * never exists, and `getComputedStyle` on a `tilt-card` element reports the
 * initial value for every property in this file. A "the card is rotated"
 * assertion here would pass whether or not index.css declared the transform,
 * which is the vacuous pass this suite exists to avoid. So it asserts source
 * text, on purpose.
 *
 * Consequently these stay human/e2e checks, not assertions here:
 *   - that the halo, the tilt and the sweep actually *look* right;
 *   - the pointer story — tilt on a mouse, nothing on a touch screen (that is
 *     src/useTilt.ts's `(hover: none)` early return, covered behaviourally in
 *     src/useTilt.test.ts);
 *   - what a browser composites under `prefers-reduced-motion` — this file
 *     proves the rules are written, e2e/responsive.spec.ts drives a real one.
 */

const here = dirname(fileURLToPath(import.meta.url))
const siteDir = resolve(here, '..')

const css = readFileSync(resolve(siteDir, 'src/index.css'), 'utf8')

/** A brace-matched block, from the first `{` after `header` to the `}` that
 * closes it. Unlike src/theme-contrast.test.ts's palette parser this counts
 * depth, because the utilities and the media query below all nest. */
function blockAfter(header: RegExp, label: string): { at: number; body: string } {
  const match = header.exec(css)
  if (match === null) throw new Error(`no ${label} in src/index.css`)

  const open = css.indexOf('{', match.index)
  let depth = 0
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1
    else if (css[i] === '}') {
      depth -= 1
      if (depth === 0) return { at: match.index, body: css.slice(open + 1, i) }
    }
  }
  throw new Error(`unbalanced braces in ${label}`)
}

const utility = (name: string) =>
  blockAfter(new RegExp(`@utility\\s+${name}\\b`), `@utility ${name}`)

const reducedMotion = blockAfter(
  /@media\s*\(prefers-reduced-motion:\s*reduce\)/,
  'the prefers-reduced-motion block',
)

const theme = blockAfter(/@theme\b/, 'the @theme block')
const darkPalette = blockAfter(/^\.dark\s*\{/m, 'the .dark palette block')

describe('the glow utilities', () => {
  it.each(['glow-text', 'glow-ring'])('%s is defined', (name) => {
    expect(utility(name).body.trim()).not.toBe('')
  })

  it('paints the halo as a shadow, not a fill', () => {
    // Both are exempt from the contrast pairs precisely because they are
    // shadows: a glow that fails 4.5:1 is a dim glow, not unreadable text.
    expect(utility('glow-text').body).toContain('text-shadow:')
    expect(utility('glow-ring').body).toContain('box-shadow:')
  })

  it.each(['glow-text', 'glow-ring'])(
    '%s is scoped to .dark, so light mode paints no glow',
    (name) => {
      const body = utility(name).body

      // The same predicate `@custom-variant dark` uses at the top of the file,
      // so the utility can be written unprefixed in a component and simply
      // does nothing in light mode.
      expect(body).toContain('.dark')
      // And the shadow is *inside* that scope rather than a sibling of it.
      const scope = body.indexOf('.dark')
      expect(body.indexOf('shadow:')).toBeGreaterThan(scope)
    },
  )
})

describe('the tilt-card utility', () => {
  const body = utility('tilt-card').body

  it('owns the perspective, so no component writes it as an arbitrary value', () => {
    // test/layout-contract.test.ts keeps magic numbers out of the shell's
    // source; `perspective(800px)` is one, and it lives here.
    expect(body).toContain('perspective(800px)')
    expect(body).toMatch(/rotateX\(var\(--tilt-y\)\)/)
    expect(body).toMatch(/rotateY\(var\(--tilt-x\)\)/)
  })

  it.each(['--tilt-x', '--tilt-y', '--spec-x', '--spec-y'])(
    'declares a rest value for %s',
    (property) => {
      // src/useTilt.ts writes these four and nothing else. Declaring them here
      // means a card is correct before the first pointer event, and stays
      // correct where the hook deliberately never runs: a touch screen, or a
      // reader who asked for reduced motion.
      expect(body).toMatch(new RegExp(`${property}\\s*:`))
    },
  )

  it('draws the specular as an ::after radial gradient', () => {
    expect(body).toContain('&::after')
    expect(body).toContain('radial-gradient(')
    expect(body).toMatch(/circle at var\(--spec-x\) var\(--spec-y\)/)
  })
})

describe('the sweep utility', () => {
  const body = utility('sweep').body

  it('translates a ::before bar across the control on hover and focus', () => {
    expect(body).toContain('&::before')
    // Parked off to the left at rest, crossing the control on hover/focus.
    expect(body).toContain('translateX(-100%)')
    expect(body).toContain('translateX(100%)')
    expect(body).toMatch(/&:hover::before/)
    expect(body).toMatch(/&:focus-visible::before/)
    expect(body).toMatch(/transition:\s*transform/)
  })

  it('gates the hover clause behind (hover: hover), and only that clause', () => {
    /*
     * Mobile Safari and Android Chrome apply `:hover` to the element you just
     * tapped, so an ungated `&:hover::before` runs the full 600ms band across
     * a hero CTA on a tap — the case the treatment excludes ("touch devices:
     * no tilt, no sweep"). Every Tailwind `hover:` variant on those same
     * controls is compiled inside this query; hand-written CSS in an
     * `@utility` bypasses that gate unless it writes the query itself.
     *
     * Nothing else in the suite would catch the regression: `:hover` is the
     * only pointer assumption in this file that jsdom cannot evaluate and
     * that src/useTilt.test.ts's `(hover: none)` cases do not cover.
     */
    const hoverGate = blockAfter(
      /@media\s*\(hover:\s*hover\)/,
      'the (hover: hover) block in @utility sweep',
    )

    // Inside the utility, not somewhere else in the file.
    const sweep = utility('sweep')
    expect(hoverGate.at).toBeGreaterThan(sweep.at)
    expect(hoverGate.body).toMatch(/&:hover::before/)
    expect(hoverGate.body).toMatch(/translateX\(100%\)/)

    // ...and the hover clause exists *only* there: a second, ungated one
    // would still fire on tap.
    expect(body.match(/&:hover::before/g)).toHaveLength(1)

    // Keyboard focus is not a hovering pointer — a phone with a Bluetooth
    // keyboard matches `(hover: none)` and still moves focus — so the
    // focus-visible clause stays outside the query.
    expect(hoverGate.body).not.toContain('focus-visible')
    expect(body).toMatch(/&:focus-visible::before/)
  })

  it('crosses once: the 600ms is on the crossing, not on the return', () => {
    // A plain `transition: transform 600ms` on the rest state animates the
    // bar *back* across the label on every pointer-out, which is a second
    // crossing right to left. site/README.md's manual check documents one
    // crossing, left to right; keeping the duration on the hover/focus
    // clauses is what makes the two agree.
    const rest = /&::before\s*\{[\s\S]*?transition:\s*transform\s+([\d.]+m?s)/.exec(
      body,
    )
    expect(rest).not.toBeNull()
    expect(Number.parseFloat(rest?.[1] ?? '1')).toBe(0)

    // Both crossing clauses, and nothing else, carry the duration.
    expect(body.match(/transition-duration:\s*600ms/g)).toHaveLength(2)
  })
})

describe('the reduced-motion block', () => {
  it('is the only one in the file, so the contract is greppable in one place', () => {
    expect(css.match(/prefers-reduced-motion/g)).toHaveLength(1)
  })

  it('sits outside the @theme and .dark palette blocks', () => {
    // src/theme-contrast.test.ts reads the first block of each to its first
    // `}`; a media query inside either would be parsed as the palette.
    expect(reducedMotion.at).toBeGreaterThan(theme.at)
    expect(reducedMotion.at).toBeGreaterThan(darkPalette.at)
  })

  it('collapses transitions instead of leaving them at their full duration', () => {
    expect(reducedMotion.body).toMatch(/transition-duration:\s*0\.01ms/)
  })

  it('names tilt-card and gives it no transform', () => {
    expect(reducedMotion.body).toContain('.tilt-card')
    expect(reducedMotion.body).toMatch(/\.tilt-card\s*\{[^}]*transform:\s*none/)
  })

  it('holds the tilt-card specular at rest', () => {
    // On the pseudo-element, because the hook writes --spec-x/--spec-y as an
    // inline style on the card and an inline style beats a stylesheet rule on
    // that same element.
    expect(reducedMotion.body).toMatch(
      /\.tilt-card::after\s*\{[^}]*--spec-x:\s*50%[^}]*--spec-y:\s*50%/,
    )
  })

  it('names sweep and never translates its bar', () => {
    expect(reducedMotion.body).toContain('.sweep')

    const sweepRule = /\.sweep::before[\s\S]*?\{([^}]*)\}/.exec(
      reducedMotion.body,
    )
    expect(sweepRule).not.toBeNull()
    // Parked off-canvas, in every state: the hover and focus selectors are
    // pulled back to the same rest position rather than left to cross.
    expect(sweepRule?.[1]).toContain('translateX(-100%)')
    expect(sweepRule?.[1]).not.toContain('translateX(100%)')
    expect(reducedMotion.body).toContain('.sweep:hover::before')
    expect(reducedMotion.body).toContain('.sweep:focus-visible::before')
  })

  it('leaves the glow alone', () => {
    // The glow is static paint, not movement. Switching it off would take the
    // dark palette's identity from a reader who only asked not to be moved.
    expect(reducedMotion.body).not.toContain('text-shadow')
    expect(reducedMotion.body).not.toContain('box-shadow')
  })
})

/*
 * The component half: which sources have to carry which class. Comments are
 * stripped first — several of these files discuss `sweep` and `overflow-hidden`
 * in prose, and a doc comment naming a utility is not the same as a class list
 * applying it.
 */

const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const RICE_COMPONENTS = [
  'src/components/AchievementsSection.tsx',
  'src/components/ExperienceEntry.tsx',
  'src/components/ExperienceSection.tsx',
  'src/components/Header.tsx',
  'src/components/HeroSection.tsx',
  'src/components/ProjectCard.tsx',
  'src/components/SkillsSection.tsx',
] as const

const sources = new Map(
  RICE_COMPONENTS.map((path) => [
    path,
    stripComments(readFileSync(resolve(siteDir, path), 'utf8')),
  ]),
)

it('has rice component sources to check', () => {
  // Guards the list itself: a rename or a moved file must fail loudly here
  // rather than turning every check below into a vacuous pass. readFileSync
  // already throws on a missing path; this pins that the list is non-empty and
  // that stripping comments left real source behind.
  expect(sources.size).toBe(RICE_COMPONENTS.length)
  expect(sources.size).toBeGreaterThan(0)
  for (const source of sources.values()) {
    expect(source).toContain('className')
  }
})

/** The source of one rice component, comments removed. */
const sourceOf = (path: (typeof RICE_COMPONENTS)[number]): string => {
  const source = sources.get(path)
  if (source === undefined) throw new Error(`${path} was not read`)
  return source
}

describe('the glow classes the components carry', () => {
  it('blooms the hero h1', () => {
    const h1 = /<h1\b[\s\S]*?(?<!=)>/.exec(sourceOf('src/components/HeroSection.tsx'))
    expect(h1).not.toBeNull()
    expect(h1?.[0]).toContain('glow-text')
  })

  it('blooms the achievement metric callout', () => {
    // The pulled-out figure, whose class list is the file's METRIC constant.
    expect(sourceOf('src/components/AchievementsSection.tsx')).toMatch(
      /const METRIC\s*=\s*\n?\s*['"`]glow-text/,
    )
  })

  /* Every source that renders an `<h2>`: the five sections that own their own
   * heading, plus App.tsx, whose `sectionBody` has a `default:` branch that
   * renders one for a section id no case handles yet. That branch is
   * unreachable today — every id in src/data/sections.ts has a real case — but
   * it is the heading a seventh section would get, and a heading the page
   * renders without the halo is the one visible exception to the treatment. */
  const HEADING_SOURCES = [
    'src/App.tsx',
    'src/components/AchievementsSection.tsx',
    'src/components/ContactSection.tsx',
    'src/components/ExperienceSection.tsx',
    'src/components/ProjectsSection.tsx',
    'src/components/SkillsSection.tsx',
  ] as const

  it.each(HEADING_SOURCES)('blooms every <h2> in %s', (path) => {
    const source = stripComments(readFileSync(resolve(siteDir, path), 'utf8'))
    // `(?<!=)>` so an arrow function inside the tag's attributes cannot end it.
    const headings = [...source.matchAll(/<h2\b[\s\S]*?(?<!=)>/g)]

    expect(headings.length).toBeGreaterThan(0)
    for (const [tag] of headings) expect(tag).toContain('glow-text')
  })

  it.each([
    'src/components/ProjectCard.tsx',
    'src/components/HeroSection.tsx',
    'src/components/ExperienceSection.tsx',
    'src/components/ExperienceEntry.tsx',
  ] as const)('halos %s on hover and on keyboard focus', (path) => {
    const source = sourceOf(path)

    // Additive to the shared FOCUS_RING, never a replacement for it: the ring
    // is an `outline` and this is a `box-shadow`, so the two compose.
    expect(source).toContain('hover:glow-ring')
    expect(source).toContain('focus-visible:glow-ring')
    expect(source).toContain('FOCUS_RING')
  })
})

describe('the tilt classes the components carry', () => {
  it.each([
    'src/components/ProjectCard.tsx',
    'src/components/AchievementsSection.tsx',
    'src/components/SkillsSection.tsx',
  ] as const)('%s tilts its cards', (path) => {
    expect(sourceOf(path)).toContain('tilt-card')
    // The hook that feeds the four custom properties the utility reads.
    expect(sourceOf(path)).toContain('useTilt')
  })
})

/** Every class-list string literal in a source that names `token` — a
 * template literal or a quoted string, comments already stripped. */
const classListsNaming = (source: string, token: string): string[] =>
  [...source.matchAll(/`[^`]*`|'[^']*'|"[^"]*"/g)]
    .map((match) => match[0])
    .filter((literal) => new RegExp(`(^|[\\s\`'"])${token}([\\s\`'"]|$)`).test(literal))

describe('the sweep classes the components carry', () => {
  it.each([
    'src/components/HeroSection.tsx',
    'src/components/Header.tsx',
  ] as const)('%s sweeps its controls and clips the bar', (path) => {
    const lists = classListsNaming(sourceOf(path), 'sweep')

    expect(lists.length).toBeGreaterThan(0)
    for (const list of lists) {
      // `overflow-hidden` is what keeps the bar inside the pill. It clips the
      // bar only — FOCUS_RING is an `outline` drawn outside the border box, so
      // the ring still reads at full size.
      expect(list).toContain('overflow-hidden')
      expect(list).toContain('FOCUS_RING')
    }
  })

  it('never leaves a swept nav link on the muted label color', () => {
    // The nav link is the one swept control whose rest label is `text-muted`,
    // and muted over the band's peak measures 4.11:1 light / 2.85:1 dark —
    // under the 4.5:1 floor the composite cases above hold the accent and
    // `--color-text` to. So both states that run the sweep move the label.
    for (const list of classListsNaming(
      sourceOf('src/components/Header.tsx'),
      'sweep',
    )) {
      expect(list).toContain('hover:text-accent')
      expect(list).toContain('focus-visible:text-accent')
    }
  })
})


/*
 * What a browser composites while the bar is over a label. src/index.css's
 * palette suite is arithmetic on declared tokens and says so — it cannot see a
 * translucent overlay — but the sweep *is* a translucent overlay painted
 * between a control's background and its text, so the pair it creates has to
 * be computed somewhere. This is that somewhere: token values read from
 * src/index.css, the bar's own core stop and opacity read from the utility,
 * and the primary CTA's `hover:opacity-90` read from the component that
 * declares it, composited in that order and measured against WCAG 2.1 AA
 * 1.4.3's 4.5:1 for 16px text.
 */
describe("the sweep bar's composite contrast", () => {
  const declarationsIn = (block: string): Map<string, string> =>
    new Map(
      [...block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(([, name, value]) => [
        name,
        value.trim(),
      ]),
    )

  const lightTokens = declarationsIn(theme.body)
  const darkTokens = declarationsIn(darkPalette.body)

  /** An sRGB color plus the alpha it is painted at. */
  type Paint = { rgb: number[]; alpha: number }

  /** Follow a token through the ramps, through `.dark`'s overrides first.
   * `--color-white` is Tailwind's own default, not a declaration here. */
  const paintOf = (name: string, overrides: Map<string, string>, depth = 0): Paint => {
    if (depth > 16) throw new Error(`cyclic reference at ${name}`)

    const value =
      overrides.get(name) ??
      lightTokens.get(name) ??
      (name === '--color-white' ? '#ffffff' : undefined)
    if (value === undefined) throw new Error(`${name} is never declared`)

    const alias = /^var\((--color-[\w-]+)\)$/.exec(value)
    if (alias !== null) return paintOf(alias[1], overrides, depth + 1)

    // The alpha'd tokens: `color-mix(in srgb, var(--color-…) N%, transparent)`.
    const mixed =
      /^color-mix\(\s*in srgb,\s*var\((--color-[\w-]+)\)\s*([\d.]+)%,\s*transparent\s*\)$/.exec(
        value,
      )
    if (mixed !== null) {
      const base = paintOf(mixed[1], overrides, depth + 1)
      return { rgb: base.rgb, alpha: base.alpha * (Number(mixed[2]) / 100) }
    }

    if (!/^#[0-9a-f]{6}$/i.test(value)) {
      throw new Error(`${name} resolves to ${value}, which is not a color`)
    }
    return {
      rgb: [1, 3, 5].map((at) => Number.parseInt(value.slice(at, at + 2), 16)),
      alpha: 1,
    }
  }

  /** `over` painted on `under` at `alpha`, source-over in sRGB. */
  const composite = (over: Paint, under: number[], alpha = over.alpha): number[] =>
    over.rgb.map((channel, at) => alpha * channel + (1 - alpha) * under[at])

  const luminance = (rgb: number[]): number => {
    const channels = rgb.map((value) => {
      const srgb = value / 255
      return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
  }

  const contrast = (a: number[], b: number[]): number => {
    const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x)
    return (lighter + 0.05) / (darker + 0.05)
  }

  const sweep = utility('sweep')
  const darkScopeAt = sweep.body.indexOf(':where(.dark')

  /** Whatever the gradient names at its 50% stop — read from the gradient
   * itself rather than from a property this test knows the name of, so it
   * measures the band a browser paints however the stop is plumbed. */
  const stopProperty = /var\((--[\w-]+)\)\s+50%/.exec(sweep.body)?.[1]

  /** The centre stop resolved for one palette. A `--color-…` stop is a palette
   * token and means the same band in both; anything else is a local declared
   * inside the utility, whose light default is followed by a `.dark`
   * override. */
  const corePaintOf = (overrides: Map<string, string>, palette: 'light' | 'dark'): Paint => {
    const property = stopProperty as string
    if (property.startsWith('--color-')) return paintOf(property, overrides)

    const declarations = [
      ...sweep.body.matchAll(
        new RegExp(`${property}:\\s*var\\((--color-[\\w-]+)\\)`, 'g'),
      ),
    ]
    const declared =
      palette === 'dark'
        ? declarations.find(({ index }) => index > darkScopeAt)
        : declarations.find(({ index }) => index < darkScopeAt)
    if (declared === undefined) {
      throw new Error(`${property} has no ${palette} value in @utility sweep`)
    }
    return paintOf(declared[1], overrides)
  }

  /** The bar's own opacity, on top of whatever alpha its core stop carries. */
  const barOpacity = Number(
    /&::before\s*\{[\s\S]*?opacity:\s*([\d.]+)/.exec(sweep.body)?.[1],
  )

  /** The primary CTA dims itself on hover, and the sweep runs in that same
   * state, so its composite is the one a reader actually sees. */
  const hero = readFileSync(resolve(siteDir, 'src/components/HeroSection.tsx'), 'utf8')
  const ctaHoverOpacity =
    Number(/hover:opacity-(\d+)\b/.exec(stripComments(hero))?.[1]) / 100

  it('reads the band, its centre stop and the CTA hover opacity', () => {
    // Guards every case below: a rename would otherwise leave them measuring
    // undefined against undefined.
    expect(stopProperty).toBeTruthy()
    expect(barOpacity).toBeGreaterThan(0)
    expect(barOpacity).toBeLessThanOrEqual(1)
    expect(ctaHoverOpacity).toBeGreaterThan(0)
    expect(ctaHoverOpacity).toBeLessThanOrEqual(1)
  })

  const PALETTES = [
    { name: 'light', overrides: new Map<string, string>() },
    { name: 'dark', overrides: darkTokens },
  ] as const

  it.each(PALETTES)(
    'keeps the $name primary CTA label above 4.5:1 under the band',
    ({ name, overrides }) => {
      /*
       * The hero's filled CTA: `bg-accent` with a `--color-accent-contrast`
       * label, dimmed by its own `hover:opacity-90` against the page. A centre
       * stop brighter than the fill eats the fill's margin — the light palette
       * has 4.75:1 to give and brand-600 at this opacity measured 3.60:1,
       * which is the regression this case exists for.
       */
      const core = corePaintOf(overrides, name)
      const fill = paintOf('--color-accent', overrides)
      const label = paintOf('--color-accent-contrast', overrides)
      const page = paintOf('--color-bg', overrides)

      const band = composite(
        core,
        composite(fill, page.rgb),
        core.alpha * barOpacity,
      )

      const ratio = contrast(
        composite(label, page.rgb, ctaHoverOpacity),
        composite({ rgb: band, alpha: 1 }, page.rgb, ctaHoverOpacity),
      )
      expect(ratio).toBeGreaterThanOrEqual(4.5)
    },
  )

  it.each(
    PALETTES.flatMap(({ name, overrides }) =>
      // The outlined CTAs and the header nav links have no fill of their own,
      // so the band composites straight onto the page. Their label is the
      // accent under hover and focus and `--color-text` otherwise; `muted` is
      // deliberately absent, because Header.tsx moves the label off it in
      // every state that runs the sweep.
      (['--color-accent', '--color-text'] as const).map((label) => ({
        name,
        overrides,
        label,
      })),
    ),
  )('keeps $label above 4.5:1 over the $name band', ({ name, overrides, label }) => {
    const page = paintOf('--color-bg', overrides)
    const core = corePaintOf(overrides, name)
    const band = composite(core, page.rgb, core.alpha * barOpacity)

    expect(contrast(paintOf(label, overrides).rgb, band)).toBeGreaterThanOrEqual(4.5)
  })
})