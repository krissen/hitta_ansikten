// Flat ESLint config (ESLint 9.x).
//
// Pragmatic setup: @eslint/js recommended + react-hooks rules, tuned to
// pass the existing code. The generated workspace bundle and other build
// output are ignored, never linted.
import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import react from 'eslint-plugin-react';
import eslintConfigPrettier from 'eslint-config-prettier';

export default [
  // Global ignores (build output, deps, generated files).
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'src/renderer/workspace/dist/**',
      'resources/**',
      'Bildvisare-darwin-*/**',
      'src/version.json',
    ],
  },

  // Base recommended rules for all JS/JSX.
  js.configs.recommended,

  // React + hooks. jsx-uses-vars/jsx-uses-react keep the automatic JSX
  // runtime from tripping no-unused-vars on components and the React import.
  {
    files: ['**/*.{js,jsx}'],
    plugins: { react, 'react-hooks': reactHooks },
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: { react: { version: 'detect' } },
    rules: {
      'react/jsx-uses-vars': 'error',
      'react/jsx-uses-react': 'error',
      'react-hooks/rules-of-hooks': 'error',
      // Effect dependency completeness is advisory here; keep it off to
      // avoid noise on intentionally-narrow dependency arrays.
      'react-hooks/exhaustive-deps': 'off',
      // Still flags genuinely dead variables/imports, but tolerates the
      // common low-value cases: unused function args and unused catch
      // bindings. Prefix with _ to explicitly mark an intended ignore.
      'no-unused-vars': [
        'error',
        {
          args: 'none',
          caughtErrors: 'none',
          varsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },

  // Renderer code. Electron renderer runs with node integration, so both
  // browser and Node (require) globals are available here.
  {
    files: ['src/renderer/**/*.{js,jsx}', 'src/preload/**/*.js'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  },

  // Main process, build scripts and other Node code. The standalone browser
  // tools under scripts/ are excluded here: flat config *merges* globals
  // rather than overriding them, so without this negation those files would
  // carry both Node and browser globals and a stray Node-only API would lint
  // clean in a file that only ever runs in Chrome.
  {
    files: [
      'src/main/**/*.js',
      'scripts/**/*.js',
      'main.js',
      '*.config.js',
      '*.config.mjs',
    ],
    ignores: ['scripts/midi-probe/**/*.js'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  // Standalone browser tools under scripts/ (opened directly in Chrome, never
  // bundled). Browser globals only — they never run under Node.
  {
    files: ['scripts/midi-probe/**/*.js'],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },

  // Shared code that runs in both contexts (i18n, shared helpers).
  {
    files: ['src/i18n/**/*.js'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  },

  // Tests run under Vitest (jsdom): browser + node + Vitest globals.
  {
    files: ['tests/**/*.{js,jsx}', 'src/**/*.test.{js,jsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node, ...globals.vitest },
    },
  },

  // Last: turns off any stylistic rule that would otherwise fight
  // prettier's formatting (none active above today, but this is the
  // standard guard against a future rule addition reintroducing one).
  eslintConfigPrettier,
];
