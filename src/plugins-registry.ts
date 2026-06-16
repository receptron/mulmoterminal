// Frontend plugin registry. Maps a toolResult's toolName -> the Vue viewComponent
// that renders it, from the two sources the server registry / plugins.json describe:
//   - packages: gui-chat-protocol plugin packages whose /vue entry exports a
//       `plugin` carrying a viewComponent. Shared VERBATIM with MulmoClaude.
//   - local:    in-tree plugins under plugins/<name>/index.ts (REGISTRATION export).
// Mirrors MulmoClaude's src/tools/index.ts getPlugin().
import type { Component } from "vue";
import config from "../plugins/plugins.json";
import { plugin as markdownPlugin } from "@gui-chat-plugin/markdown/vue";

interface Registration {
  toolName: string;
  viewComponent: Component;
}

// Statically-known packages, keyed by package name; the config gates which load.
// Adding a package is one import + one entry here, until a dynamic (HTTP-bundle)
// loader lands — the packages are npm deps, so Vite bundles them at build time.
const PACKAGES: Record<string, Registration> = {
  "@gui-chat-plugin/markdown": {
    toolName: markdownPlugin.toolDefinition.name,
    viewComponent: markdownPlugin.viewComponent as Component,
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
