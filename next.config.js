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
}

module.exports = nextConfig
