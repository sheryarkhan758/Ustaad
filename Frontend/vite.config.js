import path from 'node:path';

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Vite configuration.
 *
 * ── The proxy is not a convenience ─────────────────────────────────────────
 * The session is carried by an httpOnly cookie and nothing else (§2.11 of the
 * backend's CLAUDE.md). A cookie set by `localhost:3000` is not sent by a page
 * served from `localhost:5173` unless every request is same-origin, so
 * developing against a cross-origin API would mean either weakening the cookie
 * or never being logged in. Proxying `/api` makes development same-origin,
 * which is also what production is — the Netlify redirect puts the API on the
 * same host.
 *
 * ── No VITE_ secret, ever ──────────────────────────────────────────────────
 * Vite inlines anything prefixed `VITE_` into the bundle by design. There is
 * therefore no `VITE_GEMINI_API_KEY`, no `VITE_SUPABASE_SERVICE_ROLE_KEY`, and
 * no database URL anywhere in this project. The backend's
 * `npm run scan:bundle` greps the built output for the *value* of every secret
 * and fails the build on a hit.
 */
export default defineConfig({
  plugins: [react()],

  resolve: {
    alias: {
      /**
       * The **same** Zod schemas the server validates with — §4, NFR-6/NFR-7.
       *
       * `Backend/shared/` is the single definition of what a registration or a
       * login may contain. Importing it rather than copying it is the only way
       * "the client validates identically to the server" can stay true: a copy
       * is a second definition, and the two drift the first time somebody
       * changes a minimum length on one side.
       *
       * The client copy is still never trusted. It exists so a person is told
       * about a problem before they submit; the server remains the gate.
       */
      '@shared': path.resolve(__dirname, '../Backend/shared'),
    },
  },

  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.API_ORIGIN ?? 'http://localhost:3000',
        changeOrigin: false, // same-origin cookies depend on this staying false
      },
    },
  },

  // The alias reaches outside this package root, so Vite has to be told the
  // directory is allowed to be served in development.
  optimizeDeps: { include: ['zod'] },

  build: {
    outDir: 'dist',
    // The audience is on mid-range Android over patchy connections. A source
    // map quadruples what a first visit downloads, and this bundle has nothing
    // worth hiding — but the bytes matter.
    sourcemap: false,
    target: 'es2020',
    rollupOptions: {
      output: {
        /**
         * Split the vendor bundle so a release that touches only application
         * code does not invalidate React and the router in every cache. On a
         * slow connection, the difference between re-downloading 140 kB and
         * re-downloading 15 kB is the difference between usable and not.
         */
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          query: ['@tanstack/react-query'],
          i18n: ['i18next', 'react-i18next'],
        },
      },
    },
  },
});
