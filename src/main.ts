import { createApp } from "vue";
import "material-symbols/outlined.css";
import "./style.css";
// Configure the @mulmoclaude/collection-plugin UI binding (data fetch, asset URLs,
// nav, confirm, modal teleport) once, before any presentCollection card mounts.
import "./composables/collectionUi";
import App from "./App.vue";

createApp(App).mount("#app");
