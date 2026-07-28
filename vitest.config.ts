import { defineConfig } from "vitest/config";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";

export default defineConfig({
  plugins: [react(), babel({ presets: [reactCompilerPreset()] })],
  test: {
    globals: true,
    environment: "node",
    testTimeout: 30000,
    setupFiles: ["./source/test/setup.ts"],
    exclude: ["**/node_modules/**", "training/repos/**", "dist/**"],
  },
});
