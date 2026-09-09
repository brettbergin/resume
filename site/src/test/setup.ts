import { webcrypto } from 'node:crypto'

import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

/*
 * jsdom installs its own `crypto` global over Node's, and depending on the
 * version that object may carry no `subtle`. Half the `~/tools` page is built
 * on Web Crypto — the hash tool's SHA and HMAC rows, the JWT tool's signature
 * verification — so without `crypto.subtle` those tools could not be unit
 * tested at all, only exercised in the browser by the e2e suite.
 *
 * Node's own `webcrypto` is the same standard API, so installing it here fills
 * the gap in the environment rather than in the code under test: production
 * code keeps calling `crypto.subtle` exactly as a browser provides it, and
 * nothing in `src/tools/` knows this file exists. Guarded so that a jsdom that
 * does ship `subtle` keeps its own implementation.
 */
if (globalThis.crypto?.subtle === undefined) {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    configurable: true,
    writable: true,
  })
}

/*
 * Testing Library keeps rendered trees in the document until they are removed.
 * Without `globals: true` its automatic cleanup never registers, so unmount
 * everything here — otherwise queries in one test see the previous test's DOM.
 */
afterEach(() => {
  cleanup()
})
