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
import App from "./App.vue";

// Apply the persisted theme to <html> before mount so there's no flash of the
// default palette.
initTheme();

createApp(App).mount("#app");
