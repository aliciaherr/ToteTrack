import coreWebVitals from 'eslint-config-next/core-web-vitals'
import typescript from 'eslint-config-next/typescript'

/**
 * Flat ESLint config. Replaces the removed `next lint` command in Next.js 16;
 * `npm run lint` now drives the ESLint CLI against this file.
 */
const config = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'next-env.d.ts',
      'drizzle/**',
    ],
  },
  ...coreWebVitals,
  ...typescript,
]

export default config
