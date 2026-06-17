import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
  // TanStack Router route files export Route (non-component constant) alongside local components
  // shadcn/ui files export *Variants helpers alongside components
  {
    files: ['src/routes/**/*.{ts,tsx}', 'src/components/ui/**/*.{ts,tsx}'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
  // Route files use Date.now() for snapshot comparisons (e.g. isPaused display logic)
  {
    files: ['src/routes/**/*.{ts,tsx}'],
    rules: {
      'react-hooks/purity': 'off',
    },
  },
  // Simulation-split invariant: browser code must never import the Node-only
  // entrypoint. `@delivery/simulation/generate` pulls in Mapbox/FS; the
  // browser-safe surface is `@delivery/simulation/interpolate`. This was
  // convention-only — now linted.
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@delivery/simulation/generate', '@delivery/simulation/src/*'],
              message:
                'Node-only (Mapbox/FS). Browser code must import @delivery/simulation/interpolate instead.',
            },
          ],
        },
      ],
    },
  },
])
