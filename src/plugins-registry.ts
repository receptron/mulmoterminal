// Frontend plugin registry. Maps a toolResult's toolName -> the Vue viewComponent
// that renders it, from the two sources the server registry / plugins.json describe:
//   - packages: gui-chat-protocol plugin packages whose /vue entry exports a
//       `plugin` carrying a viewComponent. Shared VERBATIM with MulmoClaude.
//   - local:    in-tree plugins under plugins/<name>/index.ts (REGISTRATION export).
// Mirrors MulmoClaude's src/tools/index.ts getPlugin().
import { defineComponent, h, markRaw, provide, type Component } from "vue";
import config from "../plugins/plugins.json";
import { plugin as markdownPlugin } from "@mulmoclaude/markdown-plugin/vue";
import { plugin as formPlugin } from "@mulmoclaude/form-plugin/vue";
import { plugin as chartPlugin } from "@mulmoclaude/chart-plugin/vue";
import { plugin as collectionPlugin } from "@mulmoclaude/collection-plugin/vue";
import { plugin as htmlPlugin } from "@mulmoclaude/html-plugin/vue";
import GenerateImagePlugin from "@mulmochat-plugin/generate-image/vue";
import { plugin as mulmoScriptPlugin, MULMOSCRIPT_HOST_ADAPTER_KEY, type MulmoScriptHostAdapter } from "@mulmoclaude/mulmoscript-plugin/vue";
import { AccountingView } from "@mulmoclaude/accounting-plugin/vue";
import { wrapWithPluginRuntime } from "./composables/pluginRuntime";
import CollectionCardView from "./components/CollectionCardView.vue";
import { documentIdentity, filePathIdentity, collectionIdentity } from "./utils/canvasIdentity";
import { CANVAS_CARD_HEIGHT_VAR } from "./composables/useCanvasCardHeight";
// Import each package's compiled stylesheet as a STRING (?inline), not as a global
// side-effect. GuiPanel injects it into a per-view Shadow DOM (see PluginFrame),
// which encapsulates the plugin's Tailwind preflight so it can't clobber
// MulmoTerminal's own UI.
import markdownCss from "@mulmoclaude/markdown-plugin/style.css?inline";
import formCss from "@mulmoclaude/form-plugin/style.css?inline";
import chartCss from "@mulmoclaude/chart-plugin/style.css?inline";
import htmlCss from "@mulmoclaude/html-plugin/style.css?inline";
import mulmoScriptCss from "@mulmoclaude/mulmoscript-plugin/style.css?inline";
import { collectionShadowCss } from "./collectionShadowCss";
// The accounting package ships its own self-contained Tailwind in style.css (its
// content scan can't reach node_modules), imported as a STRING for shadow-DOM
// injection — same treatment as chart/markdown.
import accountingCss from "@mulmoclaude/accounting-plugin/style.css?inline";
// The @mulmochat-plugin family (generate-image + its peer ui-image) ships incomplete
// CSS — it assumes a Tailwind host. This is MulmoTerminal's Tailwind layer compiled
// against those packages' dists (see src/plugin-tailwind.css), supplying the
// utilities their components use.
import mulmochatPluginCss from "./plugin-tailwind.css?inline";

// Movie/PDF bytes for the mulmoscript View's download / clip-play UI. A plain
// <video src> can't ride the dispatch envelope, so the package asks the host for
// bytes via this adapter capability; the server route realpath-contains the wire
// path (see server/backends/mulmoscript.ts).
async function fetchMulmoMediaBlob(query: { moviePath?: string; pdfPath?: string }): Promise<Blob> {
  const params = new URLSearchParams(query.pdfPath ? { pdfPath: query.pdfPath } : { moviePath: query.moviePath ?? "" });
  const res = await fetch(`/api/mulmoscript/media?${params}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.blob();
}

// Provide the mulmoscript package's host-adapter injection around its View.
// MulmoTerminal has no per-session generation indicator, so only fetchMediaBlob
// is supplied; chatSessionId degrades gracefully (no session tagging).
function withMulmoScriptHostAdapter(inner: Component): Component {
  const adapter: MulmoScriptHostAdapter = { fetchMediaBlob: fetchMulmoMediaBlob };
  return markRaw(
    defineComponent({
      name: "MulmoScriptHostAdapter",
      inheritAttrs: false,
      setup(_props, { attrs, slots }) {
        provide(MULMOSCRIPT_HOST_ADAPTER_KEY, adapter);
        return () => h(inner, attrs, slots);
      },
    }),
  );
}

// gui-chat-protocol types `viewComponent` as OPTIONAL (vue.d.ts) — a plugin may ship a tool with
// no Vue view at all. Every package registered below is one whose view is the whole reason it is
// registered, so a missing one is a packaging error, and this says which package rather than
// storing `undefined` and leaving the Canvas holding a tool it cannot draw.
//
// DELIBERATE DIVERGENCE from MulmoClaude, which treats an absent view as normal: it declares the
// field optional in its own runtimeLoader and guards at the render site (`v-if="...?.viewComponent"`).
// It has to — it loads plugins the USER installed at runtime, so a view-less one is a condition, not
// a defect. Here the packages are pinned npm deps that Vite bundles at build time, so absence cannot
// vary per user, and GuiPanel renders them through `getPlugin(...)!` without a guard. Failing at
// registration with the package name beats crashing later inside a template.
function viewOf(packageName: string, viewComponent: Component | undefined): Component {
  if (!viewComponent) throw new Error(`${packageName} ships no viewComponent, so the Canvas cannot render its results`);
  return viewComponent;
}

// The frame height for cards whose View relies on an internal h-full (100%) layout rather
// than flowing at natural content height. Resolves against the panel's MEASURED height:
// useCanvasCardHeight publishes it on the Canvas scroll container, and custom properties
// inherit through the plugin Shadow DOM, so the View's own h-full chain lands on the same
// number. The 80vh fallback is what these cards used before the measurement existed — it
// applies only if a card is rendered outside that container.
const CANVAS_CARD_HEIGHT = `var(${CANVAS_CARD_HEIGHT_VAR}, 80vh)`;

interface Registration {
  toolName: string;
  viewComponent: Component;
  css?: string;
  /**
   * What makes two results of this tool the SAME THING, so the Canvas shows only the newest —
   * see src/utils/canvasCollapse.ts. Return null for a result that must stand alone (inline
   * content with no backing file, an unrecognised shape); a tool that omits this never collapses,
   * which is what every tool did before this existed.
   *
   * The value is namespaced by toolName at the call site, so two plugins may return the same
   * string without colliding.
   */
  identityOf?: (result: unknown) => string | null;
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
    viewComponent: wrapWithPluginRuntime("markdown", markdownPlugin.toolDefinition.name, viewOf("@mulmoclaude/markdown-plugin", markdownPlugin.viewComponent)),
    css: markdownCss,
    // Fixed frame height instead of flowing at natural content height, so a long
    // document scrolls inside its card rather than pushing the rest of the Canvas
    // down. DIVERGES from MulmoClaude, where presentDocument is in StackView's
    // STACK_NATURAL_TOOLS allowlist and flows.
    height: CANVAS_CARD_HEIGHT,
    // Re-presenting one document supersedes the card showing its older state; inline markdown has
    // no path and stands alone. See canvasIdentity.ts.
    identityOf: documentIdentity,
  },
  "@mulmoclaude/form-plugin": {
    toolName: formPlugin.toolDefinition.name,
    viewComponent: viewOf("@mulmoclaude/form-plugin", formPlugin.viewComponent),
    css: formCss,
  },
  "@mulmoclaude/html-plugin": {
    toolName: htmlPlugin.toolDefinition.name,
    // The presentHtml View uses useRuntime() (dispatch for loadHtml/saveHtml, pubsub
    // for live-refresh). scope "html" matches the server's file-change channel
    // (plugin:html:file:<path>); dispatch targets /api/plugin/presentHtml, where the
    // server intercepts loadHtml/saveHtml (see server/backends/html.ts).
    viewComponent: wrapWithPluginRuntime("html", htmlPlugin.toolDefinition.name, viewOf("@mulmoclaude/html-plugin", htmlPlugin.viewComponent)),
    css: htmlCss,
    // The View renders an h-full iframe; give it a definite frame height (like the
    // collection card) so the page renders, with internal scroll.
    height: CANVAS_CARD_HEIGHT,
    // The page on disk, so only re-presenting the SAME page collapses. See canvasIdentity.ts.
    identityOf: filePathIdentity,
  },
  "@mulmochat-plugin/generate-image": {
    toolName: GenerateImagePlugin.plugin.toolDefinition.name,
    viewComponent: viewOf("@mulmochat-plugin/generate-image", GenerateImagePlugin.plugin.viewComponent),
    css: mulmochatPluginCss,
  },
  "@mulmoclaude/chart-plugin": {
    toolName: chartPlugin.toolDefinition.name,
    // No runtime wrap: the chart View reads everything from selectedResult.data and
    // only optionally injects the runtime for locale (inject(KEY, undefined)?.locale
    // ?? "en"), so it renders standalone. Its style.css is self-contained Tailwind.
    viewComponent: viewOf("@mulmoclaude/chart-plugin", chartPlugin.viewComponent),
    css: chartCss,
  },
  "@mulmoclaude/mulmoscript-plugin": {
    toolName: mulmoScriptPlugin.toolDefinition.name,
    // The storyboard View uses useRuntime() (dispatch kind router + generation
    // pubsub). scope "mulmoScript" matches the server's generation channel
    // (plugin:mulmoScript:generation); dispatch targets /api/plugin/
    // presentMulmoScript, where server/backends/mulmoscript.ts routes by kind.
    // The host adapter supplies authenticated-media fetch (movie/PDF bytes).
    viewComponent: wrapWithPluginRuntime(
      "mulmoScript",
      mulmoScriptPlugin.toolDefinition.name,
      withMulmoScriptHostAdapter(viewOf("@mulmoclaude/mulmoscript-plugin", mulmoScriptPlugin.viewComponent)),
    ),
    css: mulmoScriptCss,
    // Full storyboard editor with an internal h-full layout — give it a definite
    // frame height (like the collection/html cards) so that chain resolves.
    height: CANVAS_CARD_HEIGHT,
    // The story on disk (`stories/<name>.json`), so this collapses re-opens of ONE story rather
    // than distinct stories. See canvasIdentity.ts.
    identityOf: filePathIdentity,
  },
  // Keyed by the plugins.json `packages` entry (the cfg.packages loop below looks up
  // PACKAGES[name]). The collection engine + presentCollection tool moved to
  // @mulmoclaude/core/collection, so the server loads it from there and plugins.json
  // names it there — this key MUST match, or the loop skips it and the browser has no
  // renderer for presentCollection. The Vue `plugin` itself still ships in
  // @mulmoclaude/collection-plugin/vue (imported above).
  "@mulmoclaude/core/collection": {
    toolName: collectionPlugin.toolDefinition.name,
    // CollectionCardView wraps the package's chat View so it can register its shadow
    // root as the record modal's teleport target (see the component + collectionUi).
    // The binding (data fetch, asset URLs, nav, confirm) is configured once at
    // startup by importing ./composables/collectionUi in main.ts.
    viewComponent: CollectionCardView,
    css: collectionShadowCss,
    // The collection View uses an internal h-full layout (table/kanban scroll
    // areas, and the custom-view iframe has no intrinsic content height). Give it a
    // fixed frame so that chain resolves. MulmoClaude frames this card too, but at its
    // own DEFAULT_PLUGIN_HEIGHT of min(60vh, 560px) — ours is the panel's measured
    // height, chosen here (#50) so the card fills the pane rather than a fraction of it.
    height: CANVAS_CARD_HEIGHT,
    // The collection, by slug alone — NOT slug+itemId, and the same key reconcileCollectionCard
    // uses. See canvasIdentity.ts for both decisions.
    identityOf: collectionIdentity,
  },
};

// Local plugin registrations, keyed by directory name.
const localModules = import.meta.glob<{ REGISTRATION: Registration }>("../plugins/*/index.ts", {
  eager: true,
});

const cfg: { packages?: string[]; local?: string[] } = config;
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

// Accounting is a HOST TOOL, not a plugins.json package: the package exposes only the
// Vue View + the /api/accounting router (no gui-chat-protocol `.` core to load), and
// the server always registers manageAccounting (see server/host-tools.ts). So its View
// registers unconditionally here rather than through the cfg.packages gate above. The
// View needs no runtime wrap — it reads selectedResult.data directly and reaches the
// host via its own configureAccountingHost DI (see composables/accountingUi.ts).
registry["manageAccounting"] = {
  toolName: "manageAccounting",
  viewComponent: AccountingView,
  css: accountingCss,
  // Full canvas app with an internal h-full layout — give it a fixed frame height
  // (like the collection/html cards) so that chain resolves.
  height: CANVAS_CARD_HEIGHT,
};

export function getPlugin(toolName: string): Registration | undefined {
  return registry[toolName];
}
