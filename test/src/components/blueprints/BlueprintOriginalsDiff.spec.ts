// The finished screen's comparison with the originals: one diff per file still there, a note for one that is gone,
// and nothing at all for a build that kept no originals.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { mountUnderOverlay } from "../underOverlay";

const { loadOriginals, createDiffView } = vi.hoisted(() => ({
  loadOriginals: vi.fn<(runId: string) => Promise<unknown>>(),
  createDiffView: vi.fn<(parent: HTMLElement, original: string, current: string, phrases: unknown) => { destroy: () => void }>(() => ({ destroy: vi.fn() })),
}));
vi.mock("../../../../src/composables/blueprintsApi", () => ({ loadOriginals }));
vi.mock("../../../../src/components/cmDiffView", () => ({ createDiffView }));
// The theme as the app resolved it; only its base colour decides light or dark.
const { themeVars } = await vi.hoisted(async () => {
  const { ref } = await import("vue");
  return { themeVars: ref<Record<string, string> | null>({ "--bg-base": "#0d1117" }) };
});
vi.mock("../../../../src/composables/useTheme", () => ({ activeThemeVars: themeVars }));

import BlueprintOriginalsDiff from "../../../../src/components/blueprints/BlueprintOriginalsDiff.vue";

beforeEach(() => {
  loadOriginals.mockReset();
  createDiffView.mockClear();
});

describe("BlueprintOriginalsDiff", () => {
  it("compares each file still there with its original, and says which are gone", async () => {
    loadOriginals.mockResolvedValue({
      ok: true,
      value: {
        files: [
          { path: "a.md", original: "old a", current: "new a" },
          { path: "gone.md", original: "old g", current: null },
          { path: "b.proposed.md", original: "old b", current: "new b", from: "b.md" },
        ],
        more: true,
      },
    });
    const wrapper = mount(BlueprintOriginalsDiff, { props: { runId: "r1" } });
    await flushPromises();
    expect(loadOriginals).toHaveBeenCalledWith("r1");
    expect(wrapper.findAll('[data-testid="blueprint-original"] span').map((span) => span.text())).toEqual(["a.md", "gone.md", "b.md → b.proposed.md"]);
    expect(wrapper.findAll('[data-testid="blueprint-original-gone"]')).toHaveLength(1);
    expect(createDiffView.mock.calls.map((call) => [call[1], call[2]])).toEqual([
      ["old a", "new a"],
      ["old b", "new b"],
    ]);
    expect(createDiffView.mock.calls[0]?.[3]).toMatchObject({ phrases: { "$ unchanged lines": "$ unchanged lines" } });
    expect(wrapper.text()).toContain("There are more");
    expect(wrapper.find('[data-testid="blueprint-originals-kept"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="blueprint-originals-proposed"]').exists()).toBe(true);
  });

  it("shows nothing for a build that kept no originals, or when they could not be read", async () => {
    loadOriginals.mockResolvedValue({ ok: true, value: { files: [], more: false } });
    const empty = mount(BlueprintOriginalsDiff, { props: { runId: "r1" } });
    await flushPromises();
    expect(empty.find('[data-testid="blueprint-originals"]').exists()).toBe(false);
    loadOriginals.mockResolvedValue({ ok: false, error: "gone" });
    const failed = mount(BlueprintOriginalsDiff, { props: { runId: "r2" } });
    await flushPromises();
    expect(failed.find('[data-testid="blueprint-originals"]').exists()).toBe(false);
    expect(createDiffView).not.toHaveBeenCalled();
  });

  it("says where the originals are only when it kept some, and what a proposed copy is only when there is one", async () => {
    loadOriginals.mockResolvedValue({ ok: true, value: { files: [{ path: "c.proposed.txt", original: "o", current: "n", from: "c.txt" }], more: false } });
    const proposals = mount(BlueprintOriginalsDiff, { props: { runId: "r1" } });
    await flushPromises();
    expect(proposals.find('[data-testid="blueprint-originals-kept"]').exists()).toBe(false);
    expect(proposals.find('[data-testid="blueprint-originals-proposed"]').exists()).toBe(true);
    loadOriginals.mockResolvedValue({ ok: true, value: { files: [{ path: "a.md", original: "o", current: "n" }], more: false } });
    const kept = mount(BlueprintOriginalsDiff, { props: { runId: "r2" } });
    await flushPromises();
    expect(kept.find('[data-testid="blueprint-originals-kept"]').exists()).toBe(true);
    expect(kept.find('[data-testid="blueprint-originals-proposed"]').exists()).toBe(false);
  });

  it("draws in the theme's light or dark, and again when the theme changes", async () => {
    themeVars.value = { "--bg-base": "#0d1117" };
    loadOriginals.mockResolvedValue({ ok: true, value: { files: [{ path: "a.md", original: "o", current: "n" }], more: false } });
    mount(BlueprintOriginalsDiff, { props: { runId: "r1" } });
    await flushPromises();
    expect(createDiffView.mock.calls.map((call) => call[3])).toEqual([expect.objectContaining({ dark: true })]);
    const first = createDiffView.mock.results[0]?.value;
    themeVars.value = { "--bg-base": "#ffffff" };
    await flushPromises();
    expect(createDiffView.mock.calls.map((call) => call[3])).toEqual([expect.objectContaining({ dark: true }), expect.objectContaining({ dark: false })]);
    expect(first?.destroy).toHaveBeenCalled();
    themeVars.value = { "--bg-base": "#0d1117" };
  });
});

// The Blueprints screen is kept while closed: shown again, the originals are read again, and a read
// that fails then keeps the ones shown.
describe("the originals shown again", () => {
  it("are read again each time the screen is shown, and kept through a failed read", async () => {
    loadOriginals.mockReset();
    loadOriginals.mockResolvedValueOnce({ ok: true, value: { files: [{ path: "a.md", original: "old a", current: "new a" }], more: false } });
    loadOriginals.mockResolvedValue({ ok: false, error: "gone" });
    const { wrapper, showAgain } = mountUnderOverlay(BlueprintOriginalsDiff, { runId: "r1" });
    await flushPromises();
    await showAgain();
    expect(loadOriginals).toHaveBeenCalledTimes(2);
    expect(wrapper.findAll('[data-testid="blueprint-original"]')).toHaveLength(1);
    wrapper.unmount();
  });
});
