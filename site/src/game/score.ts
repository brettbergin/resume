/*
 * Where the best Snake score is kept between visits. Separate from
 * `engine.ts` on purpose: the engine is the rules and knows nothing about a
 * browser, while this is persistence and knows nothing about the rules — it
 * stores a number.
 *
 * Same two habits as `src/theme.ts`, for the same reasons:
 *
 * - Every localStorage access is wrapped in try/catch. Safari in private mode
 *   throws on the property access itself, and a high score must never be the
 *   reason the game page fails to render. A throw degrades to "no best score
 *   yet" on the way in and to a silent no-op on the way out: the run still
 *   plays and still shows its best, it just will not survive a reload.
 * - Anything that cannot be interpreted is treated as nothing stored, rather
 *   than trusted and rendered as `NaN` next to the live score.
 */

/**
 * Where the best score is persisted.
 *
 * Namespaced for the same reason as `THEME_STORAGE_KEY`: GitHub Pages project
 * pages all share the single https://brettbergin.github.io origin, and
 * therefore one localStorage, so a bare `best-score` key would collide with
 * the owner's other project sites.
 */
export const BEST_SCORE_STORAGE_KEY = 'resume-snake-best-score'

/** Digits and nothing else. Deliberately stricter than `Number()`, which
 * reads '' as 0, ' 12 ' as 12 and '1e3' as 1000 — none of which this module
 * ever wrote, so none of which it should read back. */
const DIGITS = /^\d+$/

const isStorableScore = (score: number): boolean =>
  Number.isSafeInteger(score) && score >= 0

/**
 * The persisted best, or 0 when there is nothing usable to read. An absent
 * key, an empty string, a negative or fractional value, a JSON blob left by
 * some other version of this code, and a storage that throws all count as
 * nothing — a visitor arriving fresh and a visitor whose browser blocks
 * storage see the same honest 0.
 */
export function getStoredBestScore(): number {
  try {
    const stored = window.localStorage.getItem(BEST_SCORE_STORAGE_KEY)
    if (stored === null || !DIGITS.test(stored)) return 0

    const score = Number(stored)
    return isStorableScore(score) ? score : 0
  } catch {
    return 0
  }
}

/** Remember a new best. Never throws: storage being unavailable (private
 * mode, quota, blocked cookies) is not something a player can act on, and the
 * score is already on screen either way. A value the reader would reject is
 * not written, so whatever is in storage is always something that reads
 * back. */
export function setStoredBestScore(score: number): void {
  if (!isStorableScore(score)) return

  try {
    window.localStorage.setItem(BEST_SCORE_STORAGE_KEY, String(score))
  } catch {
    // Nothing to do and nothing to tell the player: the best score stays
    // correct for this page view, it just will not outlive it.
  }
}
