// #3506. A remote cell's accounting card reads its books on the cell's host: the wrapper provides
// that host's connection around the package's View, and a local cell's card keeps the global one.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { defineComponent, h, provide } from "vue";
import { mount } from "@vue/test-utils";
import type { AccountingTreeHost } from "@mulmoclaude/accounting-plugin/vue";
import { PLUGIN_HOST_KEY } from "../../src/composables/pluginRuntime";

const requests: { url: string; body: unknown }[] = [];
vi.mock("../../src/utils/fetchWithTimeout", () => ({
  fetchWithTimeout: async (url: string, init?: RequestInit) => {
    requests.push({ url, body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
    return new Response(JSON.stringify({ books: [] }), { headers: { "content-type": "application/json" } });
  },
}));
// What the wrapper hands the package, caught on the way in: the package exports no reader of it.
let provided: AccountingTreeHost | null = null;
vi.mock("@mulmoclaude/accounting-plugin/vue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mulmoclaude/accounting-plugin/vue")>();
  return {
    ...actual,
    provideAccountingHost: (host: AccountingTreeHost) => {
      provided = host;
      actual.provideAccountingHost(host);
    },
  };
});
const { getPlugin } = await import("../../src/plugins-registry");
const { withAccountingHost } = await import("../../src/composables/accountingUi");

const View = defineComponent({ setup: () => () => h("div") });

const mountOn = (host: string | null): void => {
  const Wrapped = withAccountingHost(View);
  mount(
    defineComponent({
      setup() {
        provide(PLUGIN_HOST_KEY, () => host);
        return () => h(Wrapped);
      },
    }),
  );
};

describe("the accounting card's host", () => {
  beforeEach(() => {
    requests.length = 0;
    provided = null;
  });

  it("sends a remote cell's card's requests to its host", async () => {
    mountOn("lx");
    const result = await provided?.apiCall("/api/accounting", { method: "POST", body: { action: "getBooks" } });
    expect(result).toMatchObject({ ok: true });
    expect(requests).toEqual([{ url: "/remote/lx/api/accounting", body: { action: "getBooks" } }]);
  });

  it("names no project of this machine for a remote cell's card", () => {
    mountOn("lx");
    expect(provided?.projectScope).toBeUndefined();
  });

  it("subscribes a remote cell's card to nothing", () => {
    mountOn("lx");
    const handler = vi.fn();
    const unsubscribe = provided?.subscribe("accounting:books", handler);
    expect(typeof unsubscribe).toBe("function");
    unsubscribe?.();
    expect(handler).not.toHaveBeenCalled();
  });

  it.each([null, ""])("keeps the global connection for a local cell (%j)", (host) => {
    mountOn(host);
    expect(provided).toBeNull();
  });

  it("keeps the global connection with no Canvas around it", () => {
    mount(withAccountingHost(View));
    expect(provided).toBeNull();
  });
});

describe("the cards a remote cell draws", () => {
  it.each(["manageAccounting", "presentCollection"])("draws %s from the result as it is", (toolName) => {
    const result = { uuid: "u", toolName, data: { scope: "p1" } };
    expect(getPlugin(toolName)?.onRemote?.(result, "lx")).toBe(result);
  });
});
