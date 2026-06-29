import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";

// Dev ports. The backend (Express) listens on PORT (default 34567, see
// server/index.ts); Vite's own dev server uses CLIENT_PORT — a SEPARATE port, since
// both run at once under `yarn dev` and can't share one. Both are env-overridable.
const BACKEND_PORT = process.env.PORT || "34567";
const CLIENT_PORT = Number(process.env.CLIENT_PORT) || 6856;

export default defineConfig({
  // Tailwind is used ONLY to compile the plugin-utilities sheet
  // (src/plugin-tailwind.css), which GuiPanel injects into the per-plugin Shadow
  // DOM. MulmoTerminal's own UI is not Tailwind; nothing here imports the sheet as
  // a global side-effect, so the app's styles are untouched.
  plugins: [vue(), tailwindcss()],
  // vue-i18n (pulled in by accounting/collection plugin Views) breaks Vite's esbuild
  // dep pre-bundling: the optimized vue-i18n chunk calls Vue runtime init wrappers
  // (init_runtime_dom_esm_bundler / init_shared_esm_bundler) it never imports across
  // the chunk boundary -> "ReferenceError: init_runtime_dom_esm_bundler is not
  // defined" at runtime. Exclude it from pre-bundling so it's served as ESM source
  // (no esbuild split), and define the @intlify compile-time feature flags the
  // esm-bundler build expects (Vite's vue plugin only defines the __VUE_*__ flags).
  optimizeDeps: { exclude: ["vue-i18n"] },
  define: {
    __VUE_I18N_FULL_INSTALL__: "true",
    __VUE_I18N_LEGACY_API__: "false",
    __INTLIFY_JIT_COMPILATION__: "false",
    __INTLIFY_DROP_MESSAGE_COMPILER__: "false",
    __INTLIFY_PROD_DEVTOOLS__: "false",
  },
  server: {
    port: CLIENT_PORT,
    // Disable Vite's dev CORS middleware. The app is same-origin in dev (the page
    // and the proxied `/api` both live on the Vite dev port), so it needs no CORS headers from
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
        target: `ws://localhost:${BACKEND_PORT}`,
        ws: true,
      },
      "/ws": {
        target: `ws://localhost:${BACKEND_PORT}`,
        ws: true,
      },
      "/api": {
        target: `http://localhost:${BACKEND_PORT}`,
        changeOrigin: true,
      },
      // presentHtml page serving (the View's iframe src). Without this, the dev
      // Vite catch-all returns index.html instead of the HTML artifact.
      "/artifacts": {
        target: `http://localhost:${BACKEND_PORT}`,
        changeOrigin: true,
      },
    },
  },
});
