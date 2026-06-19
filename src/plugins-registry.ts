// Frontend plugin registry. Maps a toolResult's toolName -> the Vue viewComponent
// that renders it, from the two sources the server registry / plugins.json describe:
//   - packages: gui-chat-protocol plugin packages whose /vue entry exports a
//       `plugin` carrying a viewComponent. Shared VERBATIM with MulmoClaude.
//   - local:    in-tree plugins under plugins/<name>/index.ts (REGISTRATION export).
// Mirrors MulmoClaude's src/tools/index.ts getPlugin().
import type { Component } from "vue";
import config from "../plugins/plugins.json";
import { plugin as markdownPlugin } from "@mulmoclaude/markdown-plugin/vue";
import { plugin as formPlugin } from "@mulmoclaude/form-plugin/vue";
import { plugin as chartPlugin } from "@mulmoclaude/chart-plugin/vue";
import { plugin as collectionPlugin } from "@mulmoclaude/collection-plugin/vue";
import GenerateImagePlugin from "@mulmochat-plugin/generate-image/vue";
import { wrapWithPluginRuntime } from "./composables/pluginRuntime";
import CollectionCardView from "./components/CollectionCardView.vue";
// Import each package's compiled stylesheet as a STRING (?inline), not as a global
// side-effect. GuiPanel injects it into a per-view Shadow DOM (see PluginFrame),
// which encapsulates the plugin's Tailwind preflight so it can't clobber
// MulmoTerminal's own UI.
import markdownCss from "@mulmoclaude/markdown-plugin/style.css?inline";
import formCss from "@mulmoclaude/form-plugin/style.css?inline";
import chartCss from "@mulmoclaude/chart-plugin/style.css?inline";
import collectionCss from "@mulmoclaude/collection-plugin/style.css?inline";
// The @mulmochat-plugin family (generate-image + its peer ui-image) ships incomplete
// CSS — it assumes a Tailwind host. This is MulmoTerminal's Tailwind layer compiled
// against those packages' dists (see src/plugin-tailwind.css), supplying the
// utilities their components use.
import mulmochatPluginCss from "./plugin-tailwind.css?inline";

// The collection plugin renders ~56 icons via the classic `.material-icons` class
// (plus a few `.material-symbols-outlined`). MulmoTerminal only loads the Material
// Symbols font (main.ts), and in any case the global icon class rule can't pierce
// the plugin's Shadow DOM — so the ligature names ("movie", "search", "arrow_upward")
// render as plain TEXT. The font's `@font-face` IS global (document-level font-faces
// apply inside shadow roots), so we just need the class rule inside the shadow:
// map both icon classes to the loaded "Material Symbols Outlined" font (a superset
// that supports the same ligature names). Prepended BEFORE the plugin's Tailwind so
// the components' `text-sm`/`text-lg` size overrides still win (equal specificity →
// later rule wins); unsized icons fall back to the 24px default here.
const COLLECTION_ICON_CSS = `
.material-icons, .material-symbols-outlined {
  font-family: "Material Symbols Outlined";
  font-weight: normal;
  font-style: normal;
  font-size: 24px;
  line-height: 1;
  letter-spacing: normal;
  text-transform: none;
  display: inline-block;
  white-space: nowrap;
  word-wrap: normal;
  direction: ltr;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
  font-feature-settings: "liga";
}
`;

interface Registration {
  toolName: string;
  viewComponent: Component;
  css?: string;
  // Optional fixed frame height for views that rely on an internal h-full layout
  // (vs flowing at natural content height). See PluginFrame's `height` prop.
  height?: string;
}

// Statically-known packages, keyed by package name; the config gates which load.
// Adding a package is one import + one entry here, until a dynamic (HTTP-bundle)
// loader lands — the packages are npm deps, so Vite bundles them at build time.
const PACKAGES: Record<string, Registration> = {
  "@mulmoclaude/markdown-plugin": {
    toolName: markdownPlugin.toolDefinition.name,
    // The package View uses useRuntime() (dispatch/pubsub/locale/openUrl), so wrap
    // it in MulmoTerminal's runtime provider. scope "markdown" matches the server's
    // file-change forward channel; dispatch targets the presentDocument route.
    viewComponent: wrapWithPluginRuntime("markdown", markdownPlugin.toolDefinition.name, markdownPlugin.viewComponent as unknown as Component),
    css: markdownCss,
  },
  "@mulmoclaude/form-plugin": {
    toolName: formPlugin.toolDefinition.name,
    viewComponent: formPlugin.viewComponent as Component,
    css: formCss,
  },
  "@mulmochat-plugin/generate-image": {
    toolName: GenerateImagePlugin.plugin.toolDefinition.name,
    viewComponent: GenerateImagePlugin.plugin.viewComponent as Component,
    css: mulmochatPluginCss,
  },
  "@mulmoclaude/chart-plugin": {
    toolName: chartPlugin.toolDefinition.name,
    // No runtime wrap: the chart View reads everything from selectedResult.data and
    // only optionally injects the runtime for locale (inject(KEY, undefined)?.locale
    // ?? "en"), so it renders standalone. Its style.css is self-contained Tailwind.
    viewComponent: chartPlugin.viewComponent as Component,
    css: chartCss,
  },
  "@mulmoclaude/collection-plugin": {
    toolName: collectionPlugin.toolDefinition.name,
    // CollectionCardView wraps the package's chat View so it can register its shadow
    // root as the record modal's teleport target (see the component + collectionUi).
    // The binding (data fetch, asset URLs, nav, confirm) is configured once at
    // startup by importing ./composables/collectionUi in main.ts.
    viewComponent: CollectionCardView as Component,
    css: COLLECTION_ICON_CSS + collectionCss,
    // The collection View uses an internal h-full layout (table/kanban scroll
    // areas, and the custom-view iframe has no intrinsic content height). Give it a
    // fixed frame so that chain resolves — matches MulmoClaude's StackView
    // DEFAULT_PLUGIN_HEIGHT.
    height: "min(100vh, 560px)",
  },
};

// Local plugin registrations, keyed by directory name.
const localModules = import.meta.glob<{ REGISTRATION: Registration }>("../plugins/*/index.ts", {
  eager: true,
});

const cfg = config as { packages?: string[]; local?: string[] };
const registry: Record<string, Registration> = {};

for (const name of cfg.packages ?? []) {
  const entry = PACKAGES[name];
  if (entry) registry[entry.toolName] = entry;
}

const localEnabled = new Set(cfg.local ?? []);
for (const [modulePath, mod] of Object.entries(localModules)) {
  // ".../plugins/<name>/index.ts" -> "<name>"
  const name = modulePath.split("/").slice(-2)[0];
  if (!localEnabled.has(name)) continue;
  registry[mod.REGISTRATION.toolName] = mod.REGISTRATION;
}

export function getPlugin(toolName: string): Registration | undefined {
  return registry[toolName];
}
