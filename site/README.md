# Resume site

Vite + React + TypeScript front end for the resume, styled with Tailwind CSS v4.

## Scripts

Run from `site/`:

| Command             | What it does                                              |
| ------------------- | --------------------------------------------------------- |
| `npm run dev`       | Vite dev server with HMR                                  |
| `npm run build`     | Type-checks with `tsc -b`, then builds to `dist/`         |
| `npm run generate:images` | Redraws the committed `public/og-image.png` and `public/apple-touch-icon.png` — see [SEO and social preview](#seo-and-social-preview) |
| `npm run typecheck` | Type-checks the whole solution with `tsc -b --noEmit`, emitting nothing |
| `npm run lint`      | Oxlint over the project — reports warnings, exits 0 on them (CI adds `--deny-warnings`) |
| `npm run preview`   | Serves the built `dist/` for a production-like smoke test |
| `npm test`          | Vitest once, no watch                                     |

## Continuous integration

`.github/workflows/ci.yml` is the pull-request gate. It runs on every pull
request that touches `site/**`, `resume.pdf` or the workflow file itself, and
runs `npm ci` in `site/`, then `npm run lint -- --deny-warnings`,
`npm run typecheck` and `npm run build` as separate steps — so any one of a
lint problem, a type error or a build failure fails the check on its own, and
the annotation points at the step that actually broke. A fourth step,
`cmp dist/resume.pdf ../resume.pdf`, checks that the build really emitted the
repo-root PDF: the plugin that emits it is only unit-tested against stand-in
Vite objects, and a wrong or missing asset is a 404 behind the download
button. That step is why `resume.pdf` is one of the triggering paths — a pull
request that only regenerates the resume would otherwise skip the one check
that guards it.

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

CI does **not** run the Vitest suite today — the `check` job is lint,
type-check and build only. Run `npm test` locally before opening a pull
request.

A second job, `responsive`, installs Playwright's Chromium and runs
`npm run test:e2e` (`site/e2e/responsive.spec.ts`) against a real browser at
320, 375, 768 and 1440px, asserting `document.documentElement.scrollWidth ===
clientWidth` (no horizontal overflow) and that the menu button and inline nav
swap at the right width. It is a separate job from `check` because it needs a
browser install the other steps don't.

**A green CI run still says nothing about full layout, viewport behaviour or
accessibility beyond that one suite.** Outside the four widths and the two
assertions `responsive` covers, responsive and a11y behaviour is still
verified by hand: see [Accessibility](#accessibility) for what *is* asserted
mechanically and what is not, and
[Mobile-first contract](#mobile-first-contract) below for the checklist to
walk. A passing check means the code lints, compiles, builds and clears that
one browser-backed smoke suite — not that the site is fully mobile-friendly.

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

`test/resume-md-sync.test.ts` enforces that rule: every string the data module
transcribes — achievement texts, role highlights, skill items, project names
and URLs, date ranges — must appear verbatim in `resume.md`, so drift fails a
test rather than waiting for a visual review. It does not cover the `metric`
callouts (editorial condensations), the published PDF's file name, the
`resume.html` / `resume.pdf` exports, or the omitted `References` section.
`src/data/resume.test.ts` stays what it was — counts and non-emptiness, plus
the reverse-chronological check on `experiences`. Like the rest of the Vitest
suite, both run under `npm test` and not in CI.

## SEO and social preview

`src/data/site.ts` is the single source of truth for everything a crawler or a
link-preview consumer reads: the page title (built from `summary` in
`resume.ts` rather than retyped), the ~155-character preview description, the
canonical/deployed URL, the card's file name and its 1200x630 dimensions, and
the two `theme-color` values. Nothing else invents those strings.

**The tags themselves are literals in `index.html`, not rendered by React.**
Link-preview crawlers (Slack, Discord, iMessage, X) and most indexers fetch the
HTML and read it without executing JavaScript, so a `<meta>` tag injected at
runtime is invisible to them and the shared link falls back to a bare URL.
That is the same trade the inline theme script makes, and it has the same cost:
the values are duplicated out of `site.ts` into the head, and duplication rots.
`test/metadata.test.ts` is what stops the two drifting — it parses `<head>`
into a lookup keyed by `name`/`property`/`rel` (so a reformat that changes
nothing a crawler sees is not a failure) and asserts the title, description,
canonical, Open Graph, Twitter Card, icon, viewport and `theme-color` tags all
still match `site.ts`. It pins `public/robots.txt` and `public/sitemap.xml` the
same way: those are copied verbatim by Vite and so cannot interpolate anything,
which makes their hand-typed URLs the likeliest thing to point at the wrong
host after a move.

`og:image` and `twitter:image` are **absolute** URLs carrying the origin in
full, while the `<link rel="icon">` and `apple-touch-icon` hrefs are
root-relative. That asymmetry is deliberate: Vite rewrites the URLs it finds in
`index.html` for the `/resume/` base at build time, so a hand-written prefix on
the icons would publish `/resume/resume/favicon.svg`, but meta `content` is
opaque to the build and a relative `og:image` is silently dropped by most
consumers — the usual reason a preview shows the text and no picture.

### The generated images

`public/og-image.png` (1200x630) and `public/apple-touch-icon.png` (180x180)
are **committed, and produced by `scripts/generate-images.ts`**
(`npm run generate:images`). They have to be committed because a crawler
fetches the PNG and never runs the build; the generator is committed alongside
so the binary can always be re-derived rather than becoming a file nobody can
reproduce. The card is drawn from `resume.ts` and `site.ts` — name, job title,
location and GitHub URL, none of it retyped — and the touch icon is
`public/favicon.svg` rasterised at 180, so the two icons cannot drift.

The render is deterministic on purpose: Inter comes out of
`node_modules/@fontsource-variable/inter` (the same typeface the site loads,
pinned by the lockfile), is unpacked from WOFF2 to a scratch TTF, and is handed
to resvg as the only font in its database with `loadSystemFonts: false`. With
system fonts on, the bytes would depend on which fonts the machine happens to
have and CI would produce a different card than a laptop. There is no headless
browser or system rasteriser in the pipeline for the same reason.
`test/assets.test.ts` checks the shipped bytes — PNG signature, the dimensions
out of the IHDR chunk, the card's file size, and that `favicon.svg` is no
longer Vite's default logo.

**Changing the name, job title, location or GitHub URL means re-running
`npm run generate:images` and committing the new PNG in the same change** —
those four strings are drawn on the card, and the checked-in image is what
gets shared until it is redrawn. A change to `title` or `description` also has
to be copied into the literal tags in `index.html` by hand;
`test/metadata.test.ts` fails until it is.

### robots.txt and sitemap.xml

`public/robots.txt` is **inert as deployed, and kept anyway.** Crawlers fetch
`robots.txt` from the origin root only, and this is a project page under
`/resume/` on the shared `brettbergin.github.io` origin — the file a crawler
actually reads is `https://brettbergin.github.io/robots.txt`, served from a
different repository. Nothing in ours controls crawling of the deployed site
today. It becomes live the moment a custom domain is configured (the site then
owns its origin root), and in the meantime the sitemap it names can be
submitted to Search Console by URL, which does not go through `robots.txt` at
all. The comment at the top of the file says so, and `test/metadata.test.ts`
asserts the caveat is still there — without it the file looks like it does
something it does not.

`public/sitemap.xml` lists exactly one `<loc>`, the site URL. The page is one
document navigated by in-page anchors, and a fragment is not a separate URL, so
a second entry would be a duplicate. It carries no `<lastmod>`: nothing in this
repo would keep a hardcoded date honest, and a date frozen at the day the file
was written is worse than none.

**None of the three acceptance criteria this is judged on can be asserted
here** — whether the card actually renders in a consumer, whether the favicon
shows in a tab, and whether mobile chrome matches the theme all need a browser
and a deployed URL. They are the last three items of
[Manual check](#manual-check-widths-mobile-menu-theme-persistence) below.

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
| `src/components/ExperienceSection.tsx` | The Experience section's content: the section heading, and one entry per role by mapping `experiences` from `src/data/resume.ts` in the array's own order |
| `src/components/ExperienceEntry.tsx` | One role's card: title, company, dates and location, its timeline marker and connecting line, and its bullet highlights plus the show-more toggle |
| `src/components/ProjectsSection.tsx` | The Projects section's content: the section heading, and one card per entry of `projects` from `src/data/resume.ts` in the array's own order |
| `src/components/ProjectCard.tsx`  | One project's card: name and description, with the whole card being the link out to the project's GitHub repo |
| `src/components/AchievementsSection.tsx` | The Achievements section's content: the section heading, and one callout/stat card per entry of `achievements` from `src/data/resume.ts` in the array's own order |
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

**About, Skills, Experience, Projects and Achievements are filled in — by
`HeroSection`, `SkillsSection`, `ExperienceSection`, `ProjectsSection` and
`AchievementsSection`; the one registry entry that remains, Contact, is still
a placeholder** ("Coming soon."). `App.tsx` maps the registry as before and
picks each section's body in one place: a `sectionBody(section)` helper
switches on `section.id`, returning `<HeroSection>` for `about`,
`<SkillsSection>` for `skills`, `<ExperienceSection>` for `experience`,
`<ProjectsSection>` for `projects`, `<AchievementsSection>` for
`achievements` and the placeholder heading + "Coming soon." for everything
else. The `<section id aria-labelledby>` wrapper (and with it
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

The experience timeline **renders `experiences` in the array's own order and
sorts nothing in the component** — no `sort`, `reverse` or `slice` in
`ExperienceSection` or `ExperienceEntry`. `resume.ts` stores the roles
most-recent-first, and the reverse-chronological guarantee is asserted over
the data instead, by the `experiences are reverse-chronological` tests in
`src/data/resume.test.ts` (they parse each `dates` range and fail if a role
starts later than the one above it). A chronology re-derived in the view would
just be a second place for it to disagree with `resume.md`. The timeline is a
**single left-aligned column at every width** — the connecting line is each
entry's own left border with the marker disc straddling it, and the content
sits to its right; there is deliberately no alternating/two-sided variant,
which needs width a phone does not have. Bullet highlights collapse behind a
show-more toggle past `VISIBLE_HIGHLIGHTS` (4) — a role with five or more
hides the remainder — so a role that grows in `resume.ts` cannot silently turn
the section into a wall of text on a phone. **No current entry reaches that
threshold** (every role has three highlights), so the toggle does not render
against the live data; `ExperienceEntry.test.tsx` exercises the collapsing
against fixtures.

The projects section renders **every entry of the `projects` export as a card,
and the whole card is the link** to that project's GitHub repo — not a small
"view on GitHub" link tucked into a corner, so on a phone the thing to aim at
is the entire surface. It leaves the site, so it opens in a new tab with
`rel="noopener noreferrer"`, the same way the hero's GitHub button does. The
card grid is one column below `md`, two from `md` and three from `lg`, and a
card has no fixed height and no truncation: a long description wraps and grows
its card rather than being clipped. Walk the `Projects at …` items in
[Manual check](#manual-check-widths-mobile-menu-theme-persistence) below after
touching it. **Nothing on a card is derived** — no star count, language badge,
activity figure or ordering is computed from anything; a card's name,
description and URL are its `Project`'s and nothing else, so adding a project
means adding it to `src/data/resume.ts` first, as content.

The achievements section renders **every entry of the `achievements` export as
a callout/stat card, not a bullet list** — each one its own bordered surface on
`bg-surface`, deliberately distinct from the experience timeline's markers and
plain `<ul>` bullets so the two sections do not read as the same thing twice.
The large accented figure at the top of a card is that entry's `metric` field,
which is a **verbatim substring of the same bullet's `text`**; the full `text`
is rendered underneath on every card, with or without a figure, so the callout
is a pull-out rather than a summary and nothing in the resume is dropped or
reworded. Because the words are already there in the bullet, the figure is
`aria-hidden` — a screen reader hears the achievement once, not twice. The card
grid is one column below `md`, two from `md` and three from `lg`, and the
figure's font size steps up at `md` so it stays inside its card on a phone;
walk the `Achievements at …` items in
[Manual check](#manual-check-widths-mobile-menu-theme-persistence) below after
touching it. **Nothing on a card is derived or invented** — no percentage,
rating, progress bar or count is computed from the content, and an entry
without a `metric` simply renders no callout. A new figure has to be added to
`resume.md` and `src/data/resume.ts` first, as content, before it can appear
here.

The **theme toggle lives in the header bar** at both widths, next to the menu
button, rather than being duplicated into the mobile panel — one toggle in the
document, reachable at 375px and at 1440px alike.

The **skip link** ("Skip to content", `href="#main"`) is the first focusable
element in the document and is `sr-only` until focused, at which point it
becomes a visible pill in the top-left. A sticky header with a nav in front of
the content would otherwise cost a keyboard user a tab through every nav link
before reaching the page; `scroll-margin-top` on `section[id]` (see
`index.css`) keeps the header from covering whatever the anchor jumped to.

### Shared hooks

Two hooks sit beside the components rather than inside one of them, because
each is a browser behaviour several components borrow rather than markup any
one of them owns:

| Hook                   | What it does                                                                           |
| ---------------------- | -------------------------------------------------------------------------------------- |
| `src/useScrollLock.ts` | Freezes the page behind the mobile menu. `overflow: hidden` alone is not enough — iOS Safari still rubber-bands, so the body is pinned with `position: fixed` — and the cleanup restores the previous values *and* the scroll position, on close and on unmount-while-open alike, so unlocking does not jump the page to the top |
| `src/useTilt.ts`       | Tilts a card toward the pointer. It writes only four custom properties on the element — `--tilt-x` / `--tilt-y` for the rotation, `--spec-x` / `--spec-y` for the centre of the specular — leaving the perspective, the gradient and the settle-back transition to the `tilt-card` utility in `index.css`. Used by `ProjectCard.tsx`, `AchievementsSection.tsx` and `SkillsSection.tsx` |

**`useTilt` no-ops twice over, and both no-ops are the point.** Before
attaching anything it reads `(hover: none)` and
`(prefers-reduced-motion: reduce)`; if either matches it registers no
listeners and writes no properties at all, so the element keeps the rest values
`tilt-card` declares — an identity transform and a centred highlight. A touch
screen therefore gets no tilt (one that followed a finger would fight the
scroll) and a reader who asked for reduced motion gets no card moving under
the cursor. The two queries are read once, up front, with no `change` listener
registered: several suites stub `matchMedia` with a single fake object shared
by every query, and a hook that subscribed would show up in their listener
counts. `index.css`'s reduced-motion block also flattens `.tilt-card` in CSS —
belt to the hook's braces, covering a preference changed after the hook has
already attached.

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
plus radii, and then maps them onto eight semantic tokens. The brand ramp is
one acid-green hue (the hue of `#39ff14`) stepped in lightness, so the bright
steps carry the radioactive dark-mode accent and the dark steps are printable
enough to carry light-mode text; the neutral ramp gains two rungs below the
cool gray (`neutral-850`, `neutral-950`) for the ink-black dark palette, so
every semantic token still aliases a ramp step rather than a literal.

| Token                | Used for                                  |
| -------------------- | ----------------------------------------- |
| `--color-bg`         | page background                           |
| `--color-surface`    | raised surfaces: cards, panels, code blocks |
| `--color-text`       | primary body text                         |
| `--color-muted`      | secondary/supporting text                 |
| `--color-border`     | hairlines, dividers, card borders         |
| `--color-accent`     | links, emphasis, interactive affordances  |
| `--color-glow`       | the accent carried with alpha — used **only** as a `box-shadow` / `text-shadow` colour: the halo behind headings and metrics, the bloom on a hovered card or button, the shoulders of the hover sweep |
| `--color-accent-dim` | the bright core of a gradient — the specular pool on a tilted card, and the middle of the sweep bar in the dark palette (light uses `--color-glow` there; see below) |

(`--color-accent-contrast` is also available for text placed *on* an accent
fill, and `--color-border-strong` for the boundary of an outlined control —
see [`--color-border` vs `--color-border-strong`](#--color-border-vs---color-border-strong).)

**The two glow tokens are declared in both palettes and painted in only one.**
`--color-glow` and `--color-accent-dim` exist in the light `@theme` block as
well as in `.dark`, because `src/theme-contrast.test.ts` fails any token one
palette declares and the other does not — neither palette may fall back to an
undefined value. But the utilities that read `--color-glow` as a shadow are
scoped to `.dark` (see below), so **light mode never draws a halo**: it is the
printable variant of the same hue, not a dimmed copy of the dark one. Both
tokens are also deliberately outside that suite's contrast pairs — neither is
ever a fill or a text colour, and a glow that misses 4.5:1 is a dim glow rather
than unreadable text.

**Components should use the semantic tokens, not the raw palette steps.**
Write `bg-bg text-text border-border text-accent` rather than
`bg-white dark:bg-neutral-900` — the semantic tokens are reassigned for dark
mode in one place, so a component built on them needs no `dark:` variants at
all. Reach for `brand-*` / `neutral-*` directly only when adding a new
semantic token.

### The accent's treatments: `glow-text`, `glow-ring`, `tilt-card`, `sweep`

Four named `@utility` rules in `src/index.css` carry everything the neon accent
does beyond being a colour:

| Utility     | What it draws                                                                                     | Carried by                                                                                                              |
| ----------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `glow-text` | Two stacked `text-shadow`s in `--color-glow` — a halo close in, a wider bloom behind it            | The hero's `<h1>`, every section `<h2>`, the achievement metric callouts, and the header nav links on hover/focus         |
| `glow-ring` | A `box-shadow`: a hairline in `--color-accent` plus a bloom in `--color-glow`                       | `hover:` and `focus-visible:` on the project cards, the hero CTAs and the two show-more buttons                           |
| `tilt-card` | The `perspective(800px)` rotation driven by `--tilt-x` / `--tilt-y`, and an `::after` radial specular centred on `--spec-x` / `--spec-y` | The project cards, the achievement cards and the skill group cards — each paired with `useTilt` (see [Shared hooks](#shared-hooks)) |
| `sweep`     | A `::before` gradient bar that translates from off-canvas left to off-canvas right over 600ms, on a hovering pointer or on keyboard focus | The hero CTAs and the header nav links, each with `overflow-hidden` so the bar is clipped to the control                  |

**They are utilities in `index.css`, not bracketed arbitrary values in a
component's class list, on purpose.** Every one of them needs a number a
browser has to be told exactly — an 800px perspective, a 24px blur radius, a
600ms duration, a five-stop gradient — and `test/layout-contract.test.ts`
exists to keep magic numbers of that kind out of the shell's source, where six
copies could each drift on their own. Naming them here gives one definition to
retune and one string to grep for. (This README follows the same rule the
contract test does and never writes a bracketed class name out in full:
Tailwind v4 scans every file in the project, so a literal example in prose
would be emitted into the shipped CSS.)

Three details worth knowing before applying them:

- **The glows self-scope to the dark palette; the sweep does not.** `glow-text`
  and `glow-ring` wrap their declarations in the same `.dark` predicate
  `@custom-variant dark` uses, so a component writes them unprefixed and they
  simply paint nothing in light mode. The sweep is a motion affordance rather
  than the dark palette's signature, so it runs in both palettes at each one's
  own accent steps.
- **The sweep's hover clause is gated on `(hover: hover)`, and its band is
  palette-scoped.** Two things about it are easy to get wrong a second time.
  A hand-written `:hover` rule inside an `@utility` is *not* wrapped in the
  media query Tailwind compiles its own `hover:` variants into, and mobile
  browsers apply `:hover` to whatever was last tapped — so the clause writes
  that query itself, leaving `:focus-visible` outside it for keyboards. And the
  band's centre stop is a local property with a light default and a `.dark`
  override, not `--color-accent-dim` in both: the light primary CTA is white on
  brand-800 and has 4.75:1 to give once its own hover dimming composites, so a
  stop brighter than that fill drops the label to 3.60:1. Light therefore
  carries the alpha'd `--color-glow`, which composites to the accent fill it
  sits on and still reads as a band over the outlined CTAs and the nav links.
  `test/rice-contract.test.ts` measures both palettes' composites, and the
  600ms lives on the hover and focus clauses only, so losing the state parks
  the bar instead of animating it back across the label.
- **`glow-ring` is not a focus ring.** The ring is still `FOCUS_RING` from
  `src/styles.ts` and still an `outline` — `test/layout-contract.test.ts`
  forbids a component declaring one itself — so under `focus-visible:` the
  outline and the `box-shadow` compose instead of one replacing the other.

`test/rice-contract.test.ts` pins all of this as source text: that each utility
is declared with the pieces that make it work, that the glows are `.dark`-scoped,
that the single `prefers-reduced-motion` block neutralises the tilt and the
sweep and leaves the glow alone, and that the components which are supposed to
carry each class still carry it. It asserts nothing about rendering — jsdom
applies no stylesheet, so a "the card is rotated" assertion there would pass
whether or not `index.css` declared the transform. Whether the halo, the tilt
and the sweep actually *look* right is the last four items of
[Manual check](#manual-check-widths-mobile-menu-theme-persistence).

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

## Accessibility

The accessibility pass is split the same way the mobile-first contract below
is, and for the same reason: the parts of it that are *structural facts about
the page* are asserted mechanically, and everything that needs a rendering
engine stays a person's check in
[Manual check](#manual-check-widths-mobile-menu-theme-persistence).

| File | What it asserts |
| ---- | --------------- |
| `src/a11y.test.tsx` | The page-wide contract over the tree `<App />` renders: exactly one `banner`, `navigation`, `main` and `contentinfo` landmark and exactly one `<h1>` (the hero's name); heading levels that never jump by more than one; the skip link being the first focusable element and targeting the `#main` landmark; a non-empty accessible name on every link and button; an `alt` attribute on every rendered `<img>` (plus a source sweep, since the page renders none today) and `aria-hidden` on every decorative `<svg>`; and a `focus-visible:outline-*` ring and a 44px `min-h-11` floor on every control — re-run with the mobile menu open, so the panel's links are held to the same rules |
| `src/theme-contrast.test.ts` | Token parity and declared contrast over `src/index.css` read as text: every property `.dark` reassigns exists in `@theme` and every semantic `@theme` token is reassigned in `.dark`, so neither palette can fall back to an undefined value; and each semantic token resolved through the ramps to a hex, with the WCAG 2.x ratio computed per theme — 4.5:1 for text pairs (AA 1.4.3) and 3:1 for `--color-border-strong` (AA 1.4.11) |
| `test/layout-contract.test.ts` | The source guards: no width or minimum width pinned in pixels, no `overflow-x-hidden`, no arbitrary font size below `1rem`, no gap under `gap-2`, the three content columns padded to the same edges, no `<a>` or `<button>` missing the `min-h-11` 44px tap-target floor, and no component declaring the focus ring itself instead of importing `FOCUS_RING` from `src/styles.ts` |
| `test/index-html.test.ts` | The document-level half a client-rendered page cannot assert from the React tree: the `lang` attribute on `<html>`, and that nothing focusable sits outside `#root` — which is what lets "first focusable element of the render" mean "first focusable element of the page" |
| `test/rice-contract.test.ts` | The source pins for the accent's treatments, read as text out of `src/index.css` and the components: each of `glow-text`, `glow-ring`, `tilt-card` and `sweep` declared with the pieces that make it work, the two glows scoped to `.dark` so light mode is the printable variant, one `prefers-reduced-motion` block that names the tilt and the sweep and neutralises both while leaving the static glow alone, the sweep's hover clause inside `(hover: hover)` with its duration on the crossing rather than the return, and the components that are meant to carry each class still carrying it. Plus the one piece of arithmetic the palette suite cannot do: the sweep bar is a translucent overlay between a control's background and its label, so this file composites its centre stop over each palette's accent fill and page background — the primary CTA's own hover dimming included — and holds every label it can sit under to 4.5:1 |
| `src/useTilt.test.ts` | The behaviour of `src/useTilt.ts` against a stubbed `matchMedia`: all four custom properties written on `pointermove`, the rotation signed toward the pointer and clamped to `max`, the properties reset on `pointerleave`, both listeners removed on unmount, and **nothing attached or written at all** under `(hover: none)` or `(prefers-reduced-motion: reduce)` — the touch and reduced-motion contracts, which the CSS half cannot express |

`src/styles.ts` is why the per-control assertions are possible at all: the focus
ring (`FOCUS_RING`) and the 44px target (`TAP_TARGET`, `TAP_TARGET_HEIGHT`) are
one string each, imported by every component, so one test can sweep every
control for them. Six private copies of the same class list could each drift on
their own, and nothing page-wide could check a floor that is only ever written
locally.

**A green CI run still says nothing about rendered layout, focus visibility or
real contrast.** There is no browser in the runner. jsdom reports every width as
0 and applies no Tailwind stylesheet at all, so nothing above knows whether a
focus ring is actually drawn, whether a 44px minimum survives its container,
whether anything overflows at 320px, or what a browser really composites — a
translucent overlay, a hover state, a sticky header on top of text. The
contrast numbers are arithmetic on declared token values: they catch a token
moved down the ramp and nothing else. All of that is why the checklist below
exists, and why the Lighthouse and axe items in it are the acceptance criteria
rather than a suite.

### `--color-border` vs `--color-border-strong`

The border token is split in two, in both palettes:

- `--color-border` (light `neutral-200`, dark `neutral-700`) draws **decorative
  rules** — the header and footer hairlines, the experience timeline's
  connecting line, the skill chips, and the card borders in the skills,
  projects and achievements grids. At 1.24:1 on the light background (1.92:1 on
  the ink-black dark one) it is a divider, not a boundary anything is
  identified by.
- `--color-border-strong` (light `neutral-500`, dark `neutral-400`) draws the
  **visual boundary of an outlined control** — the header's menu and close
  buttons, the theme toggle, the hero's secondary CTAs and the experience
  show-more button. WCAG 2.1 AA 1.4.11 (Non-text Contrast) wants 3:1 for a
  boundary that is what identifies a component, and it clears that in both
  themes (4.83:1 / 4.63:1 light, 7.80:1 / 7.26:1 dark on `bg` and `surface` —
  the dark pair rose when the background went ink black).
  `theme-contrast.test.ts` pins those thresholds; `--color-border` is
  deliberately absent from that table.

**The project card was left on the decorative token on purpose, and that is a
human review item.** A project card is the only card on the page that is itself
a control — the whole card is the link — so an argument exists for giving it the
3:1 boundary. It keeps `border-border` because it is a filled `bg-surface`
surface with its own hover (`hover:border-accent`) and focus-ring treatments, so
its border is not the only thing identifying it, and because matching the
neighbouring achievement and skill cards is the intended visual system. Whether
that trade is right is a design call about how the grid reads, which no test in
this repo can make — walk the `Projects at …` items and the axe run in the
checklist below and decide it by eye.

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
gap under `gap-2`, on a content column whose horizontal padding differs
from the other two, and on an `<a>` or `<button>` that lacks the `min-h-11`
44px tap-target floor. It reads the source rather than a rendered tree because
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

Most of this matrix still needs a person and a browser, so walk this list by
hand when changing the shell. `npm run dev`, then in devtools responsive
mode. Two specific things are no longer only walked by hand: `site/e2e/responsive.spec.ts`
runs in CI (the `responsive` job — see
[Continuous integration](#continuous-integration)) against a real Chromium at
320, 375, 768 and 1440px, asserting the no-horizontal-overflow check
(`document.documentElement.scrollWidth === clientWidth`) and the menu-button /
inline-nav swap at those same widths. Everything else below — text
overlap/clipping, tap-target spacing by eye, contrast, real-device checks,
Lighthouse, axe — is not covered by that suite and stays a person's check.

**The matrix.** Every cell below is one pass: a width, walked over *every*
section, in *both* palettes. Flip the palette with the in-page theme toggle, or
from the console:

```js
document.documentElement.classList.add('dark') // or .remove('dark')
```

At every width, in the light theme and then again in the dark one, walk Hero
(About), Skills, Experience, Projects, Achievements and the Contact placeholder
and check three things in each: no horizontal scroll, no text clipped,
truncated or overlapping, and no tap target cramped against its neighbour.

| Width  | Stands in for            | Layout expected there                                              |
| ------ | ------------------------ | ------------------------------------------------------------------ |
| 320px  | smallest common phone    | one column everywhere; the contract's floor — nothing may overflow  |
| 375px  | iPhone SE / standard phone | one column; header collapsed to the menu button                   |
| 768px  | tablet / iPad portrait (`md`) | inline nav has taken over; the card and skill grids are two columns |
| 1024px | tablet landscape / small laptop (`lg`) | the grids are three columns, still inside `max-w-5xl` |
| 1440px | desktop                  | content centred in its `max-w-5xl` column, header and footer aligned |

- [ ] All five widths × both palettes × every section, per the paragraph above:
      **10 passes**, and the horizontal-scroll check in each of them is the
      console reporting `true` for:
      ```js
      document.documentElement.scrollWidth === document.documentElement.clientWidth
      ```
      Nothing below replaces this sweep — the per-section items are what to
      look at closely inside each cell.
- [ ] **320px** (smallest supported) — no horizontal scrollbar, and the
      console reports equal values for:
      ```js
      document.documentElement.scrollWidth === document.documentElement.clientWidth
      ```
- [ ] **375 × 667** (iPhone SE) — same check; the header is collapsed to the
      menu button and still leaves most of the viewport to content.
- [ ] **768px** (the `md` breakpoint) — the inline nav has taken over from the
      menu button, with nothing overlapping or clipped.
- [ ] **1024px** (the `lg` breakpoint, tablet landscape / small laptop) — the
      skills, projects and achievements grids have gone from two columns to
      three without a card's content being squeezed into a scrollbar or a
      clipped line, the nav still fits the bar on one line, and
      `scrollWidth === clientWidth` still holds. This is the first width at
      which the three-column layouts are narrower than they are at 1440px —
      `max-w-5xl` (64rem) is wider than the viewport here, so the column is the
      viewport minus its padding rather than its full width.
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
- [ ] **Download PDF at 375px, then again on the live site** — there is no
      browser in the CI runner, so this one stays a person's check like the
      rest of the list; the classes behind it (`min-h-11`, `w-full`,
      `sm:w-auto`, the group's `gap-3`) are pinned by
      `src/components/HeroSection.test.tsx`, but whether the file actually
      arrives is a person's check.
      - The button is full width at phone width, at least 44px tall (inspect
        it: its box height in devtools is ≥ 44) and at least 8px clear of the
        GitHub button below it.
      - Tap it on a **real mobile browser** (not just devtools' responsive
        mode): mobile browsers differ, so either the file downloading or it
        opening in a new tab is correct — what must not happen is a 404, a
        blank tab or any other error.
      - Repeat the tap **against the live URL**
        (https://brettbergin.github.io/resume/), not only against
        `npm run dev`. The two serve the PDF by different routes: the dev
        server streams the repo-root file through the plugin's middleware,
        while Pages serves the copy the build emitted into `dist/`. A green
        check on `npm run dev` therefore says nothing about the deployed
        button — see [The resume PDF](#the-resume-pdf).
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
- [ ] **Experience at 375px** — the timeline reads as one left-aligned column
      (marker and connecting line on the left, the role's content to its
      right), with no horizontal scrollbar (same `scrollWidth === clientWidth`
      check), and company, title, dates and location wrapping onto a second
      line rather than being clipped or truncated.
- [ ] **Experience at 768px and at 1440px** — the entries stay inside the
      shared `max-w-5xl` column, their edges aligned with the header bar and
      the footer, with nothing overlapping or pushed past the column's right
      edge.
- [ ] **Show-more toggle**, if any role's bullets have grown past four so it
      renders: the button is comfortably tappable at 375px (inspect it: its
      box height in devtools is ≥ 44), and expanding it reveals the remaining
      bullets without widening the page.
- [ ] **Show earlier roles toggle** — below the timeline, a "Show N earlier
      roles" button is present, comfortably tappable at 375px (box height in
      devtools is ≥ 44), and pressing it reveals the older roles in place
      (immediately after the 3 most recent) without widening the page;
      pressing it again ("Show less") collapses back to 3, independent of any
      individual role's own show-more toggle.
- [ ] **Projects at 375px** — the cards read as a single stacked column, the
      whole card is the tap target (press anywhere on it, not just the name,
      and the repo opens in a new tab), each description wraps onto as many
      lines as it needs rather than being clipped, and there is no horizontal
      scrollbar (same `scrollWidth === clientWidth` check). Repeat it at 320px,
      the contract's floor — the longest name and description must still wrap
      inside the card rather than widening the page.
- [ ] **Projects at 768px and at 1440px** — the grid expands to two columns and
      then to three inside the shared `max-w-5xl` column, its outer edges
      aligned with the header bar and the footer, with the cards in a row
      squared off to the same height and nothing clipped or pushed past the
      column's right edge.
- [ ] **Achievements at 375px** — the cards read as a single stacked column,
      the large stat numbers (`10+ million users`, `500,000+ endpoints`) sit
      inside their card without overflowing it or breaking mid-number, and
      there is no horizontal scrollbar (same `scrollWidth === clientWidth`
      check). Repeat it at 320px, the contract's floor — both figures must
      still wrap inside the card rather than widening the page.
- [ ] **Achievements at 768px and at 1440px** — the grid expands to two
      columns and then to three inside the shared `max-w-5xl` column, its
      outer edges aligned with the header bar and the footer, and the cards
      still read as bordered callouts rather than looking like another copy of
      the experience timeline.
- [ ] **No proficiency bars, ratings or percentages** on any chip — the source
      resume has none, so any such figure would be invented. Chips are plain
      labels, and each has visible padding and spacing rather than running
      together into one block of text.
- [ ] **Hero links work**: the GitHub button opens the profile in a new tab
      and the Email button opens a mail composer. "Download PDF" has its own
      item above — it needs checking on the live site too, not only under
      `npm run dev`.
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
- [ ] **Keyboard-only walk, from a fresh load.** Reload, click nothing, and
      Tab from the very top of the page with the mouse untouched. `a11y.test.tsx`
      pins the ring's *class* on every control; whether a ring is actually
      drawn, and whether the element it is drawn on is scrolled into view rather
      than sitting under the sticky header, is only visible in a browser.
      - The **first stop is the "Skip to content" link** — nothing precedes it
        — it becomes visible while focused (it is `sr-only` otherwise), and
        Enter jumps to `<main>` so the next Tab lands inside the content rather
        than back at the nav.
      - Tab back to the top and continue through **every subsequent stop**:
        wordmark, the inline nav links (or the menu button below `md`), the
        theme toggle, the hero's three CTAs, each project card, the show-more
        button if any role renders one, and the footer's email and GitHub
        links. Each one shows a **visible focus ring** and is fully on screen
        when it takes focus.
      - Nothing is reachable that should not be, and nothing interactive is
        skipped: the tab order matches reading order, and no stop is a dead
        element that swallows focus without doing anything on Enter/Space.
      - Then the mobile menu's open/trap/Escape walk — the `Mobile menu,
        keyboard only` item above — which is the one place focus is deliberately
        confined.
      - Repeat the whole walk **in the dark palette**: the ring is
        `outline-accent`, and the accent token is a different colour there.
- [ ] **Theme persistence**: toggle to the other theme, reload the page, and
      confirm it comes up in the chosen theme with no flash of the other
      palette. Clear the `resume-theme` key in devtools > Application >
      Local Storage, reload, and confirm it follows the OS preference again.
- [ ] Repeat the width checks with the dark palette applied
      (`document.documentElement.classList.add('dark')`) — both palettes must
      pass. This is the second half of every cell of the matrix at the top of
      this list, not an extra pass over one width.
- [ ] **Tap targets: ≥ 44×44 with spacing, at 320px and then at 375px.** The
      classes are pinned (`min-h-11` / `min-w-11` from `src/styles.ts`, asserted
      on every control by `src/a11y.test.tsx`), but a minimum height says
      nothing about the box a browser actually lays out — a flex parent, a
      wrapped line or a shrunk container can all leave the rendered target
      smaller than the utility promises. So inspect the real boxes: select each
      of these in devtools and read its computed width and height off the box
      model, both **≥ 44**.
      - The menu button, and — with the panel open — its close button and each
        of the six section links.
      - The theme toggle in the header bar.
      - The hero's three CTAs (Download PDF, GitHub, Email).
      - Each project card (the whole card is the target).
      - The show-more button, if any role's bullets have grown past four.
      - The footer's email and GitHub links.
      - And between them: at least 8px of clear space to the next target in
        every direction. Two 44px targets 4px apart still mis-tap. Where a row
        wraps at 320px, check the *vertical* gap between the wrapped lines too
        — that is the one the `gap-*` utility is easiest to lose.
- [ ] **Social preview, against the live URL** — the tags and the PNG are
      pinned by `test/metadata.test.ts` and `test/assets.test.ts`, but whether
      a consumer actually renders the card is a person's check, and it can only
      be made against something deployed. Paste
      https://brettbergin.github.io/resume/ into a Slack or Discord message
      draft (don't send it — the unfurl appears in the composer), or into any
      card validator, and confirm **all three** of the image, the title and the
      description appear. Text with no picture almost always means the
      `og:image` went relative, or the PNG 404s at the URL the tag names — open
      that URL directly to tell the two apart.
      - **A first paste may be served from the consumer's cache**, including a
        cache entry created by an earlier paste of the same URL before the
        deploy landed. Re-check after the Pages deploy has completed, and if a
        stale card comes back use the platform's own re-scrape (X's card
        validator, or appending a throwaway `?1` to the URL) rather than
        assuming the tags are wrong.
- [ ] **Favicon in the browser tab** — load the site and confirm the tab shows
      the acid-green mark rather than a blank page glyph or Vite's default bolt.
      Check it on the live URL as well as under `npm run dev`: the icon is
      served out of `public/`, and Vite rewrites its href for the `/resume/`
      base, so the two are not the same request. On a real iOS device, "Add to
      Home Screen" and confirm the 180x180 `apple-touch-icon.png` is what lands
      on the home screen — crisp, not a resampled screenshot of the page.
- [ ] **Mobile browser chrome matches the theme** — on a real phone (devtools
      cannot show browser chrome), load the site and confirm the address-bar
      area matches the page background rather than the browser's default:
      `#ffffff` in light, `#0a0a0a` in dark. Check both, and check the
      **stored-override case specifically**: with the OS set to light, use the
      in-page toggle to switch to dark, then reload. The stored `resume-theme`
      choice wins over the OS preference, so the chrome must come up dark on
      that first paint — if it flashes or stays light, the `theme-color` swap
      in the inline `<head>` script is not running before the paint. Repeat
      with the OS set to dark and the toggle set to light.
- [ ] **Lighthouse accessibility ≥ 95, against the live URL**
      (https://brettbergin.github.io/resume/), not `npm run dev`. Chrome
      devtools > Lighthouse > Accessibility, or
      `npx lighthouse https://brettbergin.github.io/resume/ --only-categories=accessibility`.
      The score is the acceptance criterion for issue #11; the audits it fails
      are the useful part, so read them even when the number clears 95.
- [ ] **Lighthouse mobile run, no major mobile-usability warnings.** Same URL,
      device *Mobile*, with the Performance and Best Practices categories on.
      What must not appear: "Tap targets are not sized appropriately" or
      "Content is not sized correctly for the viewport" — the two audits that
      correspond to the tap-target and horizontal-scroll sweeps above, measured
      by a real engine instead of by eye.
- [ ] **axe, in both themes, no contrast failures.** Run the axe DevTools
      extension (or `@axe-core/cli`) over the page once in the **light** palette
      and once in the **dark** one — toggling the theme changes every colour on
      the page, so a single run covers half the site. `src/theme-contrast.test.ts`
      computes ratios from the declared tokens; axe measures what the browser
      actually composited, which is the only thing that catches a hover state,
      an `sr-only` element made visible, or text over a translucent surface.
      Zero `color-contrast` violations in each theme.
- [ ] **The tilt follows the cursor, on a desktop pointer, in the dark
      palette.** `test/rice-contract.test.ts` proves `tilt-card` declares the
      perspective and `src/useTilt.test.ts` proves the hook writes the four
      properties, but nothing in either says a browser composited a rotation:
      jsdom applies no stylesheet at all. So move a real mouse across a project
      card, an achievement card and a skill group card at 1440px and confirm
      each one **leans toward the pointer** (right of centre rotates it about
      Y, above centre lifts the top edge), that the specular sheen tracks the
      cursor rather than sitting in the middle, and that it **settles back
      flat** when the pointer leaves rather than snapping. While a card is
      tilted its text must stay legible and inside its own border, and the
      sheen must stay a sheen — if it reads as a wash over the words, the
      `::after` opacity is too high.
      - A tilted card must not widen the page: check
        `document.documentElement.scrollWidth === document.documentElement.clientWidth`
        with the pointer parked on the right-hand column's outermost card at
        1440px and again at 768px.
      - Confirm the headings and the achievement metric callouts carry their
        halo, that a hovered card and a hovered hero CTA bloom, and that a CTA
        and a header nav link each show the **sweep crossing once**,
        left to right, rather than a bar parked over the label — and that
        moving the pointer away **parks** the bar rather than running it back
        across the label a second time.
- [ ] **Touch devices get no tilt and no sweep.** On a real phone or tablet
      (not devtools' responsive mode — it still reports a hovering pointer),
      press and drag on a project card, an achievement card and a skill group
      card: the card must stay flat, no highlight may follow the finger, and
      **the drag must scroll the page** rather than being swallowed by the
      card. Tapping a project card still opens its repo. This is
      `src/useTilt.ts`'s `(hover: none)` early return, and a device is the only
      place it can be seen.
- [ ] **Light mode is the same hue with no glow.** Toggle to light and confirm
      the accent is recognisably the *same* green as the dark palette's, just
      dark enough to read as text — not a second hue, and not the dark accent
      dimmed until it looks like a mistake. **No halo anywhere:** no bloom
      behind an `<h1>`, an `<h2>` or a metric callout, and none around a
      hovered card, CTA or show-more button. Hover and focus still have to be
      visible without it — the border, text-colour and focus-ring changes are
      what carry the state here, so walk the keyboard-only pass in light too.
      The sweep *is* expected in light mode (it is motion, not bloom), in the
      light accent steps — on the outlined CTAs and the header nav links. On
      the filled primary CTA the light band is the accent at alpha over the
      accent fill, so it composites to that fill and is deliberately invisible:
      that is what keeps the white label at 4.75:1 while it is hovered.
- [ ] **Reduced motion leaves the page fully usable.** Turn the OS preference
      on (macOS *Reduce motion*, Windows *Show animations off*, or devtools >
      Rendering > *Emulate CSS prefers-reduced-motion*), reload, and walk the
      page: **no card tilts** under the pointer and no specular follows it, no
      sweep bar crosses a CTA or a nav link, and same-page nav links jump to
      their section instead of smooth-scrolling. Everything must still *work*
      — every hover and focus state still visibly changes, the mobile menu
      still opens and closes, the show-more toggles still expand — and the
      **glow stays on**, because a `text-shadow` is static paint rather than
      movement. A control that became indistinguishable from its resting state
      is the failure to look for.
