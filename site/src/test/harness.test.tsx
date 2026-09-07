import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

/*
 * A standing guard that the DOM test harness stays wired up: the jsdom
 * environment, the Testing Library render, and the cleanup setup file. If
 * someone drops the `test` block from vite.config.ts, this fails before any
 * component test does, pointing at the config instead of at the component.
 */

function Greeting() {
  return <p>harness is wired</p>
}

describe('test harness', () => {
  it('runs in a DOM environment', () => {
    expect(typeof window).not.toBe('undefined')
    expect(typeof document).not.toBe('undefined')
  })

  it('renders a component into the document', () => {
    render(<Greeting />)

    const greeting = screen.getByText('harness is wired')
    expect(document.body.contains(greeting)).toBe(true)
  })
})
