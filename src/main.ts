import { createApp } from "vue";
import "material-symbols/outlined.css";
import "./style.css";
// Configure the @mulmoclaude/collection-plugin UI binding (data fetch, asset URLs,
// nav, confirm, modal teleport) once, before any presentCollection card mounts.
import "./composables/collectionUi";
// Configure the @mulmoclaude/accounting-plugin host seams (apiCall / subscribe /
// locale) once, before any manageAccounting card mounts.
import "./composables/accountingUi";
import { initTheme } from "./composables/useTheme";
import { router } from "./router";
import App from "./App.vue";

// Apply the persisted theme to <html> before mount so there's no flash of the
// default palette.
initTheme();

// Mount only AFTER the router's initial (async) navigation resolves. On a hard
// reload / deep-link to /terminals, mounting eagerly would first render the single
// shell (route still at the start location) — and TerminalView.onMounted would
// attach the durable "single" PTY — before the route flips to the grid, leaking a
// hidden Claude session. router.isReady() guarantees the initial URL is honored first.
const app = createApp(App).use(router);
router.isReady().then(() => app.mount("#app"));
