import { describe, expect, it, vi } from 'vitest'

import { MAX_DECODE_PASSES, decodeLayers, layersField } from './layers.ts'

/*
 * The two properties the url and html tools rely on: the walk stops, and the
 * count it reports is the number of passes that actually changed something —
 * one for ordinary input, more only when the value was encoded more than once.
 */

/** A toy decoder: strips one trailing `!` per pass. */
const stripBang = (value: string) => value.replace(/!$/, '')

describe('decodeLayers', () => {
  it('reports 1 layer for input that decodes to itself', () => {
    expect(decodeLayers('plain', stripBang)).toEqual({
      value: 'plain',
      layers: 1,
    })
  })

  it('reports 1 layer for input that decodes exactly once', () => {
    expect(decodeLayers('plain!', stripBang)).toEqual({
      value: 'plain',
      layers: 1,
    })
  })

  it('keeps decoding until the value stops changing', () => {
    expect(decodeLayers('plain!!!', stripBang)).toEqual({
      value: 'plain',
      layers: 3,
    })
  })

  it('reports 1 layer for empty input', () => {
    expect(decodeLayers('', stripBang)).toEqual({ value: '', layers: 1 })
  })

  it('stops after at most 8 passes on input that never settles', () => {
    // A decoder that always changes its input would spin forever without the
    // cap — the case the cap exists for.
    const grow = vi.fn((value: string) => `${value}x`)
    const result = decodeLayers('a', grow)

    expect(MAX_DECODE_PASSES).toBe(8)
    expect(grow).toHaveBeenCalledTimes(MAX_DECODE_PASSES)
    expect(result.layers).toBe(MAX_DECODE_PASSES)
    expect(result.value).toBe('axxxxxxxx')
  })

  it('calls the decoder once more than the layers it reports, to see it settle', () => {
    const decoder = vi.fn(stripBang)
    decodeLayers('plain!!', decoder)
    expect(decoder).toHaveBeenCalledTimes(3)
  })
})

describe('layersField', () => {
  it('says nothing when one pass was all it took', () => {
    expect(layersField(0)).toBeUndefined()
    expect(layersField(1)).toBeUndefined()
  })

  it('reports the count when the input was multiply encoded', () => {
    expect(layersField(2)).toEqual({ label: 'Layers', value: 'decoded 2 layers' })
    expect(layersField(3)?.value).toBe('decoded 3 layers')
  })
})
