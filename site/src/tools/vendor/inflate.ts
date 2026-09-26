/*
 * Raw DEFLATE decompression (RFC 1951), vendored.
 *
 * Vendored for the reason the rest of this directory exists: the SAML tool
 * needs exactly one thing from a compression library, and every library that
 * offers it also brings a compressor, a zlib/gzip framing layer and a stream
 * abstraction, none of which a page that ships no dependencies should carry.
 *
 * The need comes from the SAML HTTP-Redirect binding (SAMLBind 2.0 §3.4.4.1),
 * which DEFLATEs a `SAMLRequest`/`SAMLResponse` document, base64-encodes the
 * result and puts it in a query parameter. "DEFLATE" there means the raw bit
 * stream of RFC 1951 with no zlib header and no Adler-32 trailer, so that is
 * the only thing this module reads: a caller holding a zlib or gzip stream
 * must strip the wrapper itself, because guessing which framing a pile of
 * bytes carries is a decision for the tool, not for the decompressor.
 *
 * `DecompressionStream('deflate-raw')` would do the same job in a modern
 * browser, but it is asynchronous, and the tool contract on this page is
 * built out of pure synchronous functions. A few hundred lines of table
 * lookup is the cheaper side of that trade.
 *
 * All three block types RFC 1951 defines are handled — stored, fixed Huffman
 * and dynamic Huffman — because a real identity provider's redirect URL is
 * always a dynamic-Huffman stream: fixed codes only win on input too short to
 * pay for a code table, which no SAML document is.
 *
 * Self-contained by design — no imports, browser or otherwise — and it only
 * ever reads: the array that goes in is not modified, and the bytes that come
 * out are freshly allocated. Malformed or truncated input throws; nothing
 * here returns a partial decode, because a caller cannot tell a truncated
 * document from a short one by looking at the bytes.
 *
 * ## Why there is a size limit
 *
 * Decompression is the one operation on this page whose cost is not bounded
 * by the length of the bytes handed to it: DEFLATE's single-stream ratio tops
 * out near 1032:1, so a kilobyte of attacker-chosen input can ask for a
 * megabyte of output and a megabyte can ask for a gigabyte. Everything here
 * runs synchronously on the main thread, and the callers are detectors that
 * run over whatever is in someone's clipboard, so an unbounded inflate is a
 * frozen tab or an out-of-memory crash for the reader — triggered by a paste
 * that need not even look like the format the tool decodes.
 *
 * So output is capped, the cap is checked before each allocation rather than
 * after the fact, and passing it throws `InflateLimitError` instead of
 * returning a truncated decode. A caller that knows how large its documents
 * get should say so; `DEFAULT_MAX_OUTPUT_BYTES` is the backstop for one that
 * does not.
 */

/**
 * Thrown when a stream decodes to more bytes than the caller allowed.
 *
 * Its own class, not a plain `Error`, so a caller can tell "this is a
 * decompression bomb" from "these bytes are not a DEFLATE stream" without
 * matching on a message. Both are refusals, but only one of them is a
 * statement about the *size* of what the input asked for.
 */
export class InflateLimitError extends Error {
  constructor(limit: number) {
    super(`inflate: decompressed output exceeds the ${limit}-byte limit`)
    this.name = 'InflateLimitError'
  }
}

/** The cap applied when a caller names none: comfortably above any document
 * this page decodes, far below what a crafted stream would ask for. */
export const DEFAULT_MAX_OUTPUT_BYTES = 8 * 1024 * 1024

export interface InflateOptions {
  /** Maximum number of decoded bytes to produce before throwing
   * `InflateLimitError`. Defaults to `DEFAULT_MAX_OUTPUT_BYTES`. */
  limit?: number
}

/** The longest Huffman code RFC 1951 permits, for every one of its alphabets.
 * Decoding past this length means the bit stream did not match the table. */
const MAX_CODE_BITS = 15

/** First output length encoded by length symbols 257..285 (RFC 1951 §3.2.5).
 * The last entry, 258, is the odd one out: it takes no extra bits, which is
 * why the table is written out rather than computed. */
const LENGTH_BASE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67,
  83, 99, 115, 131, 163, 195, 227, 258,
]

/** Extra bits read after each of those symbols and added to its base. */
const LENGTH_EXTRA_BITS = [
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5,
  5, 5, 0,
]

/** First back-reference distance encoded by distance symbols 0..29. */
const DISTANCE_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769,
  1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577,
]

/** Extra bits read after each distance symbol and added to its base. */
const DISTANCE_EXTRA_BITS = [
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11,
  11, 12, 12, 13, 13,
]

/** The order the code-length alphabet's own lengths appear in a dynamic
 * block's header (RFC 1951 §3.2.7). The permutation puts the lengths most
 * likely to be zero last, so a producer can stop emitting them early. */
const CODE_LENGTH_ORDER = [
  16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15,
]

/** Block type field of a block header (RFC 1951 §3.2.3). */
const STORED_BLOCK = 0
const FIXED_BLOCK = 1
const DYNAMIC_BLOCK = 2

/** The literal/length symbol that ends a block. */
const END_OF_BLOCK = 256

/**
 * A canonical Huffman table in the counts-and-symbols form: `counts[n]` is
 * how many codes are `n` bits long, and `symbols` lists every symbol that has
 * a code, ordered by code length and then by symbol. That pair is enough to
 * walk the tree one bit at a time without materialising it, which keeps the
 * per-block setup cost to a couple of passes over the code lengths — the
 * whole point when a dynamic block rebuilds both tables from scratch.
 */
interface HuffmanTable {
  counts: Int32Array
  symbols: Int32Array
}

/**
 * Builds the decoding table for an alphabet, given each symbol's code length
 * (zero meaning "this symbol has no code").
 *
 * Rejects an over-subscribed set — one that claims more codes of some length
 * than the tree has room for — because such a table has no consistent
 * assignment and any decode against it would be invented. Under-subscribed
 * (incomplete) sets are allowed through: RFC 1951 permits a block whose
 * distance alphabet has a single code, and a stream that then tries to use a
 * code the table does not define fails at that point instead, with the same
 * error a garbage bit run gets.
 */
function buildHuffmanTable(lengths: ArrayLike<number>): HuffmanTable {
  const counts = new Int32Array(MAX_CODE_BITS + 1)
  for (let symbol = 0; symbol < lengths.length; symbol += 1) {
    const length = lengths[symbol]
    if (length > MAX_CODE_BITS) {
      throw new Error(`inflate: code length ${length} exceeds the 15-bit maximum`)
    }
    counts[length] += 1
  }
  // Symbols with no code are not part of the tree, however many there are.
  counts[0] = 0

  // Kraft's inequality, run as a budget: each extra bit doubles the number of
  // available codes, and every code of that length spends one of them.
  let available = 1
  for (let length = 1; length <= MAX_CODE_BITS; length += 1) {
    available <<= 1
    available -= counts[length]
    if (available < 0) {
      throw new Error('inflate: over-subscribed Huffman code table')
    }
  }

  // Where each code length's block of symbols starts within `symbols`.
  const offsets = new Int32Array(MAX_CODE_BITS + 2)
  for (let length = 1; length <= MAX_CODE_BITS; length += 1) {
    offsets[length + 1] = offsets[length] + counts[length]
  }

  const symbols = new Int32Array(offsets[MAX_CODE_BITS + 1])
  for (let symbol = 0; symbol < lengths.length; symbol += 1) {
    const length = lengths[symbol]
    if (length !== 0) {
      symbols[offsets[length]] = symbol
      offsets[length] += 1
    }
  }

  return { counts, symbols }
}

/** The fixed literal/length code lengths of RFC 1951 §3.2.6: 8 bits for the
 * common literals, 9 for the high ones, 7 for the low length symbols. */
const FIXED_LITERAL_TABLE = buildHuffmanTable(
  Uint8Array.from({ length: 288 }, (_unused, symbol) => {
    if (symbol < 144) return 8
    if (symbol < 256) return 9
    if (symbol < 280) return 7
    return 8
  }),
)

/** The fixed distance code: thirty-two 5-bit codes, of which the top two are
 * never legal as distances but still occupy the tree. */
const FIXED_DISTANCE_TABLE = buildHuffmanTable(new Uint8Array(32).fill(5))

/**
 * A little-endian bit reader over the compressed stream.
 *
 * DEFLATE packs its bits low-to-high within each byte, while the extra-bit
 * fields it reads are themselves little-endian integers, so one `readBits`
 * serves both. Running off the end of the input is an error rather than an
 * implicit run of zero bits: zeros decode to something, and "something" from
 * a truncated stream is exactly the silent corruption this module must not
 * produce.
 */
class BitReader {
  private readonly source: Uint8Array
  private position = 0
  /** Bits pulled from `source` but not yet consumed, lowest bit first. */
  private bitBuffer = 0
  private bitCount = 0

  constructor(source: Uint8Array) {
    this.source = source
  }

  /** Reads `count` bits (0..24) as an unsigned little-endian integer. */
  readBits(count: number): number {
    while (this.bitCount < count) {
      if (this.position >= this.source.length) {
        throw new Error('inflate: unexpected end of compressed input')
      }
      this.bitBuffer |= this.source[this.position] << this.bitCount
      this.position += 1
      this.bitCount += 8
    }
    const value = this.bitBuffer & ((1 << count) - 1)
    this.bitBuffer >>>= count
    this.bitCount -= count
    return value
  }

  /** Discards the rest of the current byte, as a stored block's header
   * requires before its byte-aligned length fields. */
  alignToByte(): void {
    this.bitBuffer = 0
    this.bitCount = 0
  }

  /** Copies `count` whole bytes straight from the input, for stored blocks.
   * Only valid immediately after `alignToByte`. */
  readBytes(count: number): Uint8Array {
    const end = this.position + count
    if (end > this.source.length) {
      throw new Error('inflate: unexpected end of stored block')
    }
    const slice = this.source.subarray(this.position, end)
    this.position = end
    return slice
  }

  /**
   * Decodes one symbol from `table`, one bit at a time.
   *
   * Canonical codes are ordered, so at each length the codes form a
   * contiguous numeric range starting at `first`; if the bits read so far
   * fall inside that range, the symbol is at the matching offset in the
   * table's symbol list. Otherwise the range is skipped and another bit is
   * taken. Fifteen failed lengths means no code matches — a corrupt stream.
   */
  decodeSymbol(table: HuffmanTable): number {
    let code = 0
    let first = 0
    let index = 0

    for (let length = 1; length <= MAX_CODE_BITS; length += 1) {
      code |= this.readBits(1)
      const count = table.counts[length]
      if (code - first < count) {
        return table.symbols[index + (code - first)]
      }
      index += count
      first = (first + count) << 1
      code <<= 1
    }

    throw new Error('inflate: invalid Huffman code in compressed input')
  }
}

/**
 * An output buffer that grows by doubling, up to a fixed ceiling.
 *
 * Back-references copy from what has already been written, so the decoded
 * bytes have to stay addressable as they accumulate; `Uint8Array` cannot
 * grow, and pushing to a plain array then converting costs more than the
 * occasional reallocation.
 *
 * `limit` is enforced in `reserve`, which every write goes through, so the
 * check happens before the memory is asked for rather than after it has been
 * handed out: a bomb is refused at the byte that crosses the line, not once
 * the allocator has already been walked up to gigabytes.
 */
class ByteSink {
  private buffer: Uint8Array
  private length = 0
  private readonly limit: number

  constructor(initialCapacity: number, limit: number) {
    this.limit = limit
    // Never speculate past the ceiling: the initial guess is derived from the
    // compressed length, which a crafted stream also chooses.
    this.buffer = new Uint8Array(Math.max(Math.min(initialCapacity, limit), 64))
  }

  get size(): number {
    return this.length
  }

  private reserve(extra: number): void {
    const needed = this.length + extra
    if (needed > this.limit) throw new InflateLimitError(this.limit)
    if (needed <= this.buffer.length) return
    let capacity = this.buffer.length
    while (capacity < needed) capacity *= 2
    const grown = new Uint8Array(Math.min(capacity, this.limit))
    grown.set(this.buffer.subarray(0, this.length))
    this.buffer = grown
  }

  push(byte: number): void {
    this.reserve(1)
    this.buffer[this.length] = byte
    this.length += 1
  }

  append(bytes: Uint8Array): void {
    this.reserve(bytes.length)
    this.buffer.set(bytes, this.length)
    this.length += bytes.length
  }

  /**
   * Repeats `length` bytes from `distance` back, byte by byte.
   *
   * The copy must not be vectorised: DEFLATE relies on overlapping runs, so a
   * distance of 1 and a length of 200 means "repeat the last byte 200 times",
   * and each byte written is legitimate source for the next.
   */
  copyBack(distance: number, length: number): void {
    if (distance > this.length) {
      throw new Error('inflate: back-reference points before the start of the output')
    }
    this.reserve(length)
    let from = this.length - distance
    for (let written = 0; written < length; written += 1) {
      this.buffer[this.length] = this.buffer[from]
      this.length += 1
      from += 1
    }
  }

  /** The decoded bytes, copied out so the caller never holds slack capacity. */
  toBytes(): Uint8Array {
    return this.buffer.slice(0, this.length)
  }
}

/** Reads a stored (uncompressed) block: a byte-aligned length, its
 * complement as a check, then that many literal bytes. */
function inflateStoredBlock(reader: BitReader, output: ByteSink): void {
  reader.alignToByte()
  const header = reader.readBytes(4)
  const length = header[0] | (header[1] << 8)
  const complement = header[2] | (header[3] << 8)
  if (length !== (~complement & 0xffff)) {
    throw new Error('inflate: stored block length does not match its complement')
  }
  output.append(reader.readBytes(length))
}

/**
 * Reads the two code tables a dynamic block carries in its header.
 *
 * The tables are themselves Huffman-coded: a small alphabet of code lengths
 * is described first, and the literal/length and distance code lengths are
 * then decoded with it, including run-length symbols for repeats.
 */
function readDynamicTables(reader: BitReader): {
  literals: HuffmanTable
  distances: HuffmanTable
} {
  const literalCount = reader.readBits(5) + 257
  const distanceCount = reader.readBits(5) + 1
  const codeLengthCount = reader.readBits(4) + 4

  if (literalCount > 286) {
    throw new Error('inflate: too many literal/length codes in dynamic block')
  }
  if (distanceCount > 30) {
    throw new Error('inflate: too many distance codes in dynamic block')
  }

  const codeLengthLengths = new Uint8Array(CODE_LENGTH_ORDER.length)
  for (let index = 0; index < codeLengthCount; index += 1) {
    codeLengthLengths[CODE_LENGTH_ORDER[index]] = reader.readBits(3)
  }
  const codeLengthTable = buildHuffmanTable(codeLengthLengths)

  // Both alphabets' lengths are coded as one run, so a repeat may straddle
  // the boundary between them; they are split only once the run is complete.
  const total = literalCount + distanceCount
  const lengths = new Uint8Array(total)
  let index = 0
  while (index < total) {
    const symbol = reader.decodeSymbol(codeLengthTable)
    if (symbol < 16) {
      lengths[index] = symbol
      index += 1
      continue
    }

    let repeat: number
    let value: number
    if (symbol === 16) {
      if (index === 0) {
        throw new Error('inflate: code length repeat with no previous length')
      }
      value = lengths[index - 1]
      repeat = reader.readBits(2) + 3
    } else if (symbol === 17) {
      value = 0
      repeat = reader.readBits(3) + 3
    } else {
      value = 0
      repeat = reader.readBits(7) + 11
    }

    if (index + repeat > total) {
      throw new Error('inflate: code length repeat overruns the alphabet')
    }
    lengths.fill(value, index, index + repeat)
    index += repeat
  }

  if (lengths[END_OF_BLOCK] === 0) {
    throw new Error('inflate: dynamic block has no end-of-block code')
  }

  return {
    literals: buildHuffmanTable(lengths.subarray(0, literalCount)),
    distances: buildHuffmanTable(lengths.subarray(literalCount)),
  }
}

/** Reads one compressed block's symbols until its end-of-block code, using
 * whichever pair of tables the block header selected. */
function inflateCompressedBlock(
  reader: BitReader,
  output: ByteSink,
  literals: HuffmanTable,
  distances: HuffmanTable,
): void {
  for (;;) {
    const symbol = reader.decodeSymbol(literals)

    if (symbol < END_OF_BLOCK) {
      output.push(symbol)
      continue
    }
    if (symbol === END_OF_BLOCK) {
      return
    }

    const lengthIndex = symbol - 257
    if (lengthIndex >= LENGTH_BASE.length) {
      throw new Error(`inflate: invalid length symbol ${symbol}`)
    }
    const length =
      LENGTH_BASE[lengthIndex] + reader.readBits(LENGTH_EXTRA_BITS[lengthIndex])

    const distanceSymbol = reader.decodeSymbol(distances)
    if (distanceSymbol >= DISTANCE_BASE.length) {
      throw new Error(`inflate: invalid distance symbol ${distanceSymbol}`)
    }
    const distance =
      DISTANCE_BASE[distanceSymbol] +
      reader.readBits(DISTANCE_EXTRA_BITS[distanceSymbol])

    output.copyBack(distance, length)
  }
}

/**
 * Decompresses a raw DEFLATE stream (RFC 1951) into the bytes it encodes.
 *
 * "Raw" means no zlib header and no gzip header: the first bits of `bytes`
 * are expected to be a block header. Decoding stops at the block marked
 * final, and any trailing bytes after it are ignored, since a raw stream
 * carries no length or checksum that could say whether they belong to it.
 *
 * Throws on anything it cannot decode — a truncated stream, an inconsistent
 * code table, a back-reference reaching before the start of the output — so
 * that a caller never mistakes salvaged fragments for a complete document.
 *
 * Output is capped at `options.limit` bytes (`DEFAULT_MAX_OUTPUT_BYTES` when
 * unset); a stream that decodes to more throws `InflateLimitError` at the
 * byte that crosses it. See the note on size limits at the top of this file.
 */
export function inflateRaw(bytes: Uint8Array, options: InflateOptions = {}): Uint8Array {
  const limit = options.limit ?? DEFAULT_MAX_OUTPUT_BYTES
  if (!Number.isFinite(limit) || limit < 0) {
    throw new Error('inflate: the output limit must be a non-negative number')
  }

  const reader = new BitReader(bytes)
  // Compression ratios on the XML this exists to read run well above 4x, so
  // starting there usually avoids reallocating at all.
  const output = new ByteSink(bytes.length * 4, limit)

  let final = false
  while (!final) {
    final = reader.readBits(1) === 1
    const blockType = reader.readBits(2)

    if (blockType === STORED_BLOCK) {
      inflateStoredBlock(reader, output)
    } else if (blockType === FIXED_BLOCK) {
      inflateCompressedBlock(
        reader,
        output,
        FIXED_LITERAL_TABLE,
        FIXED_DISTANCE_TABLE,
      )
    } else if (blockType === DYNAMIC_BLOCK) {
      const { literals, distances } = readDynamicTables(reader)
      inflateCompressedBlock(reader, output, literals, distances)
    } else {
      throw new Error('inflate: reserved block type in compressed input')
    }
  }

  return output.toBytes()
}
