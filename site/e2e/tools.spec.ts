import { readFileSync } from 'node:fs'

import { expect, test, type Page } from '@playwright/test'

/*
 * Browser-backed coverage for the `~/tools` acceptance criteria the jsdom
 * suites cannot state: that the hash route actually opens on magic paste in a
 * real browser, that a paste routes and switches, that reloading a shared link
 * brings back what the sender saw — and, the one that is the whole promise of
 * the page, that nothing it does leaves the origin.
 *
 * Specs navigate with `page.goto('')` and *then* set the hash, never with an
 * absolute-path goto: resolving an absolute path against `baseURL` drops both
 * the base's `/resume/` path and its `?noboot` query (see
 * playwright.config.ts), which would land on the wrong URL entirely. The hash
 * is set from inside the page so the route change goes through the same
 * `hashchange` path a reader's click does.
 */

/** The registry's tools, in the order src/tools/registry.ts pins (its own
 * header comment explains why the order is not alphabetical, and
 * registry.test.ts holds it). The sidebar renders exactly this list, so the
 * spec spells it out rather than importing the app's module into the runner. */
const TOOL_NAMES = [
  'magic paste',
  'base64',
  'hex',
  'url',
  'html',
  'jwt',
  'hash',
  'cert',
  'cidr',
  'CVSS',
  'epoch',
  'TOTP',
]

/** RFC 7515 Appendix A.1's example token, the same vector src/tools/jwt.test.ts
 * decodes — carriage returns in the header and all. Its payload's `iss` is what
 * the assertions below look for in the output. */
const JWT =
  'eyJ0eXAiOiJKV1QiLA0KICJhbGciOiJIUzI1NiJ9' +
  '.eyJpc3MiOiJqb2UiLA0KICJleHAiOjEzMDA4MTkzODAsDQogImh0dHA6Ly9leGFtcGxlLmNvbS9pc19yb290Ijp0cnVlfQ' +
  '.dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'

/** The self-signed certificate the cert tool's unit tests parse. Read at call
 * time rather than at import time so a missing fixture fails one test instead
 * of breaking collection for the file. */
const readCertificate = (): string =>
  readFileSync(new URL('../test/fixtures/self-signed.pem', import.meta.url), {
    encoding: 'utf8',
  })

/** The tools route, reached the way a reader reaches it: load the site, then
 * change the hash. Resolves once the page's own h1 is up, so no assertion
 * afterwards races the route change. */
async function openTools(page: Page, hash = '#/tools'): Promise<void> {
  await page.goto('')
  await page.evaluate((next) => {
    window.location.hash = next
  }, hash)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('~/tools')
}

/** The pane's output block. There is one `<pre>` on the route — ToolPane's —
 * and it has no accessible name to address it by. */
const output = (page: Page) => page.locator('pre')

/** The pane's input box, by its label. */
const input = (page: Page) => page.getByLabel('Input', { exact: true })

test('opens on magic paste with the registry in the sidebar', async ({
  page,
}) => {
  await openTools(page)

  for (const name of TOOL_NAMES) {
    await expect(page.getByRole('link', { name, exact: true })).toBeVisible()
  }

  // Magic paste is the landing state: the active sidebar link, and a live pane
  // waiting for a paste.
  await expect(
    page.getByRole('link', { name: 'magic paste', exact: true }),
  ).toHaveAttribute('aria-current', 'page')
  await expect(input(page)).toHaveValue('')
  await expect(
    page.getByRole('button', { name: 'Copy output' }),
  ).toBeVisible()
})

test('detects a pasted JWT and switches to the jwt tool', async ({ page }) => {
  await openTools(page)
  await input(page).fill(JWT)

  // Magic ran the token through jwt itself, and offers the switch.
  await expect(output(page)).toContainText('"iss": "joe"')
  const chip = page.getByRole('link', { name: /detected as jwt, switch/i })
  await expect(chip).toBeVisible()

  await chip.click()

  await expect(page).toHaveURL(/#\/tools\/jwt\?i=/)
  await expect(
    page.getByRole('link', { name: 'jwt', exact: true }),
  ).toHaveAttribute('aria-current', 'page')
  // The paste rides along in the chip's href, so the jwt pane decodes the same
  // token rather than opening empty.
  await expect(input(page)).toHaveValue(JWT)
  await expect(output(page)).toContainText('"iss": "joe"')
  await expect(page.getByRole('row', { name: /Header alg/ })).toContainText(
    'HS256',
  )
})

test('makes no network requests while processing pasted input', async ({
  page,
  baseURL,
}) => {
  if (baseURL === undefined) {
    throw new Error('baseURL is not configured; see playwright.config.ts')
  }

  // The initial document, modules and fonts must come from this origin.
  const urls: string[] = []
  page.on('request', (request) => {
    urls.push(request.url())
  })

  await openTools(page)
  await page.waitForLoadState('networkidle')
  const origin = new URL(baseURL).origin
  expect(
    urls.filter((url) => /^https?:/.test(url) && new URL(url).origin !== origin),
  ).toEqual([])
  urls.length = 0

  // Once loaded, even a same-origin request could disclose the pasted value.
  await input(page).fill(JWT)
  await expect(page.getByRole('link', { name: /detected as jwt/i })).toBeVisible()
  await input(page).fill(readCertificate())
  await expect(
    page.getByRole('link', { name: /detected as cert/i }),
  ).toBeVisible()

  expect(urls.filter((url) => /^https?:/.test(url))).toEqual([])
})

test('restores tool, input and output from a reloaded link', async ({
  page,
}) => {
  await openTools(page, '#/tools/jwt')
  await input(page).fill(JWT)

  // The page writes the run into the hash; wait for that before reloading,
  // since the reload is what the assertions are about.
  await expect(page).toHaveURL(/#\/tools\/jwt\?i=/)
  const shared = page.url()

  await page.reload()

  expect(page.url()).toBe(shared)
  await expect(
    page.getByRole('link', { name: 'jwt', exact: true }),
  ).toHaveAttribute('aria-current', 'page')
  await expect(input(page)).toHaveValue(JWT)
  await expect(output(page)).toContainText('"iss": "joe"')
})

test('skip link focuses the tools content without losing the current input', async ({
  page,
}) => {
  await openTools(page, '#/tools/jwt')
  await input(page).fill(JWT)
  await expect(output(page)).toContainText('"iss": "joe"')
  const shared = page.url()

  const skip = page.getByRole('link', { name: 'Skip to content' })
  await skip.focus()
  await page.keyboard.press('Enter')

  await expect(page.getByRole('main')).toBeFocused()
  await expect(page).toHaveURL(shared)
  await expect(input(page)).toHaveValue(JWT)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('~/tools')
  await page.keyboard.press('Tab')
  await expect(
    page.getByRole('link', { name: 'magic paste', exact: true }),
  ).toBeFocused()
})

test('keeps a TOTP secret out of the URL on every path that can write one', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const secret = 'JBSWY3DPEHPK3PXP'

  // Direct entry: the live pane re-runs once a second, but the sensitive
  // contract keeps the hash at the bare tool id no matter how long that runs.
  await openTools(page, '#/tools/totp')
  await input(page).fill(secret)
  await expect(output(page)).not.toHaveText('')
  await page.waitForTimeout(1100)
  expect(page.url()).not.toContain(secret)
  expect(page.url()).not.toContain('i=')
  const shared = page.url()

  // A fragment reload selects TOTP without restoring what was typed into it.
  await page.reload()
  expect(page.url()).toBe(shared)
  await expect(
    page.getByRole('link', { name: 'TOTP', exact: true }),
  ).toHaveAttribute('aria-current', 'page')
  await expect(input(page)).toHaveValue('')

  // The Copy link button builds the same sensitive-safe hash rather than the
  // input-carrying one every other tool's share link uses.
  await input(page).fill(secret)
  await expect(output(page)).not.toHaveText('')
  await page.getByRole('button', { name: 'Copy link' }).click()
  const copiedLink = await page.evaluate(() => navigator.clipboard.readText())
  expect(copiedLink).not.toContain(secret)
  expect(copiedLink).not.toContain('i=')

  // Magic paste: a pasted otpauth:// URI is what totp.detect scores highest,
  // and the "detected as TOTP, switch" chip's href must not carry it either.
  const uri = `otpauth://totp/Example:alice@example.com?secret=${secret}&issuer=Example`
  await openTools(page)
  await input(page).fill(uri)
  const chip = page.getByRole('link', { name: /detected as totp, switch/i })
  await expect(chip).toBeVisible()
  const href = await chip.getAttribute('href')
  expect(href).not.toContain(secret)
  expect(href).not.toContain('i=')
})

test.describe('at 375x667', () => {
  test.use({ viewport: { width: 375, height: 667 } })

  // Named for the route: responsive.spec.ts already has a `has no horizontal
  // overflow` at this width, and the two read alike in a report otherwise.
  test('has no horizontal overflow on the tools route', async ({ page }) => {
    await openTools(page)

    const empty = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }))
    expect(empty.scrollWidth).toBe(empty.clientWidth)

    // Again with a long unbroken token in the box: the input, the output and
    // the fields table all carry text with no spaces to wrap at, which is
    // where a phone-width layout actually breaks.
    await input(page).fill(JWT)
    await expect(output(page)).toContainText('"iss": "joe"')

    const filled = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }))
    expect(filled.scrollWidth).toBe(filled.clientWidth)
  })
})
