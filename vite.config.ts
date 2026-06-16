import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  // Tailwind is used ONLY to compile the plugin-utilities sheet
  // (src/plugin-tailwind.css), which GuiPanel injects into the per-plugin Shadow
  // DOM. MulmoTerminal's own UI is not Tailwind; nothing here imports the sheet as
  // a global side-effect, so the app's styles are untouched.
  plugins: [vue(), tailwindcss()],
  server: {
    proxy: {
      // socket.io pub/sub (sidebar activity). Must precede the "/ws" rule.
      "/ws/pubsub": {
        target: "ws://localhost:3456",
        ws: true,
      },
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
