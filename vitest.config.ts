import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: "jsdom",
    include: ["src/**/*.spec.ts", "test/**/*.spec.ts", "server/**/*.spec.ts", "bin/**/*.spec.ts"],
    // The suite runs files in parallel across all cores. On a machine also running a build
    // (a dev's `yarn build` alongside `yarn test`) the cores are oversubscribed, so an
    // I/O- or mount-heavy test that finishes in milliseconds when idle can cross vitest's
    // 5s default and flake — the victim is whichever test is running at peak load, not any
    // one test. CI never hits this (it doesn't build and test at once). A roomier baseline
    // absorbs the load spike without slowing the normal case (passing tests still finish in
    // ms) or masking a real hang (that still trips this ceiling).
    testTimeout: 15_000,
  },
});
