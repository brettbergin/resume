import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

/*
 * Testing Library keeps rendered trees in the document until they are removed.
 * Without `globals: true` its automatic cleanup never registers, so unmount
 * everything here — otherwise queries in one test see the previous test's DOM.
 */
afterEach(() => {
  cleanup()
})
