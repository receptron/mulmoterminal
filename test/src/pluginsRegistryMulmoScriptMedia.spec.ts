// #3506. The mulmoscript card's movie and PDF come from the cell's host: the adapter reads the host
// the Canvas provides when the View asks, and fetches through the byte proxy for a remote cell.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { defineComponent, h, inject, provide } from "vue";
import { mount } from "@vue/test-utils";
import { MULMOSCRIPT_HOST_ADAPTER_KEY, type MulmoScriptHostAdapter } from "@mulmoclaude/mulmoscript-plugin/vue";
import { PLUGIN_HOST_KEY } from "../../src/composables/pluginRuntime";

const fetched: string[] = [];
vi.mock("../../src/utils/fetchWithTimeout", () => ({
  fetchWithTimeout: async (url: string) => {
    fetched.push(url);
    return new Response("bytes");
  },
}));
const { withMulmoScriptHostAdapter } = await import("../../src/plugins-registry");

let adapter: MulmoScriptHostAdapter | undefined;
const View = defineComponent({
  setup() {
    adapter = inject(MULMOSCRIPT_HOST_ADAPTER_KEY);
    return () => h("div");
  },
});

const mountOn = (host: string | null): void => {
  const Adapted = withMulmoScriptHostAdapter(View);
  mount(
    defineComponent({
      setup() {
        provide(PLUGIN_HOST_KEY, () => host);
        return () => h(Adapted);
      },
    }),
  );
};

describe("the mulmoscript card's media", () => {
  beforeEach(() => {
    fetched.length = 0;
    adapter = undefined;
  });

  it("fetches from this server for a local cell", async () => {
    mountOn(null);
    await adapter?.fetchMediaBlob?.({ moviePath: "stories/out/a.mp4" });
    expect(fetched).toEqual(["/api/mulmoscript/media?moviePath=stories%2Fout%2Fa.mp4"]);
  });

  it("fetches from the cell's host through the byte proxy for a remote cell", async () => {
    mountOn("lx");
    await adapter?.fetchMediaBlob?.({ pdfPath: "stories/out/a.pdf", root: "ws-1" });
    expect(fetched).toEqual(["/remote/lx/bytes/api/mulmoscript/media?pdfPath=stories%2Fout%2Fa.pdf&root=ws-1"]);
  });

  it("fetches from this server with no Canvas around it", async () => {
    mount(withMulmoScriptHostAdapter(View));
    await adapter?.fetchMediaBlob?.({ moviePath: "m.mp4" });
    expect(fetched).toEqual(["/api/mulmoscript/media?moviePath=m.mp4"]);
  });
});
