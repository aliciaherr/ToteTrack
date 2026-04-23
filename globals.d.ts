/**
 * Ambient module declarations so TypeScript accepts side-effect imports
 * that aren't JavaScript/TypeScript files. Specifically: `import './globals.css'`
 * in `app/layout.tsx` — Next.js handles the actual CSS at build time, but
 * without this shim `tsc --noEmit` fails with TS2882.
 */

declare module '*.css'
