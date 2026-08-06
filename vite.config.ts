/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the build works from any path (GitHub Pages project sites included).
  base: './',
  build: {
    // Safari 14, which is iOS 14. three.js ships class static blocks, which
    // need iOS 16.4 to parse: on anything older the 3D chunk failed to load
    // with a syntax error, and that is not a failure the app can recover from
    // gracefully. Down-levelling costs a few bytes and buys two years of
    // phones.
    target: 'es2020',
    outDir: 'dist',
    sourcemap: true,
  },
  test: {
    environment: 'node',
    // `bench/` is deliberately outside this: a sweep runs the physics for tens
    // of minutes, which is not something `npm test` should ever do.
    include: ['tests/**/*.test.ts'],
    // The suite runs real physics; CI runners are slower and more variable
    // than a dev machine. Generous enough to absorb that, short enough that a
    // genuinely hung test still fails quickly.
    testTimeout: 15_000,
  },
});
