import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  server: {
    proxy: {
      "/ws": {
        target: "ws://localhost:3456",
        ws: true,
      },
      "/api": {
        target: "http://localhost:3456",
      },
    },
  },
});
