import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      // Resolve the workspace contracts package to its TypeScript source so the
      // test suite does not depend on contracts/dist being built first in CI.
      // PR #29 wired ethics/service.ts to @extropy/contracts security helpers,
      // which pulled contracts into the test import graph. Without this alias
      // Vite fails with "Failed to resolve entry for package @extropy/contracts"
      // because contracts/dist is absent on a clean CI checkout.
      '@extropy/contracts': fileURLToPath(
        new URL('../contracts/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],
    coverage: {
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/__tests__/**'],
    },
  },
});
