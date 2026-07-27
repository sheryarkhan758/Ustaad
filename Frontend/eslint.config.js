import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.serviceworker },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: { react: { version: '18.3' } },
    plugins: { react, 'react-hooks': reactHooks },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      // The new JSX transform makes the React import unnecessary.
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // These run in Node, not the browser.
    files: [
      'scripts/**/*.mjs',
      'vite.config.js',
      'vitest.config.js',
      'postcss.config.js',
      'tailwind.config.js',
    ],
    languageOptions: { globals: globals.node },
  },
  {
    // Tests run under vitest in Node, so a few of them read a source file off
    // disk to assert on its shape — the only way to test that a component has
    // *no* branch for a case (see profile.test.jsx, SEC-9).
    files: ['**/*.test.{js,jsx}', 'src/test-setup.js'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
];
