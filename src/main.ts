import { createApp } from "vue";
import "material-symbols/outlined.css";
import "./style.css";
// Configure the @mulmoclaude/collection-plugin UI binding (data fetch, asset URLs,
// nav, confirm, modal teleport) once, before any presentCollection card mounts.
import "./composables/collectionUi";
import { initTheme } from "./composables/useTheme";
import App from "./App.vue";

// Apply the persisted theme to <html> before mount so there's no flash of the
// default palette.
initTheme();

createApp(App).mount("#app");
