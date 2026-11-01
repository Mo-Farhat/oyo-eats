import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    dir: 'src',
    // Integration tests talk to the remote dev database; round trips add up.
    testTimeout: 30_000,
  },
});
