import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: "jsdom",
    include: [
      "src/**/*.spec.ts",
      "test/**/*.spec.ts",
      "server/**/*.spec.ts",
      "bin/**/*.spec.ts",
    ],
  },
});
