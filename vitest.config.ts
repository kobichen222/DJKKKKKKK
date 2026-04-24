import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Playwright owns src/e2e — skip those here so vitest doesn't try to
    // run browser tests in Node.
    exclude: ['node_modules', 'dist', 'src/e2e/**'],
    environment: 'node',
    globals: false,
    reporters: ['default'],
    testTimeout: 10000,
  },
});
