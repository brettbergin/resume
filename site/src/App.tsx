/*
 * The layout shell every content section renders inside: skip link, sticky
 * header (with the theme toggle in its bar), one anchored <section> per entry
 * of the section registry, and the footer.
 *
 * Sections are filled in one at a time by their own change, and the ones that
 * have not had theirs yet are placeholders. What this file owns is the
 * *shell*: exactly one banner, one main landmark and one contentinfo, and the
 * guarantee that every nav href has a matching id on the page, because both
 * come from `sections`.
 *
 * It is also the router, in the smallest sense the site needs one. There is no
 * routing library and no second HTML entry: `location.hash` is read into
 * state, and a hash naming the `~/tools` route (`#/tools`, `#/tools/jwt?i=…`)
 * swaps the sections for `ToolsPage` inside the same `<main>`. A fragment
 * costs no build change, keeps the deployment a single page — the sitemap, the
 * metadata and the Pages workflow all still describe one document — and works
 * on GitHub Pages, which has no rewrite rule to send `/resume/tools/` back to
 * `index.html`. Anything the tools page needs to remember rides in that same
 * fragment, which is the one part of a URL the browser never sends.
 */

import { useEffect, useState } from 'react'

import { AchievementsSection } from './components/AchievementsSection.tsx'
import { BootSequence } from './components/BootSequence.tsx'
import { ContactSection } from './components/ContactSection.tsx'
import { Cursor } from './components/Cursor.tsx'
import { ExperienceSection } from './components/ExperienceSection.tsx'
import { Footer } from './components/Footer.tsx'
import { Header } from './components/Header.tsx'
import { HeroSection } from './components/HeroSection.tsx'
import { ProjectsSection } from './components/ProjectsSection.tsx'
import { SkillsSection } from './components/SkillsSection.tsx'
import { ThemeToggle } from './components/ThemeToggle.tsx'
import { ToolsPage } from './components/tools/ToolsPage.tsx'
import { sections } from './data/sections.ts'
import type { PageSection } from './data/types.ts'
import { FOCUS_RING } from './styles.ts'
import { isToolsRoute } from './tools/fragment.ts'

/* First focusable element in the document, and invisible until it takes focus:
 * a sticky header with a nav in front of the content would otherwise cost a
 * keyboard user a tab through every nav link on every visit.
 *
 * Every style here is `focus:`-prefixed, the height included, because the link
 * has no box at all until it is focused — the shared `TAP_TARGET_HEIGHT` would
 * give an `sr-only` element a 44px minimum it can never show. The shared ring
 * still applies: the link is one of the shell's controls, and until now it was
 * the only one drawing no focus indicator of its own. */
const SKIP_LINK =
  'sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 ' +
  'focus:inline-flex focus:min-h-11 focus:items-center focus:rounded-pill ' +
  `focus:border focus:border-border focus:bg-surface focus:px-4 focus:text-text ${FOCUS_RING}`

/* One branch per filled-in section, and the <section> wrapper in App stays the
 * registry's either way — it owns the anchor id the nav and the scroll offset
 * depend on. A filled section renders the heading its wrapper is labelled by,
 * from the registry's label so the nav and the on-page heading cannot drift;
 * the rest keep the placeholder.
 *
 * `index` is the section's 1-based place in the registry, which is the number
 * SectionHeading paints in front of the label. It is passed down rather than
 * counted inside a section because only this map knows the nav order: About is
 * 1 and is the hero, so the numbered headings run `02 / Skills` to
 * `06 / Contact`. */
function sectionBody(section: PageSection, index: number) {
  const headingId = `${section.id}-heading`

  switch (section.id) {
    case 'about':
      return <HeroSection headingId={headingId} />
    case 'skills':
      return (
        <SkillsSection
          headingId={headingId}
          heading={section.label}
          index={index}
        />
      )
    case 'experience':
      return (
        <ExperienceSection
          headingId={headingId}
          heading={section.label}
          index={index}
        />
      )
    case 'projects':
      return (
        <ProjectsSection
          headingId={headingId}
          heading={section.label}
          index={index}
        />
      )
    case 'achievements':
      return (
        <AchievementsSection
          headingId={headingId}
          heading={section.label}
          index={index}
        />
      )
    case 'contact':
      return (
        <ContactSection
          headingId={headingId}
          heading={section.label}
          index={index}
        />
      )
    default:
      return (
        <>
          <h2 id={headingId} className="glow-text text-2xl font-medium">
            {section.label}
          </h2>
          <p className="mt-2 text-base text-muted">Coming soon.</p>
        </>
      )
  }
}

function App() {
  /* The router, in full. Initialised from the hash rather than defaulted, so a
   * link straight to a tool renders the tool on the first paint instead of
   * flashing the resume. */
  const [hash, setHash] = useState(() => window.location.hash)

  useEffect(() => {
    function handleHashChange() {
      setHash(window.location.hash)
    }

    window.addEventListener('hashchange', handleHashChange)
    return () => {
      window.removeEventListener('hashchange', handleHashChange)
    }
  }, [])

  const onTools = isToolsRoute(hash)

  /* Anchor scrolling across a route change, which the browser cannot do for
   * itself: leaving `#/tools` for `#skills` is a hash change the browser
   * resolves *before* React has rendered the sections, so it finds no element
   * and leaves the reader at the top — and clicking the same link again fires
   * no second `hashchange`. Scrolling here, after the render that created the
   * element, is the one bit of navigation the fragment does not get for free.
   * `?.()` because jsdom implements no scrollIntoView. */
  useEffect(() => {
    if (onTools) return
    const id = hash.replace(/^#/, '')
    if (id === '') return
    document.getElementById(id)?.scrollIntoView?.()
  }, [hash, onTools])

  return (
    <div className="flex min-h-svh flex-col bg-bg text-text">
      <a href="#main" className={SKIP_LINK}>
        Skip to content
      </a>

      {/* The boot animation is the resume's front door and belongs to that
          route only: a shared `#/tools/jwt?i=…` link opening behind a typing
          animation would hide the thing the link was sent to show. */}
      {onTools ? null : <BootSequence />}

      {/* Chrome for the whole document rather than any one section, so it
          sits outside <main>: two fixed, `pointer-events-none`, aria-hidden
          elements that paint in place of the OS arrow. It renders nothing at
          all on a touch screen or under reduced motion. */}
      <Cursor />

      <Header>
        <ThemeToggle />
      </Header>

      {/* Horizontal padding is written out separately from the vertical step
          so it can be kept identical to the header bar's and the footer's:
          the three columns are the same width and centred, so a padding step
          on one of them alone puts their left edges on different pixels.
          test/layout-contract.test.ts asserts they agree. */}
      <main
        id="main"
        className="mx-auto w-full max-w-5xl px-4 py-4 md:px-8 md:py-8"
      >
        {onTools ? (
          <ToolsPage />
        ) : (
          sections.map((section, index) => (
            <section
              key={section.id}
              id={section.id}
              aria-labelledby={`${section.id}-heading`}
              className="py-8 first:pt-0"
            >
              {sectionBody(section, index + 1)}
            </section>
          ))
        )}
      </main>

      <Footer />
    </div>
  )
}

export default App
