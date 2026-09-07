/*
 * `wawoff2` ships no type declarations and has no `@types/wawoff2` package, so
 * without this the one `import { decompress } from 'wawoff2'` in
 * `generate-images.ts` fails `npm run typecheck` under
 * `tsconfig.node.json`. Only the half of the module the generator uses is
 * declared: `decompress`, the WOFF2 -> TTF direction. Widen it if the script
 * ever needs `compress` too rather than reaching for `any`.
 */

declare module 'wawoff2' {
  /** Decompresses a WOFF2 font into the SFNT (TTF) bytes it wraps. */
  export function decompress(input: Uint8Array): Promise<Uint8Array>
}
