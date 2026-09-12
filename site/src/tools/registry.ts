/*
 * The one list of tools the `~/tools` page knows about. The sidebar renders
 * it in order, magic paste's detection sweep iterates it in order, and the
 * fragment's `<toolId>` segment is looked up in it — so registering a tool
 * here is the only step between a working module and a shipped tool.
 *
 * The order is pinned, not alphabetical and not arrival order:
 *
 *   magic, base64, hex, url, html, json, jwt, hash, cert, gpg, cidr, csp,
 *   headers, cvss, epoch, secret, totp
 *
 * magic first because it is the landing state; then the encodings, grouped;
 * then the credential and crypto tools; then the network and time ones. It
 * also settles ties in detection — when two tools return the same confidence,
 * the earlier one wins — which is why it stays stable as tools are added.
 * A new tool is inserted at its position above rather than appended.
 *
 * Every entry's `id` matches its module's file name (`base64` lives in
 * `base64.ts`), which `registry.test.ts` enforces: the id appears in URLs
 * people share, so it cannot drift from the module it names.
 */

import { base64 } from './base64.ts'
import { cert } from './cert.ts'
import { cidr } from './cidr.ts'
import { csp } from './csp.ts'
import { cvss } from './cvss.ts'
import { epoch } from './epoch.ts'
import { gpg } from './gpg.ts'
import { hash } from './hash.ts'
import { headers } from './headers.ts'
import { hex } from './hex.ts'
import { html } from './html.ts'
import { json } from './json.ts'
import { jwt } from './jwt.ts'
import { createMagic } from './magic.ts'
import { secret } from './secret.ts'
import { totp } from './totp.ts'
import type { Tool } from './types.ts'
import { url } from './url.ts'

/*
 * Magic paste is built here rather than imported ready-made, and that is the
 * whole cycle guard: it needs the tool list to sweep every `detect`, this
 * module needs it to list it first, and two static imports would leave the
 * outcome depending on which module a caller happened to load first. The
 * accessor closes over `tools` and is only called from inside a run, by which
 * point this module has finished evaluating. See the note in `magic.ts`.
 */
const magic = createMagic(() => tools)

export const tools: readonly Tool[] = [
  magic,
  base64,
  hex,
  url,
  html,
  json,
  jwt,
  hash,
  cert,
  gpg,
  cidr,
  csp,
  headers,
  cvss,
  epoch,
  secret,
  totp,
] as const

/** The tool a fragment's `<toolId>` names, or `undefined` when it names none
 * — a link from an older version of the page, or a typo. Callers fall back to
 * `DEFAULT_TOOL_ID` rather than rendering an empty pane. */
export function findTool(id: string): Tool | undefined {
  return tools.find((tool) => tool.id === id)
}
