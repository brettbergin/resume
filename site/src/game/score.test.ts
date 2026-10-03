import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  BEST_SCORE_STORAGE_KEY,
  getStoredBestScore,
  setStoredBestScore,
} from './score.ts'

/*
 * Storage is seeded by hand with `setItem` rather than through
 * `setStoredBestScore`, so the reader is exercised against raw values a real
 * browser could be holding — a half-written key, an older version of this
 * code, or something else entirely on the shared brettbergin.github.io
 * origin.
 */

/**
 * Swap `window.localStorage` for a stand-in, and hand back the restore. The
 * whole object is replaced rather than one method spied on, because that is
 * the shape of the failure being reproduced: Safari in private mode throws
 * from the property access itself, and a jsdom `Storage` is a proxy whose
 * methods a spy does not reliably intercept — a half-installed mock would
 * leave these cases passing without ever reaching the catch.
 */
function stubLocalStorage(stub: Partial<Storage> | (() => never)): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage')

  Object.defineProperty(
    window,
    'localStorage',
    typeof stub === 'function'
      ? { configurable: true, get: stub }
      : { configurable: true, value: stub },
  )

  return () => {
    if (descriptor) {
      Object.defineProperty(window, 'localStorage', descriptor)
    } else {
      delete (window as { localStorage?: Storage }).localStorage
    }
  }
}

/** Raw stored values and the score each must resolve to. `undefined` means
 * the key is absent, which is a first visit. */
const STORED_VALUE_CASES: { label: string; raw?: string; score: number }[] = [
  { label: 'no key at all', score: 0 },
  { label: "'0'", raw: '0', score: 0 },
  { label: "'7'", raw: '7', score: 7 },
  { label: 'a long run', raw: '397', score: 397 },
  { label: 'an empty string', raw: '', score: 0 },
  { label: 'a negative score', raw: '-5', score: 0 },
  { label: 'a fractional score', raw: '1.5', score: 0 },
  { label: 'exponent notation', raw: '1e3', score: 0 },
  { label: 'a padded number', raw: ' 12 ', score: 0 },
  { label: "the string 'null'", raw: 'null', score: 0 },
  { label: 'a JSON object string', raw: '{"best":9}', score: 0 },
  { label: 'arbitrary garbage', raw: 'not-a-score-🙃', score: 0 },
  { label: 'past the safe integer range', raw: '9007199254740993', score: 0 },
]

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  window.localStorage.clear()
})

describe('getStoredBestScore', () => {
  for (const { label, raw, score } of STORED_VALUE_CASES) {
    it(`reads ${label} as ${score}`, () => {
      if (raw !== undefined) {
        window.localStorage.setItem(BEST_SCORE_STORAGE_KEY, raw)
      }

      expect(getStoredBestScore()).toBe(score)
    })
  }

  it('reads the namespaced key, not a bare "best-score" key', () => {
    window.localStorage.setItem('best-score', '42')

    expect(getStoredBestScore()).toBe(0)
  })

  it('tolerates a getItem that throws', () => {
    let calls = 0
    const restore = stubLocalStorage({
      getItem() {
        calls += 1
        throw new Error('SecurityError: storage access is denied')
      },
    })

    try {
      expect(getStoredBestScore()).toBe(0)
      expect(calls).toBe(1)
    } finally {
      restore()
    }
  })

  it('tolerates a localStorage getter that throws', () => {
    const restore = stubLocalStorage(() => {
      throw new Error('SecurityError: storage access is denied')
    })

    try {
      expect(getStoredBestScore()).toBe(0)
      expect(() => setStoredBestScore(5)).not.toThrow()
    } finally {
      restore()
    }
  })
})

describe('setStoredBestScore', () => {
  it('persists a score under the namespaced key, and reads back what it wrote', () => {
    setStoredBestScore(12)

    expect(window.localStorage.getItem(BEST_SCORE_STORAGE_KEY)).toBe('12')
    expect(getStoredBestScore()).toBe(12)

    setStoredBestScore(30)

    expect(getStoredBestScore()).toBe(30)
  })

  it('does not throw when the write throws', () => {
    let calls = 0
    const restore = stubLocalStorage({
      setItem() {
        calls += 1
        throw new Error('QuotaExceededError')
      },
    })

    try {
      expect(() => setStoredBestScore(3)).not.toThrow()
      expect(calls).toBe(1)
    } finally {
      restore()
    }
  })

  it('refuses to store a value its own reader would reject', () => {
    setStoredBestScore(7)

    for (const rejected of [Number.NaN, -1, 1.5, Number.POSITIVE_INFINITY]) {
      setStoredBestScore(rejected)
    }

    expect(window.localStorage.getItem(BEST_SCORE_STORAGE_KEY)).toBe('7')
  })
})
