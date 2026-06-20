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
    // Disable Vite's dev CORS middleware. The app is same-origin in dev (the page
    // and the proxied `/api` both live on :5173), so it needs no CORS headers from
    // Vite. The one cross-origin consumer is a custom collection view: it renders in
    // a sandboxed (opaque-origin) iframe whose fetch to
    // `/api/collections/:slug/view-data` is cross-origin and preflighted. With Vite's
    // CORS enabled, Vite answers that OPTIONS itself WITHOUT an
    // `Access-Control-Allow-Origin` (it rejects the "null" origin) and the preflight
    // fails before reaching the backend. Disabling it lets the preflight (and the
    // request) flow through the proxy to Express, which sets the correct CORS headers
    // (viewDataCors in server/backends/collections.ts). Production has no Vite proxy
    // — the iframe hits Express directly — so this is dev-only. Matches MulmoClaude.
    cors: false,
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
        changeOrigin: true,
      },
      // presentHtml page serving (the View's iframe src). Without this, the dev
      // Vite catch-all returns index.html instead of the HTML artifact.
      "/artifacts": {
        target: "http://localhost:3456",
        changeOrigin: true,
      },
    },
  },
});
