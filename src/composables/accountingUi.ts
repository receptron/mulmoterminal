// Wire @mulmoclaude/accounting-plugin/vue to MulmoTerminal. Imported for its side
// effect from main.ts so the package's View can resolve its network / pub-sub / locale
// seams before any manageAccounting card mounts. MulmoTerminal's counterpart to
// MulmoClaude's src/composables/accountingHost.ts — but leaner:
//   · no global `style.css` import: PluginFrame injects the package CSS into each
//     view's own shadow root via the `?inline` string in plugins-registry.ts, so it
//     can't leak the package's Tailwind preflight into MulmoTerminal's own UI.
//   · locale is the browser's base language (MulmoTerminal has no locale picker); the
//     package's self-contained i18n falls back to English for anything else.
import { configureAccountingHost } from "@mulmoclaude/accounting-plugin/vue";
import type { ApiResult } from "@mulmoclaude/accounting-plugin/vue";
import { usePubSub } from "./usePubSub";

const { subscribe } = usePubSub();

// Network seam — normalise fetch into the package's ApiResult union (the View
// pattern-matches on `.ok`). Mirrors MulmoClaude's apiCall shape so the View's
// `apiCall("/api/accounting", { method, body })` calls just work.
async function apiCall<T = unknown>(path: string, opts: { method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; body?: unknown }): Promise<ApiResult<T>> {
  try {
    const res = await fetch(path, {
      method: opts.method,
      headers: opts.body !== undefined ? { "content-type": "application/json" } : undefined,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}`, status: res.status };
    return { ok: true, data: (await res.json()) as T };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), status: 0 };
  }
}

configureAccountingHost({
  apiCall,
  // Raw `accounting:<bookId>` / `accounting:books` channels: the engine publishes
  // book changes (server/backends/accounting.ts) and the View live-refreshes.
  subscribe,
  localeTag: () => (navigator.language || "en").split("-")[0],
});
