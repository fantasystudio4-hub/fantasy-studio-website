/* ESLint for a no-build static site. Rules are chosen to catch BUGS (undefined
   names, unreachable code, duplicate keys, promises that are never handled),
   not to restyle 46k lines of working code. Inline <script> blocks in the HTML
   pages are linted through eslint-plugin-html. */
'use strict';
const js = require('@eslint/js');
const globals = require('globals');
const html = require('eslint-plugin-html');

/* Names that catalog.js defines with `var` and the home page / builder use */
const CATALOG = {};
for (const name of require('fs')
  .readFileSync(__dirname + '/catalog.js', 'utf8')
  .matchAll(/^(?:var|function|async function)\s+([A-Za-z_$][\w$]*)/gm))
  CATALOG[name[1]] = 'writable';

module.exports = [
  {
    ignores: [
      'node_modules/**',
      '_cptest.html',
      '**/_preview-*.html',
      'app/**',
      '.claude/**',
    ] /* .claude/worktrees holds other checkouts of this repo */,
  },
  js.configs.recommended,
  {
    files: ['**/*.js', '**/*.html'],
    plugins: { html },
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        FIREBASE_CONFIG: 'readonly',
        Capacitor: 'readonly',
        FSApp: 'readonly',
        grecaptcha: 'readonly',
      } /* FSApp: app-shell.js sets window.FSApp; grecaptcha: Google's script */,
    },
    rules: {
      'no-unused-vars': [
        'warn',
        { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-inner-declarations': 'off',
      'no-useless-escape': 'off',
      'no-prototype-builtins': 'off',
      'no-cond-assign': ['error', 'except-parens'],
      'no-control-regex': 'off' /* the site strips control characters on purpose (catalog.js cleanEventType) */,
    },
  },
  {
    files: ['**/*.html', 'admin/**/*.js', 'fs-auth.js', 'fs-shared.js', 'app-shell.js', 'avail.js'],
    languageOptions: { sourceType: 'module' },
  },
  { files: ['index.html', 'builder/index.html'], languageOptions: { globals: CATALOG } },
  /* catalog.js only DEFINES its top-level names; index.html and builder use them */
  {
    files: ['catalog.js'],
    rules: { 'no-unused-vars': ['warn', { vars: 'local', args: 'none', caughtErrors: 'none' }] },
  },
  { files: ['sw.js'], languageOptions: { globals: globals.serviceworker } },
  {
    files: ['eslint.config.js', 'tests/**/*.js'],
    languageOptions: { sourceType: 'commonjs', globals: globals.node },
  },
];
