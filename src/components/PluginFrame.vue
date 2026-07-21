<script lang="ts">
// Module scope — declared ONCE per module and shared across every PluginFrame
// instance. (If this lived in <script setup> it would be re-created per instance,
// defeating the dedupe and appending a duplicate <style> to document.head for
// every rendered tool result.)
//
// Tailwind v4 registers its --tw-* custom properties (e.g. --tw-border-style:solid,
// without which `border-*` utilities render no border) via `@property`. But
// `@property` at-rules are IGNORED inside a shadow root, and Tailwind disables its
// `@supports` fallback in Chromium — so border/ring/shadow/gradient utilities break
// in the shadow. `@property` is a global, inert registration (it sets no styles,
// only custom-property defaults), so we hoist these rules to the document head once.
// Harmless to MulmoTerminal: its own elements never reference --tw-* properties.
// Plugin Views render their icons with the legacy `material-icons` class (the
// accounting/collection/chart/html packages were authored for MulmoClaude, which
// loads the classic Material Icons font). MulmoTerminal's convention is Material
// Symbols (see main.ts `material-symbols/outlined.css`), and that font's @font-face
// is registered document-globally — but @font-face only delivers the FONT across the
// shadow boundary; the `.material-icons` CLASS rule (font-family + ligature settings)
// does NOT pierce the shadow root, so the spans render their ligature text verbatim
// ("account_balance", "list_alt", …). Inject the class rule into every plugin shadow
// root, aliased to the already-loaded Material Symbols font (the ligature names the
// packages use — account_balance/list/settings/… — all exist in Symbols). Covers
// `.material-symbols-outlined` too for any package already on the new convention.
const MATERIAL_ICONS_SHADOW_CSS = `
.material-icons,
.material-symbols-outlined {
  font-family: "Material Symbols Outlined";
  font-weight: normal;
  font-style: normal;
  line-height: 1;
  letter-spacing: normal;
  text-transform: none;
  display: inline-block;
  white-space: nowrap;
  word-wrap: normal;
  direction: ltr;
  font-feature-settings: "liga";
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
}`;

const injectedProps = new Set<string>();
function hoistAtPropertyRules(css: string | undefined): void {
  if (!css) return;
  const rules = css.match(/@property\s+--[^{]+\{[^}]*\}/g);
  if (!rules) return;
  const blob = rules.join("\n");
  if (injectedProps.has(blob)) return;
  injectedProps.add(blob);
  const style = document.createElement("style");
  style.setAttribute("data-gui-plugin-tw-properties", "");
  style.textContent = blob;
  document.head.appendChild(style);
}
</script>

<script setup lang="ts">
import { ref, onMounted } from "vue";

// Renders a GUI-protocol plugin view inside a Shadow DOM so the plugin's bundled
// CSS is encapsulated BOTH ways:
//   - the plugin's Tailwind preflight (a global element reset) can't leak out and
//     clobber MulmoTerminal's own UI;
//   - MulmoTerminal's global CSS can't leak in and restyle the plugin.
// The plugin's compiled stylesheet (passed as `css`, imported ?inline) is injected
// into the shadow root. Tailwind v4 emits theme vars under `:root, :host`, so they
// resolve against the shadow host and inherit into the tree.
//
// We Teleport the slotted view into the shadow root rather than mounting a separate
// Vue app, so the plugin component stays in the parent app's context (props,
// emits, provide/inject, reactivity all work normally).
// `height` (optional): a fixed frame height for plugin views that rely on an
// internal `h-full` (100%) layout rather than flowing at natural content height —
// e.g. the collection card's table/kanban/custom-view iframe. Mirrors MulmoClaude's
// StackView, which wraps such tools in a fixed-height box. When set, the host
// + shadow mount become that height so the plugin's `h-full` chain resolves; when
// omitted, the frame flows naturally (chart/form/markdown).
const props = defineProps<{ css?: string; height?: string }>();

const hostEl = ref<HTMLDivElement>();
const target = ref<HTMLDivElement | null>(null);

onMounted(() => {
  hoistAtPropertyRules(props.css);
  const host = hostEl.value;
  if (!host) return;
  const shadow = host.attachShadow({ mode: "open" });
  // Icon-font alias FIRST, so the plugin's own CSS (Tailwind size/color utilities on
  // the icon spans) still wins on the properties it sets.
  const iconStyle = document.createElement("style");
  iconStyle.textContent = MATERIAL_ICONS_SHADOW_CSS;
  shadow.appendChild(iconStyle);
  if (props.css) {
    const style = document.createElement("style");
    style.textContent = props.css;
    shadow.appendChild(style);
  }
  // These plugins are authored for MulmoClaude's light surface (e.g. text-gray-900
  // on white). MulmoTerminal's panel is dark, so give the isolated frame a light
  // surface — otherwise the plugin's dark-on-light styling is unreadable. This is
  // the plugin "card" look, matching how it renders in MulmoClaude.
  const mount = document.createElement("div");
  mount.style.background = "#ffffff";
  mount.style.color = "#111827";
  mount.style.borderRadius = "8px";
  mount.style.overflow = "hidden";
  // Carry the fixed height into the shadow so the plugin's internal h-full resolves
  // (the host below is sized to props.height too).
  if (props.height) mount.style.height = "100%";
  shadow.appendChild(mount);
  target.value = mount;
});
</script>

<template>
  <div ref="hostEl" class="block" :style="height ? { height } : undefined">
    <Teleport v-if="target" :to="target">
      <slot />
    </Teleport>
  </div>
</template>
