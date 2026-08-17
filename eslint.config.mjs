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
  {
    rules: {
      // `eslint-config-next` registers this rule as a bare `'warn'`, so the
      // rule's own defaults apply — and typescript-eslint defaults
      // `ignoreRestSiblings` to **false**. That is what flagged this repo's
      // `framer-motion` test mocks: they pull `initial`, `animate`, `exit`,
      // `transition` and `variants` out of a destructure purely so those props
      // do NOT reach the spread onto a real DOM node. The names are the
      // stripping mechanism, not leftovers, so the default is overridden here
      // rather than silenced at the 59 sites (across 8 files) it reported.
      //
      // The `^_` patterns are the conventional marker for a binding that must
      // exist positionally but is deliberately unused. Largely pre-emptive —
      // the repo has few such bindings today — but it is the convention the
      // codebase reaches for when it needs one.
      //
      // This narrows what the rule reports; it does not disable it. A genuinely
      // unused variable with a normal name is still a warning.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          // `args` is deliberately not set — 'after-used' is already the
          // plugin default, and restating a default reads as an override.
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },
]

export default config
