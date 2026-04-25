// Flat ESLint config (ESLint 9). We deliberately keep the ruleset narrow:
// the goal is to catch real defects (syntax, dead code, bad equality),
// not to fight the existing style. Formatting is delegated to Prettier;
// see .prettierrc.json. The 23k-line monolith in public/index.html is
// excluded because it predates this gate and is on a separate refactor track.
import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import globals from 'globals';

export default [
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'dist-electron/**',
      'public/index.html',
      'public/sw.js',
      'public/analyzer.worker.js',
      'public/titan-keylock-worklet.js',
      'package-lock.json',
      'site/**',
      'coverage/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
        ...globals.node,
        React: 'readonly',
      },
    },
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'eqeqeq': ['error', 'always', { null: 'ignore' }],
      'no-implicit-coercion': 'off',
      'prefer-const': 'warn',
      // Stale eslint-disable directives from before this config existed —
      // demote to warning so they don't block CI while we migrate.
      'no-unused-private-class-members': 'off',
    },
  },
  {
    files: ['supabase/functions/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.browser,
        Deno: 'readonly',
        AlgorithmIdentifier: 'readonly',
      },
    },
  },
  {
    files: ['**/*.test.ts', '**/*.spec.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    files: ['electron/**/*.js', 'tools/**/*.js'],
    languageOptions: {
      globals: { ...globals.node },
      sourceType: 'commonjs',
    },
  },
];
