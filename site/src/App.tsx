/*
 * The layout shell every content section renders inside: skip link, sticky
 * header (with the theme toggle in its bar), one anchored <section> per entry
 * of the section registry, and the footer.
 *
 * Sections are filled in one at a time by their own change, and the ones that
 * have not had theirs yet are placeholders. What this file owns is the
 * *shell*: exactly one banner, one <main> and one contentinfo, and the
 * guarantee that every nav href has a matching id on the page, because both
 * come from `sections`.
 */

import { AchievementsSection } from './components/AchievementsSection.tsx'
import { ContactSection } from './components/ContactSection.tsx'
import { ExperienceSection } from './components/ExperienceSection.tsx'
import { Footer } from './components/Footer.tsx'
import { Header } from './components/Header.tsx'
import { HeroSection } from './components/HeroSection.tsx'
import { ProjectsSection } from './components/ProjectsSection.tsx'
import { SkillsSection } from './components/SkillsSection.tsx'
import { ThemeToggle } from './components/ThemeToggle.tsx'
import { sections } from './data/sections.ts'
import type { PageSection } from './data/types.ts'
import { FOCUS_RING } from './styles.ts'

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
 * the rest keep the placeholder. */
function sectionBody(section: PageSection) {
  const headingId = `${section.id}-heading`

  switch (section.id) {
    case 'about':
      return <HeroSection headingId={headingId} />
    case 'skills':
      return <SkillsSection headingId={headingId} heading={section.label} />
    case 'experience':
      return <ExperienceSection headingId={headingId} heading={section.label} />
    case 'projects':
      return <ProjectsSection headingId={headingId} heading={section.label} />
    case 'achievements':
      return (
        <AchievementsSection headingId={headingId} heading={section.label} />
      )
    case 'contact':
      return <ContactSection headingId={headingId} heading={section.label} />
    default:
      return (
        <>
          <h2 id={headingId} className="text-2xl font-medium">
            {section.label}
          </h2>
          <p className="mt-2 text-base text-muted">Coming soon.</p>
        </>
      )
  }
}

function App() {
  return (
    <div className="flex min-h-svh flex-col bg-bg text-text">
      <a href="#main" className={SKIP_LINK}>
        Skip to content
      </a>

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
        {sections.map((section) => (
          <section
            key={section.id}
            id={section.id}
            aria-labelledby={`${section.id}-heading`}
            className="py-8 first:pt-0"
          >
            {sectionBody(section)}
          </section>
        ))}
      </main>

      <Footer />
    </div>
  )
}

export default App
