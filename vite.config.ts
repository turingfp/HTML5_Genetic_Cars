/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the build works from any path (GitHub Pages project sites included).
  base: './',
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: true,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // The suite runs real physics; CI runners are slower and more variable
    // than a dev machine. Generous enough to absorb that, short enough that a
    // genuinely hung test still fails quickly.
    testTimeout: 15_000,
  },
});
