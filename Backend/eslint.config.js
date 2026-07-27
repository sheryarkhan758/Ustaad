import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules/**', 'dist/**', 'client/**', 'server/db/migrations/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['server/**/*.ts', 'shared/**/*.ts', 'scripts/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-restricted-syntax': [
        'error',
        {
          // CLAUDE.md §2.1 — no hand-written SQL in route handlers.
          selector: "TaggedTemplateExpression[tag.name='sql']",
          message:
            'Raw SQL template literals are not permitted. Use the Drizzle query builder, or isolate the query in server/db/queries/ with a comment explaining why (CLAUDE.md 2.1).',
        },
        {
          // server/db/PORTABILITY.md rule 4 — no RETURNING-clause assumptions.
          selector: "CallExpression[callee.property.name='returning']",
          message:
            'Do not call .returning(); its guarantees differ between SQLite and Postgres. Ids are generated in application code, so insert with a known id and select it back (PORTABILITY.md rule 4).',
        },
        {
          // server/db/PORTABILITY.md rule 6 — driver-only synchronous calls.
          selector:
            "CallExpression[callee.property.name=/^(all|get|run)$/][arguments.length=0]",
          message:
            '.all(), .get() and .run() exist only on the better-sqlite3 driver. Await the query builder instead (PORTABILITY.md rule 6).',
        },
      ],
    },
  },
  {
    // The sanctioned home for a raw fragment, named in the rule message above.
    // Each function there carries a comment stating why it cannot be expressed
    // in the query builder and why it is safe to port.
    files: ['server/db/queries/**/*.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
);
