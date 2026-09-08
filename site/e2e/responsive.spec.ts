import { expect, test } from '@playwright/test'

/*
 * The four widths README.md's manual checklist walks by hand: a phone below
 * the `md` breakpoint (320, 375), and at/above it where the inline nav takes
 * over (768, 1440). Parametrized over one spec rather than one project per
 * width, so the two assertions per width stay next to each other.
 */
const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 375, height: 667 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
]

for (const viewport of VIEWPORTS) {
  test.describe(`at ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport })

    test('has no horizontal overflow', async ({ page }) => {
      await page.goto('/')

      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }))

      expect(overflow.scrollWidth).toBe(overflow.clientWidth)
    })

    test('shows the nav for this width', async ({ page }) => {
      await page.goto('/')

      const menuButton = page.getByRole('button', { name: /menu/i })
      const inlineNav = page.getByRole('navigation', { name: 'Primary' })

      // Below `md` (768px, see Header.tsx's DESKTOP_QUERY) the inline nav is
      // `hidden` and the menu button takes over; from `md` up it's reversed.
      if (viewport.width < 768) {
        await expect(menuButton).toBeVisible()
        await expect(inlineNav).toBeHidden()
      } else {
        await expect(inlineNav).toBeVisible()
        await expect(menuButton).toBeHidden()
      }
    })
  })
}
