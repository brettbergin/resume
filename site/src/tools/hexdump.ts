/*
 * The classic `hexdump -C` layout, shared by every tool that has to show
 * bytes rather than text — base64 and hex decoding to something that is not
 * valid UTF-8, a certificate's raw fingerprint bytes.
 *
 * Rendered into the pane's `<pre>`, so the columns are aligned with spaces
 * and the last, short line is padded to keep the ASCII gutter in place:
 *
 *   00000000  66 6f 6f 62 61 72 0a 00  ff                       |foobar...|
 *
 * Offsets are 8 hex digits, bytes are grouped 8 and 8, and any byte outside
 * printable ASCII shows as `.` in the gutter — the point of the view is that
 * the reader can see the byte values, not that the text is legible.
 */

/** Bytes per line, split into two groups for the middle gap. */
const BYTES_PER_LINE = 16
const GROUP_SIZE = 8

const hexByte = (byte: number): string => byte.toString(16).padStart(2, '0')

/** Printable ASCII renders as itself; everything else, control bytes and
 * anything above 0x7e alike, renders as a dot. */
const asciiByte = (byte: number): string =>
  byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : '.'

/** The hex column for one line, padded to the width of a full line so short
 * final lines still line up with the ones above them. */
function hexColumn(line: Uint8Array): string {
  const cells: string[] = []
  for (let index = 0; index < BYTES_PER_LINE; index += 1) {
    if (index > 0 && index % GROUP_SIZE === 0) cells.push('')
    cells.push(index < line.length ? hexByte(line[index]) : '  ')
  }
  return cells.join(' ')
}

/** A `hexdump -C` style rendering of `bytes`. Empty input gives an empty
 * string rather than a lone offset line: the pane shows nothing at all for an
 * empty result, which reads better than a dump of no bytes. */
export function hexdump(bytes: Uint8Array): string {
  const lines: string[] = []
  for (let offset = 0; offset < bytes.length; offset += BYTES_PER_LINE) {
    const line = bytes.subarray(offset, offset + BYTES_PER_LINE)
    const ascii = Array.from(line, asciiByte).join('')
    lines.push(
      `${offset.toString(16).padStart(8, '0')}  ${hexColumn(line)}  |${ascii}|`,
    )
  }
  return lines.join('\n')
}
