// Wire @mulmoclaude/accounting-plugin/vue to MulmoTerminal. Imported for its side
// effect from main.ts so the package's View can resolve its network / pub-sub / locale
// seams before any manageAccounting card mounts. MulmoTerminal's counterpart to
// MulmoClaude's src/composables/accountingHost.ts — but leaner:
//   · no global `style.css` import: PluginFrame injects the package CSS into each
//     view's own shadow root via the `?inline` string in plugins-registry.ts, so it
//     can't leak the package's Tailwind preflight into MulmoTerminal's own UI.
//   · locale is the display language (see localeTag below).
import { defineComponent, h, inject, markRaw, type Component } from "vue";
import { configureAccountingHost, provideAccountingHost } from "@mulmoclaude/accounting-plugin/vue";
import type { AccountingTreeHost, ApiResult } from "@mulmoclaude/accounting-plugin/vue";
import { fetchJson } from "../utils/fetchJson";
import { usePubSub } from "./usePubSub";
import { i18n } from "../i18n";
import { isRemoteHost, pathOnHost } from "../components/remoteCell";
import { PLUGIN_HOST_KEY } from "./pluginRuntime";

const { subscribe } = usePubSub();

// The plugin package declares the generic — `AccountingApiCall = <T = unknown>(path, opts) =>
// Promise<ApiResult<T>>` — so the PLUGIN chooses T and the host has to produce it from a body
// nothing has checked. Unprovable by construction, exactly like gui-chat-protocol's `dispatch<T>`
// (see the type-assertion allowlist in eslint.config.js). The claim is made HERE, at the seam,
// rather than hidden inside fetchJson where it would apply to every caller.
const asDeclared = <T>(raw: unknown): T => raw as T;

// Network seam — normalise fetch into the package's ApiResult union (the View
// pattern-matches on `.ok`). Mirrors MulmoClaude's apiCall shape so the View's
// `apiCall("/api/accounting", { method, body })` calls just work.
function apiCall<T = unknown>(path: string, opts: { method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; body?: unknown }): Promise<ApiResult<T>> {
  // RequestInit spells its fields exact, so a bodyless call omits both keys rather than
  // sending them as undefined.
  const hasBody = opts.body !== undefined;
  return fetchJson<T>(path, asDeclared, {
    method: opts.method,
    ...(hasBody ? { headers: { "content-type": "application/json" }, body: JSON.stringify(opts.body) } : {}),
  });
}

/** A card's books read on `host` (#3506). Its book channels are not relayed from there, so the card
 *  does not refresh when the books change. */
export const remoteAccountingHost = (host: string): AccountingTreeHost => ({
  apiCall: (path, opts) => apiCall(pathOnHost(host, path), opts),
  subscribe: () => () => undefined,
});

// A remote cell's accounting card reads its books on the cell's host (#3506). The host is read once:
// a card is drawn for one cell.
export function withAccountingHost(inner: Component): Component {
  return markRaw(
    defineComponent({
      name: "AccountingHost",
      inheritAttrs: false,
      setup(_props, { attrs, slots }) {
        const host = inject(PLUGIN_HOST_KEY, () => null)();
        if (isRemoteHost(host)) provideAccountingHost(remoteAccountingHost(host));
        return () => h(inner, attrs, slots);
      },
    }),
  );
}

configureAccountingHost({
  apiCall,
  // Raw `accounting:<bookId>` / `accounting:books` channels: the engine publishes
  // book changes (server/backends/plugins/accounting.ts) and the View live-refreshes.
  subscribe,
  // The display language as a full tag, not pluginLocaleFor's table key: the plugin's own vue-i18n
  // falls back zh-TW to zh, and it reads the region off the tag to guess the book's country.
  localeTag: () => i18n.global.locale.value,
});
