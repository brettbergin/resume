import { defineConfig, devices } from '@playwright/test'

/*
 * Browser-backed coverage for the acceptance criterion
 * test/layout-contract.test.ts's own comment says jsdom cannot provide: no
 * horizontal scrollbar and the header's menu-button/inline-nav swap, at the
 * four widths README.md's manual checklist walks by hand. That source-grep
 * suite and its checklist stay as-is; this is a separate, additional suite.
 *
 * The dev server is served from the `/resume/` base path (see
 * vite.config.ts's `base`), so `baseURL` and the `webServer.url` readiness
 * check both include it — the bare origin 302-redirects there rather than
 * 200ing directly.
 *
 * `?noboot` bypasses the boot sequence overlay (see BootSequence.tsx) so the
 * suite's assertions run against the resume content immediately rather than
 * racing the typewriter animation. Specs must navigate with `page.goto('')`
 * (resolving to `baseURL` as-is), not `page.goto('/')` — an absolute-path
 * goto discards both the base's path and its query string.
 *
 * The four viewports are set per `test.describe` block in
 * e2e/responsive.spec.ts rather than as one project each, so there is only
 * one (default) project here.
 */

const PORT = 5173
const BASE_URL = `http://localhost:${PORT}/resume/?noboot`

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  use: {
    baseURL: BASE_URL,
  },
  webServer: {
    command: 'npm run dev',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
