import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import prettier from 'eslint-config-prettier'

// Flat config. ESLint is the correctness gate (typescript-eslint + react-hooks);
// formatting is left to Prettier, and `prettier` (eslint-config-prettier) turns off
// any stylistic rules that would fight it — so lint never argues about whitespace or
// the hand-aligned data tables in src/data.
export default tseslint.config(
  { ignores: ['dist', 'out', 'node_modules', '**/*.tsbuildinfo'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // TypeScript already flags undeclared identifiers; no-undef just double-reports.
      'no-undef': 'off',
      // Allow intentionally-unused names prefixed with `_` (e.g. throwaway map args).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // The codebase uses `cond ? a() : b()` and `cond && fn()` as terse statements.
      '@typescript-eslint/no-unused-expressions': [
        'error',
        { allowShortCircuit: true, allowTernary: true },
      ],
    },
  },
  // Config + build scripts run in Node and may use CommonJS-ish globals.
  {
    files: ['*.{js,cjs,mjs,ts}', 'vite.config.ts', 'vitest.config.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
  // SetupView hosts the local dev-seeder UI and a few migration leftovers (e.g. the
  // old ImportModal). It's under active local dev churn and is intentionally not
  // edited here, so its unused-symbol findings are downgraded rather than gating CI.
  {
    files: ['src/components/SetupView/SetupView.tsx'],
    rules: { '@typescript-eslint/no-unused-vars': 'warn' },
  },
  prettier,
)
