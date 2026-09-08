import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/*
 * Enforces the mobile-first contract in README.md over the shell's own source.
 *
 * This is a *source* assertion rather than a rendered-layout one on purpose:
 * the acceptance criterion is "no horizontal scrollbar at 320px", and neither
 * jsdom nor the build sandbox has a layout engine or a browser — jsdom reports
 * every width as 0 and applies no Tailwind stylesheet at all, so a rendered
 * assertion would pass no matter how the page is sized. What *can* be checked
 * mechanically is the handful of constructs that cause overflow in the first
 * place: a hard pixel width the viewport can be narrower than, and
 * `overflow-x-hidden`, which hides an overflowing layout instead of fixing it.
 * The real widths (320/375/768/1440) stay a documented manual check.
 */

const here = dirname(fileURLToPath(import.meta.url))
const srcDir = resolve(here, '../src')

/** App.tsx plus every file in src/components/ — the shell's own source. */
const shellSources: { path: string; source: string }[] = [
  'App.tsx',
  ...readdirSync(join(srcDir, 'components')).map((name) =>
    join('components', name),
  ),
].map((path) => ({
  path: `src/${path}`,
  source: readFileSync(join(srcDir, path), 'utf8'),
}))

/*
 * No *arbitrary* class name (a utility with a bracketed value) is written out
 * as a literal anywhere in this file, not even in a comment. Tailwind v4
 * scans every source file in the project, this one included, so a literal
 * utility-plus-bracket here is emitted as a real rule into the production
 * bundle — the guard file would ship the very classes it forbids. Utility
 * names are passed in as bare prefixes and the bracketed part is matched by
 * pattern. Plain utilities the components already use are safe to name.
 */

/** The focus-ring utility no rendering source may declare, spelled in two
 * halves for the same reason the arbitrary values below are matched by
 * pattern: written out whole it would be a scannable candidate, and this
 * file would ship the very utility it forbids into the bundle. Neither half
 * is a utility on its own, so nothing is emitted for them. */
const FOCUS_UTILITY = 'focus-visible:out' + 'line'

/** Tailwind arbitrary values, with any variant prefix — a fixed width, a
 * responsive minimum width, a pixel font size. The lookbehind keeps the `w`
 * utility from also matching the tail of `min-w-`/`max-w-`, so each is asked
 * for by name. */
const arbitraryValues = (source: string, utility: string): string[] =>
  [
    ...source.matchAll(new RegExp(`(?<![-\\w])${utility}-\\[([^\\]]+)\\]`, 'g')),
  ].map((match) => match[0])

/** The value of an arbitrary utility, in rem, or `null` when it is not a
 * length (a color, a var(), a raw ratio). Assumes the project's 16px root. */
function lengthInRem(className: string): number | null {
  const value = className.slice(className.indexOf('[') + 1, -1)
  const match = /^(\d*\.?\d+)(px|rem)$/.exec(value)
  if (!match) return null
  return match[2] === 'px' ? Number(match[1]) / 16 : Number(match[1])
}

it('has shell sources to check', () => {
  // Guards the glob itself: a rename that empties this list must not turn the
  // whole file into a vacuous pass.
  expect(shellSources.map((file) => file.path)).toContain('src/App.tsx')
  expect(shellSources.length).toBeGreaterThan(1)
})

describe.each(shellSources)('$path', ({ source }) => {
  it('declares no fixed or minimum pixel width', () => {
    // A width pinned in pixels can be wider than a 320px viewport and cannot
    // shrink; widths come from `w-full` / `max-w-*` instead.
    const fixed = [
      ...arbitraryValues(source, 'w'),
      ...arbitraryValues(source, 'min-w'),
    ].filter((className) => className.includes('px'))

    expect(fixed).toEqual([])
  })

  it('does not use overflow-x-hidden', () => {
    // It clips the symptom and leaves the layout broken; fix the offending
    // element's width instead.
    expect(source).not.toContain('overflow-x-hidden')
  })

  it('declares no font size below 1rem', () => {
    // Below 16px, mobile Safari zooms the page on focus and the layout jumps.
    const tooSmall = arbitraryValues(source, 'text').filter((className) => {
      const rem = lengthInRem(className)
      return rem !== null && rem < 1
    })

    expect(tooSmall).toEqual([])
  })

})

/** The rendering sources only: the rules below are about what the shell draws,
 * and a component's own test file may legitimately name a class it forbids. */
const componentSources = shellSources.filter(
  (file) => !file.path.includes('.test.'),
)

/** Every `<a ...>` / `<button ...>` opening tag in a source, from the tag
 * start to its closing `>`. Non-greedy so a later tag's `>` is never pulled
 * into an earlier one; the tag name must be followed by whitespace so a bare
 * `<a>`/`<button>` mentioned in prose inside a comment (ProjectCard.tsx,
 * ThemeToggle.tsx both do this) is not mistaken for JSX; and the closing `>`
 * must not be the tail of an arrow function's `=>` inside an inline handler
 * (ExperienceEntry.tsx and friends open a button with `onClick={() => {`
 * before their `className`), which would otherwise end the match early. */
const openingTags = (source: string): { name: string; tag: string }[] =>
  [...source.matchAll(/<(a|button)\b(?=\s)[\s\S]*?(?<!=)>/g)].map((match) => ({
    name: match[1],
    tag: match[0],
  }))

/** The two spellings that satisfy the 44px floor when found directly in a
 * tag or a constant's own definition: the literal utility, or either of
 * `src/styles.ts`'s exports that bundle it (`TAP_TARGET`/`TAP_TARGET_HEIGHT`
 * both contain this as a substring). */
const hasTapTargetFloor = (text: string): boolean =>
  text.includes('min-h-11') || text.includes('TAP_TARGET')

/** Every module-level `const NAME = ...` in a source, name to its own
 * right-hand side text — not indented, so a component's local variables
 * (inside its function body) are never picked up as shared constants. */
const moduleConstants = (source: string): Map<string, string> =>
  new Map(
    [
      ...source.matchAll(
        /^const (\w+)[^\n=]*=\s*([\s\S]*?)(?=\n(?:const\s|function\s|export\s|\/\*|\/\/)|(?![\s\S]))/gm,
      ),
    ].map((match) => [match[1], match[2]]),
)

/** Whether `name` resolves to the tap-target floor, either directly or by
 * following `${OTHER_NAME}` references to other module constants in the same
 * file (HeroSection.tsx's `PRIMARY_CTA`/`SECONDARY_CTA` only reach
 * `TAP_TARGET_HEIGHT` this way, through their shared `CTA`). `seen` guards
 * against a reference cycle. */
function constantHasTapTargetFloor(
  name: string,
  constants: Map<string, string>,
  seen: Set<string>,
): boolean {
  if (seen.has(name)) return false
  const definition = constants.get(name)
  if (definition === undefined) return false
  if (hasTapTargetFloor(definition)) return true

  seen.add(name)
  return [...definition.matchAll(/\$\{(\w+)\}/g)].some((match) =>
    constantHasTapTargetFloor(match[1], constants, seen),
  )
}

describe.each(componentSources)('$path', ({ source, path }) => {
  it('spaces flex/grid children by at least 0.5rem', () => {
    // Tap targets are 44px, and the issue asks for visible space between
    // them; a 4px gap leaves two of them close enough to mis-tap on a phone.
    // Everything in the shell uses 0.5rem or more.
    const tooTight = [
      ...source.matchAll(/(?<![-\w])gap(?:-[xy])?-(?:0\.5|1|1\.5)(?![\w.])/g),
    ].map((match) => match[0])

    expect(tooTight).toEqual([])
  })

  it('takes its focus ring from src/styles.ts', () => {
    // The ring is one of the two a11y floors the whole shell shares, and it
    // is only assertable page-wide while there is one copy of it: six private
    // declarations of the same string could each drift on their own. A
    // component that needs a focus ring imports FOCUS_RING from src/styles.ts;
    // none writes the utility itself.
    expect(source).not.toContain(FOCUS_UTILITY)
  })

  it('gives every <a>/<button> a 44px tap target', () => {
    // README's mobile-first contract: tap targets are at least 44x44
    // (`min-h-11 min-w-11`). Non-interactive elements — SkillsSection.tsx's
    // chip <li>s among them — are not tap targets and are not inspected here.
    const constants = moduleConstants(source)

    const untargeted = openingTags(source)
      .filter(({ tag }) => {
        if (hasTapTargetFloor(tag)) return false

        const classNameRef = /className=\{(\w+)\}/.exec(tag)
        if (!classNameRef) return true

        return !constantHasTapTargetFloor(
          classNameRef[1],
          constants,
          new Set(),
        )
      })
      .map(({ name, tag }) => `${path}: <${name}> missing min-h-11: ${tag}`)

    expect(untargeted).toEqual([])
  })
})

it('found <a> and <button> tags to check', () => {
  // Guards the tag scan itself: a refactor that stops matching any real tag
  // (a markup rewrite, a stricter regex) must not turn the check above into
  // a vacuous pass.
  const tags = componentSources.flatMap((file) => openingTags(file.source))

  expect(tags.some(({ name }) => name === 'a')).toBe(true)
  expect(tags.some(({ name }) => name === 'button')).toBe(true)
})

/** Every `max-w-5xl` container the shell renders, as its full class string.
 * All of them are plain double-quoted `className` values, so the attribute's
 * string is the whole class list. */
const columnContainers = componentSources.flatMap(({ path, source }) =>
  [...source.matchAll(/className="([^"]*max-w-5xl[^"]*)"/g)].map((match) => ({
    path,
    className: match[1],
  })),
)

describe('the shared content column', () => {
  it('is used by the header bar, main and the footer', () => {
    expect(columnContainers.map((container) => container.path)).toEqual(
      expect.arrayContaining([
        'src/App.tsx',
        'src/components/Header.tsx',
        'src/components/Footer.tsx',
      ]),
    )
  })

  it.each(columnContainers)(
    '$path pads its column to the same edges',
    ({ className }) => {
      // The three columns are the same width and centred, so a padding step
      // applied to one and not the others puts their left edges on different
      // pixels: from `md` up, content sitting 16px inside the wordmark and
      // the footer links. Horizontal padding is written separately from the
      // vertical step for exactly this reason — `p-4 md:p-8` on one of them
      // is what caused the misalignment.
      const horizontal = className
        .split(/\s+/)
        .filter((name) => /(^|:)px?-\d/.test(name))

      expect(horizontal).toEqual(['px-4', 'md:px-8'])
    },
  )
})
