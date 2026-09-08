import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from './App.tsx'
import {
  achievements,
  competencies,
  contact,
  experiences,
  projects,
  summary,
  technicalSkills,
} from './data/resume.ts'
import { sections } from './data/sections.ts'

/*
 * Shell-level guards, as opposed to the per-component tests next to Header,
 * Footer and ThemeToggle: that the page has exactly one of each landmark, that
 * no nav link points at an id the page does not render, that the skip link is
 * genuinely first in tab order, and that the toggle in the header reaches the
 * class the palette hangs off.
 *
 * jsdom cannot scroll, so "nav links scroll to the right section" is asserted
 * in its mechanical form: every same-page href resolves to an element that
 * exists in the document. It also applies no stylesheet, so both the inline
 * nav and the mobile panel are visible to queries here — the panel is opened
 * explicitly where its links are the subject.
 */

/** Registry entries whose content has been built; the rest still render the
 * label-plus-"Coming soon." placeholder. Extend as sections land. */
const FILLED_SECTION_IDS: string[] = [
  'about',
  'skills',
  'experience',
  'projects',
  'achievements',
]

/** Every same-page anchor in the document: the skip link plus both navs. */
function fragmentLinks(): HTMLAnchorElement[] {
  return Array.from(
    document.querySelectorAll<HTMLAnchorElement>('a[href^="#"]'),
  )
}

function expectTargetsExist(links: HTMLAnchorElement[]) {
  expect(links).not.toHaveLength(0)
  for (const link of links) {
    const id = link.getAttribute('href')!.slice(1)
    expect(document.getElementById(id), `#${id}`).not.toBeNull()
  }
}

// jsdom never fires media query changes, and the theme falls back to
// `prefers-color-scheme`; pin it to light so the toggle starts in a known
// state.
function stubPrefersLight() {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      media: '(prefers-color-scheme: dark)',
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    })),
  )
}

beforeEach(() => {
  stubPrefersLight()
  window.localStorage.clear()
  document.documentElement.classList.remove('dark')
})

afterEach(() => {
  vi.unstubAllGlobals()
  window.localStorage.clear()
  document.documentElement.classList.remove('dark')
})

describe('App landmarks', () => {
  it('renders exactly one banner, one main and one contentinfo', () => {
    render(<App />)

    expect(screen.getAllByRole('banner')).toHaveLength(1)
    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(screen.getAllByRole('contentinfo')).toHaveLength(1)
  })

  it('gives <main> the id the skip link targets', () => {
    render(<App />)

    expect(screen.getByRole('main').id).toBe('main')
  })
})

describe('App sections', () => {
  it('renders one section per registry entry, in order', () => {
    render(<App />)

    const rendered = Array.from(
      screen.getByRole('main').querySelectorAll('section[id]'),
    )

    expect(rendered.map((section) => section.id)).toEqual(
      sections.map((section) => section.id),
    )
  })

  it('still renders the registry label as the heading of every placeholder', () => {
    render(<App />)

    const placeholders = sections.filter(
      (section) => !FILLED_SECTION_IDS.includes(section.id),
    )

    expect(placeholders).not.toHaveLength(0)
    for (const section of placeholders) {
      const element = document.getElementById(section.id)!
      expect(within(element).getByRole('heading').textContent).toBe(
        section.label,
      )
      expect(within(element).getByText('Coming soon.')).toBeDefined()
    }
  })
})

/*
 * The hero is unit-tested next to the component; asserted here is only what
 * the shell is responsible for — that it is mounted in the right section, and
 * that plugging an <h1> into a `aria-labelledby` wrapper left the document
 * with one top-level heading pointing at the right place.
 */
describe('App about section', () => {
  /** Scoped: the footer also has links named "GitHub" and "Email". */
  function about() {
    return document.getElementById('about')!
  }

  it('fills the about section with the hero instead of a placeholder', () => {
    render(<App />)

    expect(within(about()).getByText(summary.professionalSummary)).toBeDefined()
    expect(within(about()).queryByText('Coming soon.')).toBeNull()
  })

  it('has exactly one h1, holding the name, inside #about', () => {
    render(<App />)

    const headings = screen.getAllByRole('heading', { level: 1 })

    expect(headings).toHaveLength(1)
    expect(headings[0].textContent).toBe(summary.name)
    expect(about().contains(headings[0])).toBe(true)
  })

  it('labels the section by the heading the hero renders', () => {
    render(<App />)

    const labelledBy = about().getAttribute('aria-labelledby')!
    const heading = document.getElementById(labelledBy)

    expect(heading).toBe(screen.getByRole('heading', { level: 1 }))
  })

  it('points the hero CTAs at the PDF, the GitHub profile and the email', () => {
    render(<App />)

    const scope = within(about())

    expect(
      scope.getByRole('link', { name: /download pdf/i }).getAttribute('href'),
    ).toBe(`${import.meta.env.BASE_URL}${summary.resumePdfFileName}`)
    expect(
      scope.getByRole('link', { name: 'GitHub' }).getAttribute('href'),
    ).toBe(contact.githubUrl)
    expect(
      scope.getByRole('link', { name: 'Email' }).getAttribute('href'),
    ).toBe(`mailto:${contact.email}`)
  })
})

/*
 * As with the hero: the groups and the chips are asserted next to the
 * component, and what is checked here is only the shell's part — that the
 * section is filled by SkillsSection, and that the heading the component
 * renders is the one the registry's wrapper is labelled by.
 */
describe('App skills section', () => {
  /** Scoped: the placeholder assertions and the nav also mention "Skills". */
  function skills() {
    return document.getElementById('skills')!
  }

  const skillsLabel = sections.find((section) => section.id === 'skills')!.label

  it('fills the skills section instead of a placeholder', () => {
    render(<App />)

    expect(within(skills()).queryByText('Coming soon.')).toBeNull()
  })

  it('labels the section by the heading the skills section renders', () => {
    render(<App />)

    const labelledBy = skills().getAttribute('aria-labelledby')!
    const heading = document.getElementById(labelledBy)

    expect(heading).not.toBeNull()
    expect(skills().contains(heading)).toBe(true)
    expect(heading!.textContent).toBe(skillsLabel)
  })

  it('keeps the section heading at level 2, below the hero h1', () => {
    render(<App />)

    const headings = within(skills()).getAllByRole('heading', { level: 2 })

    expect(headings).toHaveLength(1)
    expect(headings[0].textContent).toBe(skillsLabel)
    expect(within(skills()).queryAllByRole('heading', { level: 1 })).toEqual([])
  })

  it('renders content from both skill data exports inside #skills', () => {
    render(<App />)

    const scope = within(skills())

    expect(scope.getByText(competencies[0].label)).toBeDefined()
    expect(scope.getByText(technicalSkills[0].items[0])).toBeDefined()
  })
})

/*
 * Same division again: the timeline treatment, the ordering and the show-more
 * toggle are asserted next to ExperienceSection/ExperienceEntry, and what is
 * checked here is the shell's part — that the section is filled, that the
 * heading its wrapper is labelled by is the one the component renders, and
 * that the per-role <h3>s did not add a second <h2> or a competing <h1>.
 */
describe('App experience section', () => {
  /** Scoped: the nav and the placeholder assertions also mention "Experience",
   * and roles repeat company names across sections of the page. */
  function experience() {
    return document.getElementById('experience')!
  }

  const experienceLabel = sections.find(
    (section) => section.id === 'experience',
  )!.label

  it('fills the experience section instead of a placeholder', () => {
    render(<App />)

    expect(within(experience()).queryByText('Coming soon.')).toBeNull()
  })

  it('labels the section by the heading the experience section renders', () => {
    render(<App />)

    const labelledBy = experience().getAttribute('aria-labelledby')!
    const heading = document.getElementById(labelledBy)

    expect(heading).not.toBeNull()
    expect(experience().contains(heading)).toBe(true)
    expect(heading!.textContent).toBe(experienceLabel)
  })

  it('keeps one section heading at level 2, with the roles below it', async () => {
    render(<App />)

    const scope = within(experience())
    const headings = scope.getAllByRole('heading', { level: 2 })

    expect(headings).toHaveLength(1)
    expect(headings[0].textContent).toBe(experienceLabel)
    expect(scope.queryAllByRole('heading', { level: 1 })).toEqual([])

    // The section-level toggle (ExperienceSection.test.tsx) leaves the older
    // roles out of the DOM until expanded, so the full count — the "no role
    // dropped" invariant this test exists to check — only holds once opened.
    await userEvent.click(
      scope.getByRole('button', { name: /earlier role/i }),
    )

    expect(scope.getAllByRole('heading', { level: 3 })).toHaveLength(
      experiences.length,
    )
  })

  it('renders the roles in the data module’s order inside #experience', async () => {
    render(<App />)

    const scope = within(experience())

    await userEvent.click(
      scope.getByRole('button', { name: /earlier role/i }),
    )

    const roles = scope.getAllByRole('heading', { level: 3 })

    expect(roles.map((role) => role.textContent)).toEqual(
      experiences.map((role) => role.title),
    )
  })
})

/*
 * And the project cards: the card treatment, the grid and the new-tab rel are
 * asserted next to ProjectsSection/ProjectCard, so the shell's part is what is
 * checked here — that the section is filled rather than a placeholder, that the
 * heading its wrapper is labelled by is the registry's label, and that every
 * project in the data module reaches the page as a link to its own repo.
 */
describe('App projects section', () => {
  /** Scoped: the nav and the placeholder assertions also mention "Projects",
   * and the hero and footer carry GitHub links of their own. */
  function projectsSection() {
    return document.getElementById('projects')!
  }

  const projectsLabel = sections.find(
    (section) => section.id === 'projects',
  )!.label

  it('fills the projects section instead of a placeholder', () => {
    render(<App />)

    const scope = within(projectsSection())

    expect(scope.queryByText('Coming soon.')).toBeNull()
    for (const project of projects) {
      expect(scope.getByText(project.name)).toBeDefined()
    }
  })

  it('labels the section by the heading the projects section renders', () => {
    render(<App />)

    const labelledBy = projectsSection().getAttribute('aria-labelledby')!
    const heading = document.getElementById(labelledBy)

    expect(heading).not.toBeNull()
    expect(projectsSection().contains(heading)).toBe(true)
    expect(heading!.textContent).toBe(projectsLabel)
  })

  it('keeps one section heading at level 2 and no competing h1', () => {
    render(<App />)

    const scope = within(projectsSection())
    const headings = scope.getAllByRole('heading', { level: 2 })

    expect(headings).toHaveLength(1)
    expect(headings[0].textContent).toBe(projectsLabel)
    expect(scope.queryAllByRole('heading', { level: 1 })).toEqual([])
  })

  it('resolves the nav’s #projects href to the rendered section', () => {
    render(<App />)

    const navLinks = fragmentLinks().filter(
      (link) => link.getAttribute('href') === '#projects',
    )

    expect(navLinks).not.toHaveLength(0)
    expectTargetsExist(navLinks)
    expect(document.getElementById('projects')).toBe(projectsSection())
  })

  it('renders one link per project, pointing at its repo', () => {
    render(<App />)

    const links = within(projectsSection()).getAllByRole(
      'link',
    ) as HTMLAnchorElement[]

    expect(links.map((link) => link.getAttribute('href'))).toEqual(
      projects.map((project) => project.url),
    )
  })
})

/*
 * And again for the achievement cards: the card treatment and the metric
 * callouts are asserted next to AchievementsSection, so what is checked here is
 * the shell's part — that the section is filled rather than a placeholder, that
 * every bullet in the data module reaches the page, and that the heading its
 * wrapper is labelled by is the registry's label.
 */
describe('App achievements section', () => {
  /** Scoped: the nav and the placeholder assertions also mention
   * "Achievements", and the bullets echo wording used in the experience
   * highlights. */
  function achievementsSection() {
    return document.getElementById('achievements')!
  }

  const achievementsLabel = sections.find(
    (section) => section.id === 'achievements',
  )!.label

  it('fills the achievements section instead of a placeholder', () => {
    render(<App />)

    const scope = within(achievementsSection())

    expect(scope.queryByText('Coming soon.')).toBeNull()
    for (const achievement of achievements) {
      expect(scope.getByText(achievement.text)).toBeDefined()
    }
  })

  it('labels the section by the heading the achievements section renders', () => {
    render(<App />)

    const labelledBy = achievementsSection().getAttribute('aria-labelledby')!
    const heading = document.getElementById(labelledBy)

    expect(heading).not.toBeNull()
    expect(achievementsSection().contains(heading)).toBe(true)
    expect(heading!.textContent).toBe(achievementsLabel)
  })

  it('keeps one section heading at level 2 and no competing h1', () => {
    render(<App />)

    const scope = within(achievementsSection())
    const headings = scope.getAllByRole('heading', { level: 2 })

    expect(headings).toHaveLength(1)
    expect(headings[0].textContent).toBe(achievementsLabel)
    expect(scope.queryAllByRole('heading', { level: 1 })).toEqual([])
  })
})

describe('App nav targets', () => {
  it('points every same-page link at an id that exists on the page', () => {
    render(<App />)

    expectTargetsExist(fragmentLinks())
  })

  it('points every mobile menu link at an id that exists on the page', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /^menu$/i }))
    const dialog = screen.getByRole('dialog')
    const links = within(dialog).getAllByRole('link') as HTMLAnchorElement[]

    expect(links).toHaveLength(sections.length)
    expectTargetsExist(links)
  })
})

describe('App skip link', () => {
  it('is the first focusable element and targets #main', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.tab()

    const focused = document.activeElement as HTMLAnchorElement
    expect(focused.tagName).toBe('A')
    expect(focused.textContent).toBe('Skip to content')
    expect(focused.getAttribute('href')).toBe('#main')
    expect(document.getElementById('main')).toBe(screen.getByRole('main'))
  })

  it('is hidden until it takes focus rather than removed from tab order', () => {
    render(<App />)

    const skipLink = screen.getByRole('link', { name: 'Skip to content' })
    expect(skipLink.className).toContain('sr-only')
    expect(skipLink.className).toContain('focus:not-sr-only')
    expect(skipLink.getAttribute('tabindex')).toBeNull()
  })
})

describe('App theme toggle', () => {
  it('is rendered inside the header', () => {
    render(<App />)

    const banner = screen.getByRole('banner')
    expect(
      within(banner).getByRole('button', { name: /switch to .* theme/i }),
    ).toBeDefined()
  })

  it('flips the dark class on <html> when used', async () => {
    const user = userEvent.setup()
    render(<App />)

    const banner = screen.getByRole('banner')
    const toggle = within(banner).getByRole('button', {
      name: /switch to .* theme/i,
    })
    expect(document.documentElement.classList.contains('dark')).toBe(false)

    await user.click(toggle)
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    await user.click(toggle)
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })
})
