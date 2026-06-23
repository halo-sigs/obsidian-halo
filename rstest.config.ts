import { defineConfig } from "@rstest/core";

export default defineConfig({
  globals: false,
  testEnvironment: "node",
  setupFiles: ["./tests/setup.ts"],
  include: ["tests/**/*.test.ts"],
  coverage: {
    include: ["src/**/*.ts"],
    exclude: ["tests/**", "src/i18n/locales/**"],
    reporters: ["text", "html"],
  },
});
