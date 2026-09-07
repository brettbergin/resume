# Resume site

Vite + React + TypeScript front end for the resume, styled with Tailwind CSS v4.

## Scripts

Run from `site/`:

| Command             | What it does                                              |
| ------------------- | --------------------------------------------------------- |
| `npm run dev`       | Vite dev server with HMR                                  |
| `npm run build`     | Type-checks with `tsc -b`, then builds to `dist/`         |
| `npm run typecheck` | Type-checks the whole solution with `tsc -b --noEmit`, emitting nothing |
| `npm run lint`      | Oxlint over the project — reports warnings, exits 0 on them (CI adds `--deny-warnings`) |
| `npm run preview`   | Serves the built `dist/` for a production-like smoke test |
| `npm test`          | Vitest once, no watch                                     |

## Continuous integration

`.github/workflows/ci.yml` is the pull-request gate. It runs on every pull
request that touches `site/**` (or the workflow file itself) and runs `npm ci`
in `site/`, then `npm run lint -- --deny-warnings`, `npm run typecheck` and
`npm run build` as three separate steps — so any one of a lint problem, a type
error or a build failure fails the check on its own, and the annotation points
at the step that actually broke.

**CI lints stricter than the bare script does.** Oxlint reports its default
(correctness) rules — `no-debugger`, `no-unused-vars` and the rest — at
*warning* severity and still exits 0, so `npm run lint` on its own is
advisory: it prints the problems and succeeds. Only
`.oxlintrc.json`'s `react/rules-of-hooks` is an error locally. The `Lint` step
therefore passes `--deny-warnings`, which makes every warning fail the check.
So a locally green `npm run lint` that printed warnings will be red on the
pull request — read its output, don't just read its exit code. Run
`npm run lint -- --deny-warnings` before pushing to see what CI will see.
`test/ci.test.ts` runs the step's command over fixtures with a warning-level
and an error-level violation and asserts each one exits non-zero.

CI and the Pages deploy are **two distinct workflows with non-overlapping
triggers and permissions.** CI is `pull_request`-only and read-only
(`contents: read`); it publishes nothing. `deploy-pages.yml` runs only on
pushes to `main` (plus a manual `workflow_dispatch`) and holds the Pages write
permissions. Neither one's triggers fire the other's job, so a pull request is
never able to deploy and a merge is never gated a second time by CI.

CI does **not** run the Vitest suite today — lint, type-check and build only.
Run `npm test` locally before opening a pull request.

**A green CI run says nothing about layout, viewport behaviour or
accessibility.** There is no browser in the CI runner, so responsive and a11y
behaviour is still verified by hand: see
[Mobile-first contract](#mobile-first-contract) below for the checklist to
walk. A passing check means the code lints, compiles and builds — not that the
site is mobile-friendly.

## Deployment

`.github/workflows/deploy-pages.yml` builds `site/` and publishes it to GitHub
Pages. It runs on every push to `main` that touches `site/**`, the repo-root
`resume.pdf` (the build bundles it — see [The resume PDF](#the-resume-pdf)) or
the workflow file itself, and can also be started by hand from the Actions tab
via `workflow_dispatch`. The build job runs `npm ci` then `npm run build` in
`site/`, uploads `site/dist` as the Pages artifact, and a separate `deploy`
job publishes it — so a type error in `tsc -b` fails the build and nothing
gets deployed.

**One-time repository setting:** a maintainer must set
`Settings > Pages > Source: GitHub Actions` once. Until that is applied the
deploy job fails and no URL is served, however green the build is.

| Setting     | Value                                   |
| ----------- | --------------------------------------- |
| Live URL    | https://brettbergin.github.io/resume/   |
| Vite `base` | `/resume/` (see `vite.config.ts`)       |

The `base` in `vite.config.ts` must match the path the site is served from,
otherwise `dist/index.html` asks for its assets at `/` and Pages returns a
blank page with a 200. A project page lives under `/resume/`, hence
`base: '/resume/'`. If a custom domain is ever configured, the site is served
from the domain root instead — change `base` to `'/'` in the same change that
adds the domain.

### The resume PDF

The hero's "Download PDF" button serves the **repo-root `resume.pdf`**, and
Pages publishes only `site/dist`, so the root file has to reach the bundle.
It is **not copied into `site/public/`**: that would commit a second copy of
the binary, which would silently go stale the next time the root one is
regenerated. Instead `vite/resume-pdf.ts` is a small Vite plugin that reads
the file from the repo root at build time and emits it into `dist/` under its
own name, unhashed — one copy in git, one in `dist/`, no way for them to
disagree. The same plugin serves those bytes from `npm run dev`, so the
button works during the manual checks too.

The href is built as `import.meta.env.BASE_URL + summary.resumePdfFileName`,
not hand-written: the site is served from `/resume/`, where a literal
`/resume.pdf` would 404. `resumePdfFileName` is the one name shared by the
plugin's emitted asset and the link, so the two cannot drift.

Because the PDF is an input to the build rather than a file under `site/`,
`deploy-pages.yml` also triggers on pushes to `main` that touch `resume.pdf`
— otherwise a regenerated resume would sit in git while Pages kept serving
the old bytes. `test/resume-pdf.test.ts` covers the plugin and
`test/deploy-pages.test.ts` the trigger.

## Content data model

`src/data/resume.ts` is the single source of truth the sections render from —
hero, skills, experience, projects and achievements all read their content
from its typed exports, shaped by the interfaces in `src/data/types.ts`. Every
export is annotated against its interface, so a missing or misspelled field is
a build error rather than a blank spot on the page.

`resume.md` at the repo root remains the human-authored original (and the
source for `resume.html` / `resume.pdf`). The two are transcriptions of each
other, not generated from one another, so **content changes must update both
files together.** The `References` section of `resume.md` is deliberately not
modelled — see the comment at the top of `resume.ts`.

## Layout shell

`src/App.tsx` is the shell every content section renders inside. It renders,
in order: the skip link, `<Header>`, a single `<main id="main">`, and
`<Footer>`. The page is a `flex min-h-svh flex-col` column on `bg-bg
text-text`, and `<main>` is an `mx-auto w-full max-w-5xl` container.

All three columns — the header bar, `<main>` and the footer — are
`max-w-5xl px-4 md:px-8`, so their left and right edges land on the same
pixels at every width. Horizontal padding is written out separately from the
vertical step (`px-4 md:px-8` rather than `p-4 md:p-8`) precisely so it can be
kept identical across the three; `test/layout-contract.test.ts` asserts it.

| Piece                             | Responsibility                                                                       |
| --------------------------------- | ------------------------------------------------------------------------------------ |
| `src/components/Header.tsx`       | Sticky bar: wordmark, inline section nav from `md` up, menu button + full-screen panel below it |
| `src/components/HeroSection.tsx`  | The About section's content: name (the page's one `<h1>`), title, location, professional summary and the three CTAs |
| `src/components/SkillsSection.tsx` | The Skills section's content: the core competencies and technical skill groups from `src/data/resume.ts`, each group a labelled cluster of chips in a responsive grid |
| `src/components/Footer.tsx`       | Email and GitHub links from `contact`, plus the "built with" note                    |
| `src/components/ThemeToggle.tsx`  | Light/dark switch — see [Light and dark](#light-and-dark)                             |
| `src/data/sections.ts`            | The section registry: the single source of both the nav entries and the section ids   |

**The section registry is the single source of truth for navigation.**
`sections` is a list of `{ id, label }`; the header maps over it for its links
(one `href="#<id>"` each), and `App.tsx` maps over the same list to render one
`<section id={id}>` per entry with `label` as its heading. Adding a section is
therefore one entry in `sections.ts` — there is no second, hand-written list
of links, so a nav link can never point at an id the page does not render.
`src/App.test.tsx` asserts exactly that: every same-page href resolves to an
element that exists in the document.

**About and Skills are filled in — by `HeroSection` and `SkillsSection`; the
remaining four registry entries (Experience, Projects, Achievements, Contact)
are still placeholders** ("Coming soon."). `App.tsx` maps the registry as
before and picks each section's body in one place: a `sectionBody(section)`
helper switches on `section.id`, returning `<HeroSection>` for `about`,
`<SkillsSection>` for `skills` and the placeholder heading + "Coming soon."
for everything else. The `<section id aria-labelledby>` wrapper (and with it
the nav anchor and the scroll offset) is the registry's in every case, and a
filled-in section renders the heading that wrapper is labelled by, from the
registry's own `label`, so the nav text and the on-page heading cannot drift.
Each remaining section is filled in by its own change, adding a `case` to that
same switch; what the shell owns either way is the structure — exactly one
`banner`, one `main` and one `contentinfo` landmark, and exactly one `<h1>`,
which is the hero's name.

The skills grid is one column below `md`, two from `md` and three from `lg`,
with each group's chips wrapping (`flex-wrap`) rather than being clipped —
walk the `Skills at …` items in [Manual check](#manual-check-widths-mobile-menu-theme-persistence)
below after touching it. Both palettes are covered by that list's existing
"repeat the width checks with the dark palette" item; there is no separate
dark-mode pass for this section.

The **theme toggle lives in the header bar** at both widths, next to the menu
button, rather than being duplicated into the mobile panel — one toggle in the
document, reachable at 375px and at 1440px alike.

The **skip link** ("Skip to content", `href="#main"`) is the first focusable
element in the document and is `sr-only` until focused, at which point it
becomes a visible pill in the top-left. A sticky header with a nav in front of
the content would otherwise cost a keyboard user a tab through every nav link
before reaching the page; `scroll-margin-top` on `section[id]` (see
`index.css`) keeps the header from covering whatever the anchor jumped to.

## Styling: Tailwind CSS v4, CSS-first

Tailwind is wired in through the `@tailwindcss/vite` plugin (see
`vite.config.ts`) and configured entirely from CSS in `src/index.css`.

There is **no `tailwind.config.ts` and no `postcss.config.js`** on purpose:
in v4 the theme lives in an `@theme` block in CSS, and the Vite plugin does
the PostCSS work itself. Content detection is automatic, so there is no
`content` glob to keep in sync either. To add or change a design token, edit
the `@theme` block — do not reintroduce a JS config.

### Design tokens

`src/index.css` defines two raw ramps (`--color-brand-*`, `--color-neutral-*`)
plus radii, and then maps them onto six semantic tokens:

| Token             | Used for                                  |
| ----------------- | ----------------------------------------- |
| `--color-bg`      | page background                           |
| `--color-surface` | raised surfaces: cards, panels, code blocks |
| `--color-text`    | primary body text                         |
| `--color-muted`   | secondary/supporting text                 |
| `--color-border`  | hairlines, dividers, card borders         |
| `--color-accent`  | links, emphasis, interactive affordances  |

(`--color-accent-contrast` is also available for text placed *on* an accent
fill.)

**Components should use the semantic tokens, not the raw palette steps.**
Write `bg-bg text-text border-border text-accent` rather than
`bg-white dark:bg-neutral-900` — the semantic tokens are reassigned for dark
mode in one place, so a component built on them needs no `dark:` variants at
all. Reach for `brand-*` / `neutral-*` directly only when adding a new
semantic token.

### Light and dark

The `dark:` variant is bound to a `dark` class on `<html>`, not to
`prefers-color-scheme`, so the palette can be switched explicitly. Flip it
either way:

```js
document.documentElement.classList.add('dark') // or .remove('dark')
```

```ts
import { applyTheme } from './theme.ts'
applyTheme('dark')
```

`src/theme.ts` is the seam for theming. `applyInitialTheme()`, called from
`src/main.tsx` before the first render, applies the user's stored choice if
there is one and whatever `prefers-color-scheme` reports otherwise.

**No flash of the wrong palette takes a second copy of that logic.**
`src/main.tsx` is a module script and module scripts are deferred, so the
browser may paint the parsed document — white, since light is the CSS default
and `dark` is only ever added by JS — before the bundle runs. `index.html`
therefore carries a small render-blocking inline script in `<head>` that reads
the same `resume-theme` key, falls back to the same media query, and adds the
`dark` class before the first paint. It duplicates `getInitialTheme()` because
it cannot import; `test/index-html.test.ts` asserts the key and the query
still match `theme.ts`.

`setTheme()` is the only writer of storage, under the **namespaced** key
`resume-theme`: every GitHub Pages project page shares the
`brettbergin.github.io` origin, so a bare `theme` key would collide with the
owner's other project sites. Nothing is written until the user actually
toggles, and while nothing is stored the site follows live OS changes
(`watchPreferredTheme`); once a choice is stored it wins. Every localStorage
access is wrapped in try/catch — Safari in private mode throws on the
property access itself — and a stored value that is not exactly `light` or
`dark` is treated as absent.

`src/components/ThemeToggle.tsx` is the user-facing switch: one `<button>`
with `aria-pressed` and a state-reflecting `aria-label`, calling `setTheme`.

## Mobile-first contract

- Tailwind's **default breakpoints are unchanged**: `sm` 640px, `md` 768px,
  `lg` 1024px, `xl` 1280px, `2xl` 1536px. Later sections assume these values,
  so don't customize the scale.
- Base body size is `1rem` (16px). Nothing in `src/` may declare a
  `font-size` below that — smaller text makes mobile Safari auto-zoom.
- Size layout with `w-full`, `max-w-*`, `mx-auto` and responsive padding
  (`px-4 md:px-8`). No width or minimum width pinned in pixels, and no
  `overflow-x-hidden` to hide a layout that overflows anyway.
- Tap targets are at least 44x44 (`min-h-11 min-w-11`) with at least 8px
  between them (`gap-2` or more) — 44px targets 4px apart mis-tap on a phone.

`test/layout-contract.test.ts` enforces those over `src/App.tsx` and
`src/components/*`: it fails on an arbitrary width or minimum width given in
pixels, on `overflow-x-hidden`, on an arbitrary font size below `1rem`, on a
gap under `gap-2`, and on a content column whose horizontal padding differs
from the other two. It reads the source rather than a rendered tree because
jsdom has no layout engine: it reports every width as 0 and applies no
Tailwind stylesheet, so a rendered assertion would pass whatever the page
actually does. That file deliberately never writes an arbitrary class name out
in full, not even in a comment — Tailwind v4 scans it like any other source,
so a literal example there would be emitted into the shipped CSS. The widths
below therefore stay a manual check.

Below `md` the header collapses to the menu button, and **crossing back up to
`md` closes the menu**: the panel, the button and the body scroll lock are all
`md:hidden`, so a menu left open into desktop width would leave the page
scroll-locked with nothing visible to click. `Header.tsx` watches
`(min-width: 48rem)` for exactly that (a fold opening or a tablet rotating
crosses it in one gesture); `Header.test.tsx` covers it.

### Manual check: widths, mobile menu, theme persistence

Layout can't be asserted in CI (there's no browser in the build sandbox), so
walk this list by hand when changing the shell. `npm run dev`, then in
devtools responsive mode:

- [ ] **320px** (smallest supported) — no horizontal scrollbar, and the
      console reports equal values for:
      ```js
      document.documentElement.scrollWidth === document.documentElement.clientWidth
      ```
- [ ] **375 × 667** (iPhone SE) — same check; the header is collapsed to the
      menu button and still leaves most of the viewport to content.
- [ ] **768px** (the `md` breakpoint) — the inline nav has taken over from the
      menu button, with nothing overlapping or clipped.
- [ ] **1440px** — content stays in its `max-w-5xl` column, centred, with the
      header bar and footer aligned to the same width.
- [ ] Footer contact links stack (or wrap) rather than overflowing at 320px
      and 375px.
- [ ] **Hero at 375px** — name, title, location, summary and the three CTAs
      read as one column, aligned consistently with each other, with no
      horizontal scrollbar (same `scrollWidth === clientWidth` check) and the
      professional summary wrapping over as many lines as it needs rather than
      being clipped or truncated.
- [ ] **Hero CTAs at 375px** — the three buttons are full-width and stacked,
      each at least 44px tall (inspect one: its box height in devtools is
      ≥ 44), with visible space between them.
- [ ] **Hero at 768px and at 1440px** — the CTAs have moved into a row and sit
      inside the `max-w-5xl` column with nothing clipped, overlapping or
      pushed past the column's right edge.
- [ ] **Skills at 375px** — the skill groups read as a single column, each
      group's chips wrapping onto as many lines as they need, nothing clipped
      or truncated, and no horizontal scrollbar (same
      `scrollWidth === clientWidth` check).
- [ ] **Skills at 320px** — the longest group (`Specializations`) still wraps
      inside its column rather than widening the page: no horizontal
      scrollbar, and `scrollWidth === clientWidth` still holds.
- [ ] **Skills at 768px** — the group grid has reflowed to two columns, with
      nothing overlapping or clipped and no horizontal scrollbar.
- [ ] **Skills at 1440px** — the grid is three columns inside the `max-w-5xl`
      column, its outer edges aligned with the header bar and the footer.
- [ ] **No proficiency bars, ratings or percentages** on any chip — the source
      resume has none, so any such figure would be invented. Chips are plain
      labels, and each has visible padding and spacing rather than running
      together into one block of text.
- [ ] **Hero links work**: "Download PDF" downloads the file under
      `npm run dev` (the dev server serves the repo-root PDF — see
      [The resume PDF](#the-resume-pdf)), and the GitHub button opens the
      profile in a new tab.
- [ ] **Mobile menu, keyboard only** at 375px: Tab to the menu button, open it
      with Enter, Tab through the links and confirm focus stays inside the
      panel and cycles, press Escape and confirm the panel closes and focus
      returns to the menu button. Then reopen it and follow a link with Enter
      — the panel closes and the target section is in view below the header.
- [ ] **Menu across the breakpoint**: at 375px open the menu, then drag the
      window wider than 768px. The menu closes, the inline nav takes over,
      and the page scrolls (`document.body.style.overflow` is back to what it
      was). Drag back under 768px and confirm the menu still opens.
- [ ] With the menu open at 375px, the theme toggle in the bar is behind the
      full-screen panel — expected; close the menu and it is right there.
      (jsdom has no stacking context, so this one cannot be asserted in CI.)
- [ ] Tab from the very top of the page: the first stop is the "Skip to
      content" link, which is visible while focused and jumps to `<main>`.
- [ ] **Theme persistence**: toggle to the other theme, reload the page, and
      confirm it comes up in the chosen theme with no flash of the other
      palette. Clear the `resume-theme` key in devtools > Application >
      Local Storage, reload, and confirm it follows the OS preference again.
- [ ] Repeat the width checks with the dark palette applied
      (`document.documentElement.classList.add('dark')`) — both palettes must
      pass.
