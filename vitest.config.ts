import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: ['babel-plugin-react-compiler'],
      },
    }),
  ],
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30000,
    setupFiles: [ "./source/test/setup.ts" ],
    exclude: [ "**/node_modules/**", "training/repos/**", "dist/**" ],
  },
});
