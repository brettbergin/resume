/*
 * Repeated decoding, shared by the url and html tools.
 *
 * Doubly-encoded input is the normal case, not the pathological one: a value
 * that went through a proxy and an application both percent-encoding it
 * arrives as `%2520`, and an entity that was escaped by a template and again
 * by whatever logged it arrives as `&amp;lt;`. Decoding once leaves the reader
 * looking at `%20` and wondering whether the tool is broken, so both tools
 * decode until the value stops changing and then *say* how many passes it
 * took — the count is the interesting part of the answer.
 *
 * The pass cap exists because "until it stops changing" is not guaranteed to
 * terminate on adversarial input: a decoder that lengthens its input, or one
 * fed a value that decodes to a fresh encoding of itself, would spin. Eight is
 * far past anything real (two layers is common, three is a bug someone is
 * hunting) and small enough that hitting it costs nothing.
 *
 * `decodeOnce` must not throw. Both callers validate the input themselves so
 * they can report a malformed escape as an error result, and hand this a
 * decoder that returns its input unchanged when a later layer will not decode
 * — an unchanged return is how a chain ends, so that stops the walk cleanly.
 */

import type { ToolField } from './types.ts'

/** How many times `decodeLayers` will apply its decoder before giving up. */
export const MAX_DECODE_PASSES = 8

/** A decoded value and how many passes changed it. `layers` is at least 1
 * even when nothing changed: "decoded 1 layer" is what a single, ordinary
 * decode is, and callers only surface the count when it is above 1. */
export interface DecodedLayers {
  value: string
  layers: number
}

/**
 * Apply `decodeOnce` to `input` until the result stops changing, at most
 * `MAX_DECODE_PASSES` times.
 */
export function decodeLayers(
  input: string,
  decodeOnce: (value: string) => string,
): DecodedLayers {
  let value = input
  let layers = 0

  for (let pass = 0; pass < MAX_DECODE_PASSES; pass += 1) {
    const next = decodeOnce(value)
    if (next === value) break
    value = next
    layers += 1
  }

  return { value, layers: Math.max(1, layers) }
}

/** The note a multiply-encoded input earns, or `undefined` when one pass was
 * all it took. Lives here rather than in each tool so url and html word it the
 * same way. */
export function layersField(layers: number): ToolField | undefined {
  if (layers <= 1) return undefined
  return { label: 'Layers', value: `decoded ${layers} layers` }
}
