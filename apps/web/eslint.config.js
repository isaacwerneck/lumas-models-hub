import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'coverage', 'playwright-report', 'test-results']),
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
    rules: {
      // Data fetching intentionally updates loading state from effects.
      'react-hooks/set-state-in-effect': 'off',
      // Providers colocate their hooks with the provider component.
      'react-refresh/only-export-components': 'off',
      // Fetch callbacks are recreated intentionally; requests are keyed by explicit dependencies.
      'react-hooks/exhaustive-deps': 'off',
    },
  },
])
