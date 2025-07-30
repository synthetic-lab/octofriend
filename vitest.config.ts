import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30000,
    exclude: [ "**/node_modules/**", "training/repos/**", "dist/**" ],
  },
});
