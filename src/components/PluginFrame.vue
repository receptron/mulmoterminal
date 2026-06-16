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
const props = defineProps<{ css?: string }>();

const hostEl = ref<HTMLDivElement>();
const target = ref<HTMLDivElement | null>(null);

onMounted(() => {
  hoistAtPropertyRules(props.css);
  const shadow = hostEl.value!.attachShadow({ mode: "open" });
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
  shadow.appendChild(mount);
  target.value = mount;
});
</script>

<template>
  <div ref="hostEl" class="plugin-frame-host">
    <Teleport v-if="target" :to="target">
      <slot />
    </Teleport>
  </div>
</template>

<style scoped>
.plugin-frame-host {
  display: block;
}
</style>
