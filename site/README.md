# Resume site

Vite + React + TypeScript front end for the resume, styled with Tailwind CSS v4.

## Scripts

Run from `site/`:

| Command           | What it does                                              |
| ----------------- | --------------------------------------------------------- |
| `npm run dev`     | Vite dev server with HMR                                  |
| `npm run build`   | Type-checks with `tsc -b`, then builds to `dist/`         |
| `npm run lint`    | Oxlint over the project                                   |
| `npm run preview` | Serves the built `dist/` for a production-like smoke test |
| `npm test`        | Vitest once, no watch                                     |

## Deployment

`.github/workflows/deploy-pages.yml` builds `site/` and publishes it to GitHub
Pages. It runs on every push to `main` that touches `site/**` (or the workflow
file itself), and can also be started by hand from the Actions tab via
`workflow_dispatch`. The build job runs `npm ci` then `npm run build` in
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
`src/main.tsx` before the first render, applies whatever
`prefers-color-scheme` reports. It deliberately has no persistence and no
switcher UI — those land with the later theming issue, which extends this
module rather than replacing it.

## Mobile-first contract

- Tailwind's **default breakpoints are unchanged**: `sm` 640px, `md` 768px,
  `lg` 1024px, `xl` 1280px, `2xl` 1536px. Later sections assume these values,
  so don't customize the scale.
- Base body size is `1rem` (16px). Nothing in `src/` may declare a
  `font-size` below that — smaller text makes mobile Safari auto-zoom.
- Size layout with `w-full`, `max-w-*`, `mx-auto` and responsive padding
  (`p-4 md:p-8`). No fixed or minimum pixel widths, and no
  `overflow-x-hidden` to hide a layout that overflows anyway.

### Manual check: 375px, no horizontal scroll

Layout can't be asserted in CI (there's no browser in the build sandbox), so
verify this by hand when changing the layout:

1. `npm run dev`, open the site, and enter devtools responsive mode at
   **375 × 667** (iPhone SE).
2. Confirm there is no horizontal scrollbar and that the console reports
   equal values for:
   ```js
   document.documentElement.scrollWidth === document.documentElement.clientWidth
   ```
3. Repeat with the dark palette applied
   (`document.documentElement.classList.add('dark')`) — both palettes must
   pass.
