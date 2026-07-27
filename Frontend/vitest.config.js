import path from 'node:path';

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The suite runs in jsdom because every test here is about what a *browser*
 * does with the markup: which direction it lays text out in, whether it escapes
 * markup, what a screen reader would be handed. None of that is observable
 * without a DOM.
 */
export default defineConfig({
  plugins: [react()],

  // The same alias the application build uses, so a test validates against the
  // identical schema object the server does — not a lookalike.
  resolve: {
    alias: { '@shared': path.resolve(__dirname, '../Backend/shared') },
  },

  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/test-setup.js'],
    include: ['src/**/*.test.{js,jsx}'],
  },
});
