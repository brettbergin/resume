import { describe, expect, it } from 'vitest'

import { EFF_SHORT_WORDLIST } from './eff-short.ts'

/*
 * A wordlist has no behaviour to test, so what these assertions pin is the
 * data itself: the passphrase generator derives its reported entropy from
 * `EFF_SHORT_WORDLIST.length`, which is only honest while the list is exactly
 * the EFF's 1296 distinct words. A word lost to a bad merge or duplicated by
 * a hand edit would leave the tool quietly overstating how strong its output
 * is, and nothing else in the codebase would notice.
 *
 * The shape checks — lowercase, short, alphabetic — are the other half: they
 * say the list is the *short* list rather than the large one, and that every
 * entry is something a person can type off a screen.
 */

/** The list's own indexing: four dice, most significant roll first, which is
 * how the EFF prints it and the only ordering that makes a printed dice code
 * resolve to the same word here. */
const atDiceCode = (code: string): string | undefined => {
  const rolls = [...code].map((digit) => Number(digit) - 1)
  const index = rolls.reduce((offset, roll) => offset * 6 + roll, 0)
  return EFF_SHORT_WORDLIST[index]
}

describe('EFF_SHORT_WORDLIST', () => {
  it('is 1296 strings, one per four-dice roll', () => {
    expect(Array.isArray(EFF_SHORT_WORDLIST)).toBe(true)
    expect(EFF_SHORT_WORDLIST).toHaveLength(1296)
    expect(EFF_SHORT_WORDLIST.every((word) => typeof word === 'string')).toBe(
      true,
    )
  })

  it('has no duplicate words', () => {
    // Reported as the offending words rather than a count: a failure here is
    // a transcription accident, and the diff to look at is the word's.
    const seen = new Set<string>()
    const duplicates = EFF_SHORT_WORDLIST.filter((word) => {
      const repeated = seen.has(word)
      seen.add(word)
      return repeated
    })

    expect(duplicates).toEqual([])
    expect(new Set(EFF_SHORT_WORDLIST).size).toBe(1296)
  })

  it('is lowercase letters throughout, bar the one hyphen the EFF ships', () => {
    // `yo-yo` (6652) is in the published list, and 6655 is `yoyo`, so the
    // hyphen cannot be normalised away without merging two entries into one.
    // It is the single exception, and this pins it as such: any *other*
    // punctuation, capital or digit is a transcription error.
    const notPlainLetters = EFF_SHORT_WORDLIST.filter(
      (word) => !/^[a-z]+$/.test(word),
    )

    expect(notPlainLetters).toEqual(['yo-yo'])
    expect(
      EFF_SHORT_WORDLIST.every((word) => /^[a-z]+(-[a-z]+)?$/.test(word)),
    ).toBe(true)
  })

  it('is short words, three to eight characters', () => {
    const lengths = EFF_SHORT_WORDLIST.map((word) => word.length)

    expect(Math.min(...lengths)).toBeGreaterThanOrEqual(3)
    expect(Math.max(...lengths)).toBeLessThanOrEqual(8)
  })

  it('starts and ends where the published list does', () => {
    // 1111 and 6666. The endpoints alone catch a list pasted in sorted or
    // reversed order, which would still pass every check above.
    expect(EFF_SHORT_WORDLIST[0]).toBe('acid')
    expect(EFF_SHORT_WORDLIST[EFF_SHORT_WORDLIST.length - 1]).toBe('zoom')
  })

  it('resolves printed dice codes to the published words', () => {
    // Spot checks through the middle of the list, where an off-by-one from a
    // dropped-then-re-added word would hide from the endpoints.
    expect(atDiceCode('1111')).toBe('acid')
    expect(atDiceCode('1234')).toBe('atlas')
    expect(atDiceCode('3333')).toBe('groom')
    expect(atDiceCode('4152')).toBe('math')
    expect(atDiceCode('6652')).toBe('yo-yo')
    expect(atDiceCode('6655')).toBe('yoyo')
    expect(atDiceCode('6666')).toBe('zoom')
  })
})
