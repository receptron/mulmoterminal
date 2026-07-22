// Which plugin actually answers a tool name, when more than one claims it.
//
// Two names can collide, and until now both collisions were silent AND inconsistent: the
// dispatch map is built with Object.fromEntries, so the LAST plugin to claim a name wins it,
// while the advertised tool list carried every claimant. A built-in host tool wins outright
// over any plugin, because its route is mounted before the plugin catch-all — but the
// plugin's definition was advertised all the same.
//
// The result is a tool list that can describe one implementation while another runs. A
// package can take a host tool's name and be listed under it; a plugin author can watch
// their tool be offered and never called. Resolving both here means the list is built from
// the same answer the dispatch is (#611 A2).

export interface ToolNameCollision {
  name: string;
  /** Who keeps the name: a built-in host tool, or the last plugin to declare it. */
  shadowedBy: "host" | "plugin";
}

export function resolvePluginTools<T>(
  plugins: readonly T[],
  nameOf: (plugin: T) => string,
  hostToolNames: readonly string[],
): { dispatched: T[]; collisions: ToolNameCollision[] } {
  const hosts = new Set(hostToolNames);
  // Last claimant wins, which is what the dispatch map already does.
  const winner = new Map<string, number>();
  plugins.forEach((plugin, index) => winner.set(nameOf(plugin), index));

  const collisions: ToolNameCollision[] = [];
  const dispatched: T[] = [];
  plugins.forEach((plugin, index) => {
    const name = nameOf(plugin);
    if (hosts.has(name)) {
      collisions.push({ name, shadowedBy: "host" });
    } else if (winner.get(name) !== index) {
      collisions.push({ name, shadowedBy: "plugin" });
    } else {
      dispatched.push(plugin);
    }
  });
  return { dispatched, collisions };
}
