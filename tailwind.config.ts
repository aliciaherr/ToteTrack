import type { Config } from 'tailwindcss'

// Tailwind v4 moves configuration to CSS (@theme blocks in globals.css).
// This file is kept for shadcn CLI compatibility (components.json references it).
const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
  ],
}

export default config
