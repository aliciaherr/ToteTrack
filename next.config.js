/** @type {import('next').NextConfig} */
const nextConfig = {
  // Next 16 changed several `images` defaults (minimumCacheTTL 60s -> 14400s,
  // qualities -> [75], imageSizes drops 16, maximumRedirects -> 3). Reviewed at
  // the Task 84 upgrade: this repo imports `next/image` nowhere, so none of the
  // new defaults are reachable and no override is needed.
  images: {
    remotePatterns: [],
  },
  // Next 16 writes AGENTS.md and CLAUDE.md into the repo root on every dev run
  // and build. This project's agent context is owned by the SBDev framework, so
  // the generated files are turned off rather than gitignored.
  agentRules: false,
  // The PO renderer (lib/extraction/render-pdf.ts) loads pdfjs's Node build and
  // a native canvas binary. Bundling either breaks it, so both are required at
  // runtime from node_modules instead (A-14; verify on the first preview deploy).
  serverExternalPackages: ['pdfjs-dist', '@napi-rs/canvas'],
  // The renderer reads pdfjs's fonts, CMaps, colour profiles and wasm decoders
  // by path at runtime (render-pdf.ts), which file tracing cannot see. Ship
  // them with the only route that renders.
  outputFileTracingIncludes: {
    '/api/ingest/extract': ['./node_modules/pdfjs-dist/{standard_fonts,cmaps,iccs,wasm}/**/*'],
  },
}

module.exports = nextConfig
