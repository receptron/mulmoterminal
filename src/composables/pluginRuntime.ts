// MulmoTerminal's BrowserPluginRuntime provider (task #6 Phase 4). The
// @mulmoclaude/markdown-plugin View reaches host capabilities via
// gui-chat-protocol's useRuntime() — dispatch / pubsub / locale / openUrl — which
// requires a host to provide() one under PLUGIN_RUNTIME_KEY. MulmoTerminal had no
// such provider; this is it, wired to MulmoTerminal's own transport:
//   - dispatch  → POST /api/plugin/<toolName> (the same route the MCP broker uses;
//                 execute() routes by args.kind, so the View's dispatch and the
//                 LLM tool-call share one endpoint).
//   - pubsub    → the existing socket.io usePubSub, on `plugin:<scope>:<event>`
//                 channels (the server forwards file changes to
//                 plugin:markdown:file:<path> — see server/backends/markdown.js).
//   - locale    → a fixed "en" ref (MulmoTerminal has no locale picker; the
//                 package's bundled i18n falls back to English).
//   - openUrl   → scheme-allowlisted window.open.
import { computed, defineComponent, h, markRaw, provide, ref, type Component, type Ref } from "vue";
import { PLUGIN_RUNTIME_KEY, type BrowserPluginRuntime } from "gui-chat-protocol/vue";
import { usePubSub } from "./usePubSub";
import { isOpenablePluginUrl } from "./pluginUrlPolicy";

function pluginChannelName(scope: string, eventName: string): string {
  return `plugin:${scope}:${eventName}`;
}

function makeOpenUrl(scope: string): BrowserPluginRuntime["openUrl"] {
  return (url: string) => {
    // The scheme allowlist is the security boundary — see pluginUrlPolicy.ts.
    if (!isOpenablePluginUrl(url)) {
      console.warn(`[plugin/${scope}] openUrl rejected non-http(s) or unparseable URL`, { url });
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  };
}

function makeDispatch(toolName: string): BrowserPluginRuntime["dispatch"] {
  const url = `/api/plugin/${encodeURIComponent(toolName)}`;
  return async <T = unknown>(args: object): Promise<T> => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args ?? {}),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`plugin/${toolName} dispatch failed (${res.status}): ${text || res.statusText}`);
    }
    return (await res.json()) as T;
  };
}

// Shared "en" locale — MulmoTerminal has no locale switcher.
const sharedLocale: Ref<string> = ref("en");

interface MakeRuntimeDeps {
  /** Channel namespace for pubsub (e.g. "markdown"); matches the server forward. */
  scope: string;
  /** Tool name the dispatch route resolves (e.g. "presentDocument"). */
  toolName: string;
}

export function makeBrowserPluginRuntime(deps: MakeRuntimeDeps): BrowserPluginRuntime {
  const { scope, toolName } = deps;
  const { subscribe } = usePubSub();
  const tag = `[plugin/${scope}]`;
  return {
    pubsub: {
      subscribe(eventName, handler) {
        return subscribe(pluginChannelName(scope, eventName), handler as (data: unknown) => void);
      },
    },
    locale: computed(() => sharedLocale.value) as Ref<string>,
    log: {
      debug: (msg, data) => console.debug(tag, msg, data),
      info: (msg, data) => console.info(tag, msg, data),
      warn: (msg, data) => console.warn(tag, msg, data),
      error: (msg, data) => console.error(tag, msg, data),
    },
    openUrl: makeOpenUrl(scope),
    dispatch: makeDispatch(toolName),
    endpoints: undefined,
  };
}

/** Wrap a plugin view so its descendants can call useRuntime(). Mirrors
 *  MulmoClaude's wrapWithScope — builds the runtime once and provides it under
 *  PLUGIN_RUNTIME_KEY; the PluginFrame Teleport preserves Vue context, so the
 *  provide reaches the teleported view. */
export function wrapWithPluginRuntime(scope: string, toolName: string, inner: Component): Component {
  return markRaw(
    defineComponent({
      name: `PluginRuntimeScope:${scope}`,
      inheritAttrs: false,
      setup(_props, { attrs, slots }) {
        const runtime = makeBrowserPluginRuntime({ scope, toolName });
        provide(PLUGIN_RUNTIME_KEY, runtime);
        return () => h(inner, attrs, slots);
      },
    }),
  );
}
