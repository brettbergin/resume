import { describe, expect, it } from 'vitest'

import { secret } from './secret.ts'
import type { ToolOptions, ToolResult } from './types.ts'
import { EFF_SHORT_WORDLIST } from './vendor/eff-short.ts'

/*
 * A generator cannot be pinned to a fixed expected output the way the hashing
 * tool can — there is no published vector for "a random password" — so what
 * these assertions check is everything about a value *except* which one it is:
 * its length, that every character came from the alphabet that was asked for,
 * that excluded characters never appear across enough samples for their
 * absence to mean something, and that the bits reported are the bits the
 * alphabet and length actually buy.
 *
 * The entropy numbers are hand-computed here rather than derived from the
 * tool's own constants. A test that recomputed `Math.log2(alphabet.length) *
 * length` from the module under test would agree with any arithmetic the
 * module chose, including wrong arithmetic; `log2(62) * 8 ~= 47.6` written out
 * as a literal is a claim that can fail.
 */

const run = (options: ToolOptions = {}): ToolResult => secret.run('', options)

/** The reported entropy in bits. The field is rendered as `"47.6 bits"`, so a
 * parse rather than an equality — the assertions below are all approximate to
 * within the tenth of a bit the display rounds to. */
function bitsOf(result: ToolResult): number {
  const field = (result.fields ?? []).find((row) => row.label === 'Entropy')
  if (field === undefined) throw new Error('result carries no Entropy field')
  expect(field.value).toMatch(/^\d+\.\d bits$/)
  return Number.parseFloat(field.value)
}

/** The value a successful run produced, with the success itself asserted so a
 * failure reports the tool's own error rather than an empty-string mismatch
 * fifty lines further down. */
function outputOf(result: ToolResult): string {
  expect(result.error).toBeUndefined()
  expect(result.ok).toBe(true)
  return result.output
}

const WORDS = new Set(EFF_SHORT_WORDLIST)

/** Ambiguous characters, spelled out here rather than imported: the point of
 * the exclusion test is that *these* glyphs never appear, and importing the
 * module's own string would make the test agree with any set it picked. */
const AMBIGUOUS = [...'0Ol1I|B8S5']

/** The four character classes the tool offers, with the alphabet each one
 * means written out independently of the module. */
const LOWER = 'abcdefghijklmnopqrstuvwxyz'
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const DIGITS = '0123456789'
const SYMBOLS = '!@#$%^&*()-_=+[]{}<>?,.:;/|~'

const CLASSES: readonly [chars: string, alphabet: string][] = [
  ['all', LOWER + UPPER + DIGITS + SYMBOLS],
  ['alphanumeric', LOWER + UPPER + DIGITS],
  ['lower+digits', LOWER + DIGITS],
  ['lower', LOWER],
]

/**
 * A passphrase back into its words.
 *
 * `yo-yo` is the one entry in the EFF short list that is not plain letters, so
 * a plain `split('-')` turns a passphrase that happens to draw it into one
 * word too many — rare enough to pass a hundred runs and fail in CI on the
 * hundred and first. Parts that are not themselves words are glued back onto
 * the one before, which reassembles `yo` + `yo` and leaves every other
 * passphrase untouched.
 */
function splitWords(output: string, separator: string): string[] {
  const words: string[] = []
  for (const part of output.split(separator)) {
    const previous = words[words.length - 1]
    if (previous !== undefined && !WORDS.has(previous)) {
      words[words.length - 1] = `${previous}${separator}${part}`
    } else {
      words.push(part)
    }
  }
  return words
}

describe('password generation', () => {
  it.each([8, 16, 32])('produces exactly %i characters', (length) => {
    const output = outputOf(run({ generator: 'password', length: `${length}` }))
    expect(output).toHaveLength(length)
  })

  it.each(CLASSES)('draws a %s password from that class alone', (chars, alphabet) => {
    const output = outputOf(
      run({ generator: 'password', chars, length: '64' }),
    )
    for (const character of output) {
      expect(alphabet, `${character} is outside the ${chars} alphabet`).toContain(
        character,
      )
    }
  })

  it.each(CLASSES)('reports log2(%s alphabet) * length bits', (chars, alphabet) => {
    const result = run({ generator: 'password', chars, length: '20' })
    expect(bitsOf(result)).toBeCloseTo(Math.log2(alphabet.length) * 20, 1)
  })

  it('never emits an ambiguous character across 500 samples', () => {
    // 500 * 16 characters out of an 80-character alphabet: if any of the ten
    // survived the filter it would show up here thousands of times over.
    const offenders = new Set<string>()
    for (let sample = 0; sample < 500; sample += 1) {
      const output = outputOf(
        run({ generator: 'password', chars: 'all', length: '16', noAmbig: 'yes' }),
      )
      for (const character of output) {
        if (AMBIGUOUS.includes(character)) offenders.add(character)
      }
    }

    expect([...offenders]).toEqual([])
  })

  it('charges the excluded characters against the entropy it reports', () => {
    // The full set is 90 characters; the ten ambiguous ones are all in it, so
    // what is left is 80 and log2(80) * 16 ~= 101.1 rather than log2(90) * 16.
    const result = run({
      generator: 'password',
      chars: 'all',
      length: '16',
      noAmbig: 'yes',
    })

    expect(bitsOf(result)).toBeCloseTo(Math.log2(80) * 16, 1)
    expect(bitsOf(result)).toBeLessThan(Math.log2(90) * 16)
  })

  it('excludes the one ambiguous letter from a lowercase alphabet', () => {
    const result = run({
      generator: 'password',
      chars: 'lower',
      length: '40',
      noAmbig: 'yes',
    })

    expect(outputOf(result)).not.toContain('l')
    expect(bitsOf(result)).toBeCloseTo(Math.log2(25) * 40, 1)
  })

  it('gives a different password every time it is run', () => {
    const values = new Set(
      Array.from({ length: 20 }, () =>
        outputOf(run({ generator: 'password', length: '24' })),
      ),
    )
    expect(values.size).toBe(20)
  })

  it('defaults to a 16-character password when no options are set', () => {
    expect(outputOf(run())).toHaveLength(16)
  })
})

describe('passphrase generation', () => {
  it.each([3, 4, 6])('joins exactly %i words from the list', (count) => {
    const output = outputOf(
      run({ generator: 'passphrase', words: `${count}`, separator: '-' }),
    )
    const words = splitWords(output, '-')

    expect(words).toHaveLength(count)
    for (const word of words) {
      expect(WORDS.has(word), `${word} is not in the EFF short wordlist`).toBe(
        true,
      )
    }
  })

  it.each(['-', ' ', '.'])('puts %j between the words', (separator) => {
    const output = outputOf(
      run({ generator: 'passphrase', words: '5', separator }),
    )
    const words = splitWords(output, separator)

    expect(words).toHaveLength(5)
    expect(output).toBe(words.join(separator))
    expect(output.split(separator).length).toBeGreaterThanOrEqual(5)
    for (const word of words) expect(WORDS.has(word)).toBe(true)
  })

  it.each([3, 4, 6])('reports log2(1296) * %i bits', (count) => {
    const result = run({ generator: 'passphrase', words: `${count}` })
    expect(bitsOf(result)).toBeCloseTo(Math.log2(1296) * count, 1)
  })

  it('counts the separators as no entropy at all', () => {
    // Three characters of separator between four words versus none: the
    // draws from the list are identical, so the bits must be too.
    const dashed = run({ generator: 'passphrase', words: '4', separator: '-' })
    const glued = run({ generator: 'passphrase', words: '4', separator: '' })
    expect(bitsOf(glued)).toBe(bitsOf(dashed))
  })

  it('names the vendored list and its size', () => {
    const result = run({ generator: 'passphrase', words: '4' })
    const rows = Object.fromEntries(
      (result.fields ?? []).map((field) => [field.label, field.value]),
    )
    expect(rows.Wordlist).toBe(`EFF short, ${EFF_SHORT_WORDLIST.length} words`)
    expect(EFF_SHORT_WORDLIST).toHaveLength(1296)
  })
})

describe('hex bytes', () => {
  it.each([8, 16, 32])('prints %i bytes as twice as many hex digits', (bytes) => {
    const output = outputOf(run({ generator: 'hex', bytes: `${bytes}` }))

    expect(output).toHaveLength(2 * bytes)
    expect(output).toMatch(/^[0-9a-f]+$/)
  })

  it.each([8, 16, 32])('reports 8 bits per byte for %i bytes', (bytes) => {
    expect(bitsOf(run({ generator: 'hex', bytes: `${bytes}` }))).toBe(8 * bytes)
  })
})

describe('base64 bytes', () => {
  it.each([8, 16, 32])('encodes %i bytes as standard base64', (bytes) => {
    const output = outputOf(run({ generator: 'base64', bytes: `${bytes}` }))

    expect(output).toMatch(/^[A-Za-z0-9+/]+=*$/)
    expect(atob(output)).toHaveLength(bytes)
  })

  it.each([8, 16, 32])('reports 8 bits per byte for %i bytes', (bytes) => {
    expect(bitsOf(run({ generator: 'base64', bytes: `${bytes}` }))).toBe(
      8 * bytes,
    )
  })

  it('pads to a whole number of base64 quanta without inflating the bits', () => {
    // 8 bytes is not a multiple of three, so the value carries a '=' that is
    // formatting rather than randomness.
    const result = run({ generator: 'base64', bytes: '8' })
    expect(outputOf(result)).toHaveLength(12)
    expect(outputOf(result).endsWith('=')).toBe(true)
    expect(bitsOf(result)).toBe(64)
  })
})

describe('UUID v4', () => {
  /** Version and variant in one pattern: the literal `4` opening the third
   * group is the version nibble, and `[89ab]` opening the fourth is the two
   * variant bits set to `10`. */
  const UUID_V4 =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

  it('sets the version and variant bits on every one of 200 draws', () => {
    for (let sample = 0; sample < 200; sample += 1) {
      expect(outputOf(run({ generator: 'uuid' }))).toMatch(UUID_V4)
    }
  })

  it('reports the 122 bits left after the six fixed ones', () => {
    expect(bitsOf(run({ generator: 'uuid' }))).toBe(122)
  })

  it('ignores the length, bytes and prefix options', () => {
    const result = run({
      generator: 'uuid',
      length: '64',
      bytes: '32',
      prefix: 'sk',
    })
    expect(outputOf(result)).toMatch(UUID_V4)
    expect(bitsOf(result)).toBe(122)
  })
})

describe('API keys', () => {
  it.each(['sk', 'myapp'])('prefixes the random hex with %j', (prefix) => {
    const output = outputOf(run({ generator: 'apikey', prefix, bytes: '16' }))

    expect(output.startsWith(`${prefix}_`)).toBe(true)
    expect(output.slice(prefix.length + 1)).toMatch(/^[0-9a-f]{32}$/)
  })

  it.each([8, 16, 32])('draws %i random bytes for the key body', (bytes) => {
    const output = outputOf(
      run({ generator: 'apikey', prefix: 'sk', bytes: `${bytes}` }),
    )
    const random = output.slice('sk_'.length)

    expect(random).toHaveLength(2 * bytes)
    expect(random).toMatch(/^[0-9a-f]+$/)
  })

  it('emits the bare random portion when no prefix is given', () => {
    const output = outputOf(run({ generator: 'apikey', prefix: '', bytes: '16' }))

    expect(output.startsWith('_')).toBe(false)
    expect(output).toMatch(/^[0-9a-f]{32}$/)
  })

  it('gives the prefix no entropy credit', () => {
    // A longer label on the same 16 bytes is still 128 bits.
    expect(bitsOf(run({ generator: 'apikey', prefix: 'sk', bytes: '16' }))).toBe(
      128,
    )
    expect(
      bitsOf(run({ generator: 'apikey', prefix: 'myapp', bytes: '16' })),
    ).toBe(128)
    expect(bitsOf(run({ generator: 'apikey', prefix: '', bytes: '8' }))).toBe(64)
  })
})

describe('hand-computed entropy', () => {
  // Worked out away from the code, to one decimal place, in the units the
  // Entropy row prints.
  it('is 47.6 bits for an 8-character alphanumeric password', () => {
    const result = run({ generator: 'password', chars: 'alphanumeric', length: '8' })
    expect(bitsOf(result)).toBeCloseTo(47.6, 1)
  })

  it('is 41.4 bits for a four-word passphrase', () => {
    expect(bitsOf(run({ generator: 'passphrase', words: '4' }))).toBeCloseTo(
      41.4,
      1,
    )
  })

  it('is 128.0 bits for 16 random bytes', () => {
    expect(bitsOf(run({ generator: 'hex', bytes: '16' }))).toBeCloseTo(128.0, 1)
  })

  it('is 122.0 bits for a v4 UUID', () => {
    expect(bitsOf(run({ generator: 'uuid' }))).toBeCloseTo(122.0, 1)
  })
})

describe('rejected options', () => {
  const rejects = (options: ToolOptions) => {
    const result = run(options)
    expect(result.ok).toBe(false)
    expect(result.error).toBeTruthy()
    expect(result.output).toBe('')
    return result.error ?? ''
  }

  it('refuses a zero-length password', () => {
    expect(rejects({ generator: 'password', length: '0' })).toMatch(/at least 1/)
  })

  it('refuses a zero-word passphrase', () => {
    expect(rejects({ generator: 'passphrase', words: '0' })).toMatch(/at least 1/)
  })

  it('refuses zero random bytes', () => {
    expect(rejects({ generator: 'hex', bytes: '0' })).toMatch(/at least 1/)
    expect(rejects({ generator: 'base64', bytes: '0' })).toMatch(/at least 1/)
    expect(rejects({ generator: 'apikey', bytes: '0' })).toMatch(/at least 1/)
  })

  it('refuses a count that is not a whole number', () => {
    expect(rejects({ generator: 'password', length: '12.5' })).toContain('12.5')
    expect(rejects({ generator: 'passphrase', words: 'four' })).toContain('four')
  })

  it('refuses a negative count', () => {
    expect(rejects({ generator: 'hex', bytes: '-8' })).toMatch(/at least 1/)
  })

  it('names an unknown generator rather than guessing one', () => {
    expect(rejects({ generator: 'enigma' })).toContain('enigma')
  })
})
