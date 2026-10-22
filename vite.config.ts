import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base so the built site works from a GitHub Pages sub-path.
  base: './',
  worker: { format: 'es' },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
