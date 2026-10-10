import { createApp } from "vue";
import "./style.css";
import "./tailwind.css";
// Configure the @mulmoclaude/collection-plugin UI binding (data fetch, asset URLs,
// nav, confirm, modal teleport) once, before any presentCollection card mounts.
import "./composables/collectionUi";
// Configure the @mulmoclaude/accounting-plugin host seams (apiCall / subscribe /
// locale) once, before any manageAccounting card mounts.
import "./composables/accountingUi";
import { initTheme } from "./composables/useTheme";
import { installFileDropGuard } from "./composables/useFileDropGuard";
import { installPageZoomGuard } from "./composables/usePageZoomGuard";
import { router } from "./router";
import { i18n } from "./i18n";
import { installMarkdownCodeCopy } from "./appMarked";
import { enableManifoldCsg } from "@gui-chat-plugin/shapescript";
import App from "./App.vue";

// Apply the persisted theme to <html> before mount so there's no flash of the
// default palette.
initTheme();

// Catch a file dropped anywhere in the tab so an imprecise drop can't navigate the
// page to the file and lose every session. Installed on window, before mount, so it
// covers both views and any area between them.
installFileDropGuard();

// A ctrl+wheel or trackpad pinch anywhere in the tab would page-zoom the browser, moving the
// layout and xterm's fit out from under the user. Same window-level shape as the drop guard;
// keyboard zoom stays available for anyone who wants it on purpose.
installPageZoomGuard();

// The copy button on every code block in rendered markdown copies through one listener on the
// document, which checks the button's nonce before writing anything to the clipboard.
installMarkdownCodeCopy(document);

// Mount only AFTER the router's initial (async) navigation resolves. On a hard
// reload / deep-link to /terminals, mounting eagerly would first render the single
// shell (route still at the start location) — and TerminalView.onMounted would
// attach the durable "single" PTY — before the route flips to the grid, leaking a
// hidden Claude session. router.isReady() guarantees the initial URL is honored first.
//
// ShapeScript's CSG runs through manifold here as on the server
// (server/infra/tools/shapescript-csg.ts), so a model is built by one engine wherever it
// is shown. Its WebAssembly is loaded before mount, because the View converts
// synchronously the moment a card renders; a failed load leaves three-bvh-csg in
// place and never holds the app back.
const manifoldReady = enableManifoldCsg().catch((err: unknown) => {
  console.warn(`[shapescript] manifold did not load, CSG stays on three-bvh-csg: ${err instanceof Error ? err.message : String(err)}`);
});
const app = createApp(App).use(router).use(i18n);
void Promise.all([router.isReady(), manifoldReady]).then(() => app.mount("#app"));
