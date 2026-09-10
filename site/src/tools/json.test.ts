import { describe, expect, it } from 'vitest'

import { buildToolHash, exceedsHashLimit, parseToolHash } from './fragment.ts'
import {
  formatJSON,
  json,
  parsePath,
  queryJSON,
  sortKeysDeep,
  validateJSON,
} from './json.ts'

/*
 * The error location is the part worth testing hardest: it is recovered from
 * an engine's `SyntaxError` message, so the assertions are on the line and
 * column the reader is sent to, never on the engine's wording — a V8 upgrade
 * that rephrases "Expected ':' after property name" must not fail this suite,
 * while one that moves the offset must.
 *
 * The document below is the JSONPath example document, trimmed: nested
 * objects, an array of objects, and a key (`title`) that appears at more than
 * one depth so recursive descent has something to find.
 */

const STORE = {
  store: {
    book: [
      { title: 'Sayings of the Century', price: 8.95 },
      { title: 'Moby Dick', price: 8.99 },
    ],
    bicycle: { color: 'red', price: 19.95 },
  },
  title: 'catalogue',
}

const DOCUMENT = JSON.stringify(STORE)

const validate = (input: string) => json.run(input, { mode: 'validate' })
const format = (input: string, indent = '2') =>
  json.run(input, { mode: 'format', indent })
const query = (input: string, path: string) =>
  json.run(input, { mode: 'query', query: path })

describe('json validation', () => {
  it('accepts a valid document and reports what it is', () => {
    const result = validateJSON('{"a":[1,2,3]}')
    expect(result).toMatchObject({ ok: true, output: 'Valid JSON' })
    expect(result.fields).toContainEqual({
      label: 'Type',
      value: 'object (1 key)',
    })
  })

  it('reports the size in UTF-8 bytes, not characters', () => {
    expect(validateJSON('"café"').fields).toContainEqual({
      label: 'Size',
      value: '7 bytes',
    })
  })

  it('names the top-level type of every kind of document', () => {
    const typeOf = (input: string) =>
      validateJSON(input).fields?.find((field) => field.label === 'Type')?.value
    expect(typeOf('[1,2]')).toBe('array (2 items)')
    expect(typeOf('[]')).toBe('array (0 items)')
    expect(typeOf('{"a":1,"b":2}')).toBe('object (2 keys)')
    expect(typeOf('"x"')).toBe('string')
    expect(typeOf('12')).toBe('number')
    expect(typeOf('true')).toBe('boolean')
    expect(typeOf('null')).toBe('null')
  })

  it('accepts an array and every bare primitive as a whole document', () => {
    for (const input of ['[1,2]', '12', '"x"', 'null', 'true']) {
      expect(validate(input), input).toMatchObject({
        ok: true,
        output: 'Valid JSON',
      })
    }
  })

  it('locates a failure on the first line', () => {
    const result = validate('{"a": 1,}')
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/^Invalid JSON at line 1, column 9: /)
  })

  it('locates a failure on a later line', () => {
    const result = validate('{\n  "a": 1,\n  "b" 2\n}')
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/^Invalid JSON at line 3, column 7: /)
  })

  it('locates a bad token the engine reports without an offset', () => {
    // V8's "Unexpected token 'o', ... is not valid JSON" form carries no
    // position; the offset is recovered from the token and the quoted window.
    expect(validate('[1, 2, nope, 4]').error).toMatch(
      /^Invalid JSON at line 1, column 9: /,
    )
  })

  it('locates a truncated document at the point the input ran out', () => {
    expect(validate('{"a": [1, 2').error).toMatch(
      /^Invalid JSON at line 1, column 12: /,
    )
  })

  it('keeps the engine reason but not its duplicated location', () => {
    const error = validate('{"a" 1}').error ?? ''
    expect(error).toMatch(/^Invalid JSON at line 1, column 6: \S/)
    expect(error).not.toMatch(/at position \d+/)
    expect(error).not.toMatch(/line \d+ column \d+/)
  })

  it('reports an unquoted key as invalid, with a location', () => {
    for (const input of ["{'a': 1}", '{a: 1}']) {
      const result = validate(input)
      expect(result.ok, input).toBe(false)
      expect(result.error, input).toContain('line')
      expect(result.error, input).toContain('column')
    }
  })
})

describe('json formatting', () => {
  it('pretty-prints with two spaces by default', () => {
    expect(format('{"a":[1]}').output).toBe('{\n  "a": [\n    1\n  ]\n}')
  })

  it('pretty-prints with four spaces', () => {
    expect(format('{"a":1}', '4').output).toBe('{\n    "a": 1\n}')
  })

  it('pretty-prints with tabs', () => {
    expect(format('{"a":1}', 'tab').output).toBe('{\n\t"a": 1\n}')
  })

  it('falls back to two spaces for an indent it does not offer', () => {
    expect(formatJSON('{"a":1}', 'wide').output).toBe('{\n  "a": 1\n}')
  })

  it('re-formats already formatted input idempotently', () => {
    const once = format(DOCUMENT).output
    expect(format(once).output).toBe(once)
  })

  it('minifies to a single line and reports the bytes saved', () => {
    const pretty = format(DOCUMENT).output
    const result = json.run(pretty, { mode: 'minify' })
    expect(result.output).toBe(DOCUMENT)
    expect(result.output).not.toContain('\n')
    expect(result.fields).toContainEqual({
      label: 'Saved',
      value: `${pretty.length - DOCUMENT.length} bytes`,
    })
  })

  it('reports the located error for malformed input in every mode', () => {
    for (const mode of ['format', 'minify', 'sort-keys', 'query']) {
      const result = json.run('{"a": 1,}', { mode, query: '$.a' })
      expect(result, mode).toMatchObject({ ok: false, output: '' })
      expect(result.error, mode).toMatch(/^Invalid JSON at line 1, column 9: /)
    }
  })
})

describe('sortKeysDeep', () => {
  it('sorts keys at every depth', () => {
    expect(sortKeysDeep({ b: 1, a: { d: 2, c: 3 } })).toEqual({
      a: { c: 3, d: 2 },
      b: 1,
    })
    expect(JSON.stringify(sortKeysDeep({ b: 1, a: { d: 2, c: 3 } }))).toBe(
      '{"a":{"c":3,"d":2},"b":1}',
    )
  })

  it('keeps array order but sorts the objects inside it', () => {
    expect(JSON.stringify(sortKeysDeep([{ b: 1, a: 2 }, 'z', 'a']))).toBe(
      '[{"a":2,"b":1},"z","a"]',
    )
  })

  it('passes primitives through unchanged', () => {
    expect(sortKeysDeep(null)).toBeNull()
    expect(sortKeysDeep(3)).toBe(3)
    expect(sortKeysDeep('a')).toBe('a')
    expect(sortKeysDeep(false)).toBe(false)
  })

  it('sorts lexicographically, not by the order the keys arrived in', () => {
    const sorted = json.run('{"z":1,"a":2}', { mode: 'sort-keys' }).output
    expect(sorted).toBe('{\n  "a": 2,\n  "z": 1\n}')
    expect(json.run(sorted, { mode: 'minify' }).output).toBe('{"a":2,"z":1}')
    expect(JSON.stringify(sortKeysDeep({ b: 1, A: 2, a: 3, '0': 4 }))).toBe(
      '{"0":4,"A":2,"a":3,"b":1}',
    )
  })

  it('sorts through the tool, honouring the indent option', () => {
    const result = json.run('{"b":1,"a":{"d":2,"c":3}}', {
      mode: 'sort-keys',
      indent: 'tab',
    })
    expect(result.output).toBe('{\n\t"a": {\n\t\t"c": 3,\n\t\t"d": 2\n\t},\n\t"b": 1\n}')
  })
})

describe('JSONPath-lite parsing', () => {
  it('parses dot properties, indexes and quoted keys', () => {
    expect(parsePath('$.store.book[0].title')).toEqual([
      { type: 'prop', key: 'store' },
      { type: 'prop', key: 'book' },
      { type: 'index', idx: 0 },
      { type: 'prop', key: 'title' },
    ])
    expect(parsePath("$['a']")).toEqual([{ type: 'prop', key: 'a' }])
    expect(parsePath('$["a b"][2]')).toEqual([
      { type: 'prop', key: 'a b' },
      { type: 'index', idx: 2 },
    ])
  })

  it('parses recursive descent', () => {
    expect(parsePath('$..title')).toEqual([{ type: 'descent', key: 'title' }])
    expect(parsePath('$.store..price')).toEqual([
      { type: 'prop', key: 'store' },
      { type: 'descent', key: 'price' },
    ])
  })

  it('parses the bare root as no steps at all', () => {
    expect(parsePath('$')).toEqual([])
    expect(parsePath('  $  ')).toEqual([])
  })

  it('rejects syntax it does not implement', () => {
    for (const path of [
      '',
      'store.book',
      '$.',
      '$..',
      '$.a.',
      '$[a]',
      '$[0',
      '$[*]',
      "$['a]",
      '$.a[?(@.price<10)]',
    ]) {
      expect(parsePath(path), path).toBeNull()
    }
  })
})

describe('json query', () => {
  it('selects a single property, a nested one, and one array element', () => {
    expect(JSON.parse(query('{"name":"Alice"}', '$.name').output) as unknown).toEqual(
      ['Alice'],
    )
    expect(JSON.parse(query('{"a":{"b":[1,2]}}', '$.a.b').output) as unknown).toEqual(
      [[1, 2]],
    )
    expect(JSON.parse(query('{"items":[10,20]}', '$.items[0]').output) as unknown).toEqual(
      [10],
    )
  })

  it('reports a query against invalid JSON as an error', () => {
    const result = query('{a:1}', '$.a')
    expect(result).toMatchObject({ ok: false, output: '' })
    expect(result.error).toContain('Invalid JSON')
  })

  it('follows dot properties and array indexes', () => {
    expect(query(DOCUMENT, '$.store.book[0].title').output).toBe(
      '[\n  "Sayings of the Century"\n]',
    )
    expect(query(DOCUMENT, "$.store['bicycle'].color").output).toBe(
      '[\n  "red"\n]',
    )
  })

  it('returns the whole document for the root path', () => {
    expect(query(DOCUMENT, '$').output).toBe(JSON.stringify([STORE], null, 2))
  })

  it('collects every match of a recursive descent, depth-first', () => {
    const result = query(DOCUMENT, '$..title')
    expect(JSON.parse(result.output) as unknown).toEqual([
      'Sayings of the Century',
      'Moby Dick',
      'catalogue',
    ])
    expect(result.fields).toContainEqual({ label: 'Matches', value: '3' })
  })

  it('descends from a subtree, not only from the root', () => {
    expect(JSON.parse(query(DOCUMENT, '$.store..price').output) as unknown).toEqual(
      [8.95, 8.99, 19.95],
    )
  })

  it('finds a nested key of the same name inside a match', () => {
    const nested = '{"a":{"name":"outer","b":{"name":"inner"}}}'
    expect(JSON.parse(query(nested, '$..name').output) as unknown).toEqual([
      'outer',
      'inner',
    ])
  })

  it('selects an object from inside an array of objects', () => {
    expect(JSON.parse(query(DOCUMENT, '$.store.book[1]').output) as unknown).toEqual(
      [{ title: 'Moby Dick', price: 8.99 }],
    )
  })

  it('reports no match for a path the document does not have', () => {
    expect(query(DOCUMENT, '$.store.magazine')).toMatchObject({
      ok: true,
      output: 'No match',
    })
    expect(query(DOCUMENT, '$.store.book[9]').output).toBe('No match')
    expect(query(DOCUMENT, '$..isbn').output).toBe('No match')
    // A property step on an array and an index step on an object both select
    // nothing rather than erroring.
    expect(query(DOCUMENT, '$.store.book.title').output).toBe('No match')
    expect(query(DOCUMENT, '$.store[0]').output).toBe('No match')
  })

  it('does not reach the prototype for a property name', () => {
    expect(query('{"a":1}', '$.constructor').output).toBe('No match')
    expect(query('{"a":1}', '$..toString').output).toBe('No match')
  })

  it('reports an unparseable path as an error, not as no match', () => {
    for (const path of ['$.a[?(@.b)]', '!bad', 'name']) {
      const result = query(DOCUMENT, path)
      expect(result, path).toMatchObject({ ok: false, output: '' })
      expect(result.error, path).toContain('Invalid path')
    }
    expect(queryJSON(DOCUMENT, '').error).toContain('(empty)')
  })
})

describe('the json tool', () => {
  it('returns nothing for empty or whitespace-only input in every mode', () => {
    for (const mode of ['validate', 'format', 'minify', 'sort-keys', 'query']) {
      const options = { mode, indent: '2', query: '$' }
      expect(json.run('', options), mode).toEqual({ ok: true, output: '' })
      expect(json.run('  \n\t', options), mode).toEqual({
        ok: true,
        output: '',
      })
    }
  })

  it('formats when no mode is given, matching the option default', () => {
    expect(json.options[0]?.default).toBe('format')
    expect(json.run('{"a":1}', {}).output).toBe('{\n  "a": 1\n}')
  })

  it('gives every option a default the pane can start from', () => {
    for (const option of json.options) {
      expect(option.default, option.key).not.toBe('')
      expect(option.secret, option.key).toBeUndefined()
    }
  })

  it('declares every option it reads, so the fragment can carry them', () => {
    // The fragment layer only round-trips declared options, so an option the
    // pane sets and `run` honours but `options` omits would be lost on reload.
    const keys = json.options.map((option) => option.key)
    expect(keys).toEqual(expect.arrayContaining(['mode', 'indent', 'query']))
  })

  it('restores its mode, query and input from a fragment', () => {
    const state = {
      tool: 'json',
      input: DOCUMENT,
      options: { mode: 'query', indent: 'tab', query: '$..title' },
    }
    const hash = buildToolHash(state)
    expect(exceedsHashLimit(state.input)).toBe(false)
    expect(parseToolHash(hash)).toEqual(state)
    const restored = parseToolHash(hash)
    expect(json.run(restored.input, restored.options).fields).toContainEqual({
      label: 'Matches',
      value: '3',
    })
  })

  it('detects objects and arrays confidently', () => {
    expect(json.detect('{"a":1}')).toBeGreaterThan(0.8)
    expect(json.detect('  [1, 2, 3]\n')).toBeGreaterThan(0.8)
    expect(json.detect('{"a":1}')).toBeGreaterThan(json.detect('12'))
    expect(json.detect('[1,2]')).toBeGreaterThan(json.detect('12'))
  })

  it('scores a bare scalar below a structured document', () => {
    // `1699999999` is valid JSON and is an epoch; `"abc"` is valid JSON and is
    // a quoted string. Both must lose to the tool whose format they really are.
    expect(json.detect('1699999999')).toBe(0.4)
    expect(json.detect('"abc"')).toBe(0.4)
    // Under hex's 0.5 for all-digit input too, so `123456` still reads as hex.
    expect(json.detect('123456')).toBeLessThan(0.5)
  })

  it('does not claim malformed or empty input', () => {
    expect(json.detect('{"a": 1,}')).toBe(0)
    expect(json.detect('not json')).toBe(0)
    expect(json.detect('')).toBe(0)
    expect(json.detect('   ')).toBe(0)
  })
})
