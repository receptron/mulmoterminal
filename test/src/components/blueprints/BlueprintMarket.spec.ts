// The market view and a refused install or removal: the reason stays on screen after the catalog is re-read, in the
// person's language when the server said why as data.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h, ref } from "vue";
import { provideOverlayVisible } from "../../../../src/composables/overlayVisibility";
import { en } from "../../../../src/i18n/en";

const { installPack, uninstallPack, loadCatalog } = vi.hoisted(() => ({ installPack: vi.fn(), uninstallPack: vi.fn(), loadCatalog: vi.fn() }));
vi.mock("../../../../src/composables/blueprintsApi", () => ({
  loadRegistryUrls: async () => ({ ok: true, value: { urls: ["https://example.com/registry.json"] } }),
  saveRegistryUrls: async () => ({ ok: true, value: { urls: [] } }),
  loadCatalog,
  installPack,
  uninstallPack,
}));

import BlueprintMarket from "../../../../src/components/blueprints/BlueprintMarket.vue";

const PACK = {
  slug: "acme-tool",
  kind: "usecase",
  title: "Acme",
  description: "",
  repo: "https://example.com/acme.git",
  ref: "main",
  path: "",
  builtin: false,
};
const catalogWith = (installed: boolean) => ({
  ok: true,
  value: {
    registries: [
      {
        url: "https://example.com/registry.json",
        name: "Example",
        error: null,
        packs: [
          { ...PACK, installed: installed ? { slug: "acme-tool", registryUrl: "", repo: "", ref: "main", commit: "abcdef1234", installedAtMs: 1 } : null },
        ],
      },
    ],
  },
});

const mountMarket = async () => {
  const wrapper = mount(BlueprintMarket);
  await flushPromises();
  return wrapper;
};

describe("a refused market action", () => {
  beforeEach(() => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    installPack.mockReset();
    uninstallPack.mockReset();
  });

  it("keeps the reason on screen after the catalog is read again, worded from its code", async () => {
    loadCatalog.mockResolvedValue(catalogWith(false));
    installPack.mockResolvedValue({ ok: false, error: "server English", refusal: { code: "pack-busy", slug: "acme-tool" } });
    const wrapper = await mountMarket();
    await wrapper.get('[data-testid="blueprint-install"]').trigger("click");
    await flushPromises();
    expect(loadCatalog).toHaveBeenCalledTimes(2);
    expect(wrapper.get('[data-testid="blueprint-market-error"]').text()).toBe(en.blueprints.refusals.packBusy.replace("{slug}", "acme-tool"));
  });

  it("keeps a removal's reason too, and clears it once an action succeeds", async () => {
    loadCatalog.mockResolvedValue(catalogWith(true));
    uninstallPack.mockResolvedValueOnce({ ok: false, error: "server English" }).mockResolvedValueOnce({ ok: true, value: { ok: true } });
    const wrapper = await mountMarket();
    await wrapper.get('[data-testid="blueprint-uninstall"]').trigger("click");
    await flushPromises();
    expect(wrapper.get('[data-testid="blueprint-market-error"]').text()).toBe("server English");
    await wrapper.get('[data-testid="blueprint-uninstall"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-testid="blueprint-market-error"]').exists()).toBe(false);
  });

  it("shows a refusal and a failed re-read side by side, neither hiding the other", async () => {
    loadCatalog.mockResolvedValueOnce(catalogWith(false)).mockResolvedValueOnce({ ok: false, error: "catalog unreachable" });
    installPack.mockResolvedValue({ ok: false, error: "refused in English" });
    const wrapper = await mountMarket();
    await wrapper.get('[data-testid="blueprint-install"]').trigger("click");
    await flushPromises();
    expect(wrapper.get('[data-testid="blueprint-market-error"]').text()).toBe("refused in English");
    expect(wrapper.get('[data-testid="blueprint-market-load-error"]').text()).toBe("catalog unreachable");
  });
});

// The Blueprints screen is kept while closed, so the market stays mounted: it reads again when shown.
describe("the market shown again", () => {
  it("reads the catalog again each time the screen is shown", async () => {
    loadCatalog.mockReset();
    loadCatalog.mockResolvedValue(catalogWith(false));
    const visible = ref(true);
    const Host = defineComponent({ setup: () => (provideOverlayVisible(visible), () => h(BlueprintMarket)) });
    const wrapper = mount(Host);
    await flushPromises();
    expect(loadCatalog).toHaveBeenCalledTimes(1);
    visible.value = false;
    await flushPromises();
    visible.value = true;
    await flushPromises();
    expect(loadCatalog).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });

  it("keeps what a later read found when an earlier one answers last", async () => {
    loadCatalog.mockReset();
    let releaseEarly: (value: unknown) => void = () => {};
    loadCatalog.mockReturnValueOnce(new Promise((resolve) => (releaseEarly = resolve))).mockResolvedValue(catalogWith(true));
    const visible = ref(true);
    const Host = defineComponent({ setup: () => (provideOverlayVisible(visible), () => h(BlueprintMarket)) });
    const wrapper = mount(Host);
    await flushPromises();
    visible.value = false;
    await flushPromises();
    visible.value = true;
    await flushPromises();
    releaseEarly(catalogWith(false));
    await flushPromises();
    expect(wrapper.find('[data-testid="blueprint-uninstall"]').exists()).toBe(true);
    wrapper.unmount();
  });
});
