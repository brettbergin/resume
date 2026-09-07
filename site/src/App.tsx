/*
 * The layout shell every content section renders inside: skip link, sticky
 * header (with the theme toggle in its bar), one anchored <section> per entry
 * of the section registry, and the footer.
 *
 * The sections here are placeholders on purpose — each one is filled in by its
 * own change. What this file owns is the *shell*: exactly one banner, one
 * <main> and one contentinfo, and the guarantee that every nav href has a
 * matching id on the page, because both come from `sections`.
 */

import { Footer } from './components/Footer.tsx'
import { Header } from './components/Header.tsx'
import { ThemeToggle } from './components/ThemeToggle.tsx'
import { sections } from './data/sections.ts'

/* First focusable element in the document, and invisible until it takes focus:
 * a sticky header with a nav in front of the content would otherwise cost a
 * keyboard user a tab through every nav link on every visit. */
const SKIP_LINK =
  'sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 ' +
  'focus:inline-flex focus:min-h-11 focus:items-center focus:rounded-pill ' +
  'focus:border focus:border-border focus:bg-surface focus:px-4 focus:text-text'

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
            <h2 id={`${section.id}-heading`} className="text-2xl font-medium">
              {section.label}
            </h2>
            <p className="mt-2 text-base text-muted">Coming soon.</p>
          </section>
        ))}
      </main>

      <Footer />
    </div>
  )
}

export default App
