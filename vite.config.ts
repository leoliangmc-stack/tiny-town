import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // The month-long headless runs take a second here and a good deal
    // longer on a shared CI runner; the default five seconds is too tight.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
