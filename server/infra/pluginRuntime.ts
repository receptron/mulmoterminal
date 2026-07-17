// The host side of gui-chat-protocol's `PluginRuntime` — what a FACTORY-style
// plugin receives. A factory plugin is authored as
// `export default definePlugin(({ log, files, … }) => ({ TOOL_DEFINITION, async <toolName>(args) {…} }))`
// (e.g. @mulmoclaude/google-plugin), so the host must construct the runtime before
// it can get at the tool's executor. The older `TOOL_DEFINITION` + `execute` packages
// don't need any of this — see plugins-registry.ts for which shape gets what.
//
// Every capability is scoped to the ONE package it's handed to: pubsub can only
// publish under `plugin:<pkg>:…`, data/config are private per-package dirs, and the
// log lines are prefixed. Rooted paths follow this workspace's existing layout
// (`<workspace>/data/…`, `<workspace>/config/…`, as used by the wiki and scheduler).
import path from "path";
import type { FileOps, PluginRuntime, PluginFetchOptions } from "gui-chat-protocol";
import { createFileOps } from "../backends/fileOps.js";
import { artifactsFileOps } from "../backends/artifacts.js";

// A plugin's fetch gets a bounded wait by default so a hung remote can't wedge the
// tool call forever; a plugin may lower it, and may pin an allowlist of hosts.
const DEFAULT_FETCH_TIMEOUT_MS = 30_000;

interface PluginRuntimeDeps {
  workspace: string;
  // Publish on the host's pub/sub (server/infra/pubsub.ts). Absent until boot wires
  // it, so a plugin publishing before then is a no-op rather than a crash.
  publish?: (channel: string, data: unknown) => void;
}

let deps: PluginRuntimeDeps | null = null;

export function initPluginRuntime(next: PluginRuntimeDeps): void {
  deps = next;
}

// An empty workspace would silently root every plugin dir at process.cwd() (the
// server package dir), so it's rejected like a missing init — same guard as
// backends/artifacts.ts.
function requireWorkspace(): string {
  if (!deps?.workspace) throw new Error("plugin runtime not initialised (missing workspace)");
  return deps.workspace;
}

// `<workspace>/data/plugins/<pkg>/` and `<workspace>/config/plugins/<pkg>/`. The
// package name is slugified so a scoped name (@scope/pkg) can't introduce a path
// separator and climb out of the plugins dir.
const pkgSlug = (pkg: string): string => pkg.replace(/[^a-zA-Z0-9._-]+/g, "_");

const pluginDir = (area: "data" | "config", pkg: string): string => path.resolve(requireWorkspace(), area, "plugins", pkgSlug(pkg));

function scopedFiles(pkg: string): { data: FileOps; config: FileOps; artifacts: FileOps } {
  return {
    data: createFileOps(() => pluginDir("data", pkg), `plugin ${pkg} data`),
    config: createFileOps(() => pluginDir("config", pkg), `plugin ${pkg} config`),
    // artifacts is the SHARED, user-browsable area — deliberately not per-plugin.
    artifacts: artifactsFileOps,
  };
}

// Host locale for plugins that localize their output. A snapshot (the protocol says
// the server side is a snapshot), read from the usual POSIX env with an en fallback.
function hostLocale(): string {
  const raw = process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || "en";
  return raw.split(".")[0].replace("_", "-") || "en";
}

const hostFetch = async (url: string, opts?: PluginFetchOptions): Promise<Response> => {
  const { timeoutMs, allowedHosts, ...init } = opts ?? {};
  if (allowedHosts && allowedHosts.length > 0) {
    const host = new URL(url).host;
    if (!allowedHosts.includes(host)) throw new Error(`plugin fetch blocked: ${host} is not in allowedHosts`);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

// Un-validated remote JSON stays `unknown` unless the caller passes `parse`, which
// narrows it — the protocol's guard against strongly-typed access to un-checked data.
const hasParse = (opts: unknown): opts is { parse: (raw: unknown) => unknown } =>
  typeof opts === "object" && opts !== null && "parse" in opts && typeof opts.parse === "function";

/** The runtime handed to `<pkg>`'s factory. Every capability is scoped to that package. */
export function createPluginRuntime(pkg: string): PluginRuntime {
  return {
    pubsub: {
      publish(eventName, payload) {
        deps?.publish?.(`plugin:${pkg}:${eventName}`, payload);
      },
    },
    locale: hostLocale(),
    files: scopedFiles(pkg),
    log: {
      debug: (msg, data) => console.debug(`[plugin/${pkg}] ${msg}`, data ?? ""),
      info: (msg, data) => console.info(`[plugin/${pkg}] ${msg}`, data ?? ""),
      warn: (msg, data) => console.warn(`[plugin/${pkg}] ${msg}`, data ?? ""),
      error: (msg, data) => console.error(`[plugin/${pkg}] ${msg}`, data ?? ""),
    },
    fetch: hostFetch,
    async fetchJson(url: string, opts?: PluginFetchOptions) {
      const res = await hostFetch(url, opts);
      const raw: unknown = await res.json();
      return hasParse(opts) ? opts.parse(raw) : raw;
    },
  };
}
