import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import RunMenu from "../../src/components/RunMenu.vue";

type Script = { index: number; label: string; command: string };

// /api/scripts echoes back a resolved cwd (the server may fall back from a bad
// path); the picked command must carry THAT cwd, not the requested one.
function mockFetch(scripts: Script[], cwd = "/home/me/proj") {
  globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ cwd, scripts }) })) as unknown as typeof fetch;
}

const SCRIPTS: Script[] = [
  { index: 0, label: "Dev server", command: "yarn dev" },
  { index: 1, label: "Unit tests", command: "yarn test" },
];

const mountMenu = async () => {
  const w = mount(RunMenu, { props: { cwd: "/proj" } });
  await flushPromises(); // scripts fetch up front (decides whether the button shows)
  return w;
};

describe("RunMenu", () => {
  beforeEach(() => mockFetch(SCRIPTS));

  it("shows the trigger once the project's scripts have loaded", async () => {
    const w = await mountMenu();
    expect(w.find(".run-trigger").exists()).toBe(true);
    expect(w.find(".run-pop").exists()).toBe(false); // closed until clicked
  });

  it("renders nothing when the project has no scripts (no file, no button)", async () => {
    mockFetch([]);
    const w = await mountMenu();
    expect(w.find(".run-trigger").exists()).toBe(false);
    expect(w.find(".run-menu").exists()).toBe(false);
  });

  it("does not fetch (no button) while cwd is unresolved, avoiding default-workspace scripts", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const w = mount(RunMenu, { props: { cwd: null } });
    await flushPromises();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(w.find(".run-trigger").exists()).toBe(false);
  });

  it("lists the scripts when opened", async () => {
    const w = await mountMenu();
    await w.find(".run-trigger").trigger("click");
    const items = w.findAll(".run-item");
    expect(items).toHaveLength(2);
    expect(items[0].text()).toContain("Dev server");
  });

  it("closes when cwd changes and does not reappear pre-opened", async () => {
    const w = await mountMenu();
    await w.find(".run-trigger").trigger("click");
    expect(w.find(".run-pop").exists()).toBe(true);

    await w.setProps({ cwd: null }); // unresolved → cleared + closed
    await flushPromises();
    expect(w.find(".run-menu").exists()).toBe(false);

    await w.setProps({ cwd: "/proj2" }); // resolves again
    await flushPromises();
    expect(w.find(".run-trigger").exists()).toBe(true);
    expect(w.find(".run-pop").exists()).toBe(false); // not pre-opened
  });

  it("emits the picked script with the server-resolved cwd, then closes", async () => {
    const w = await mountMenu();
    await w.find(".run-trigger").trigger("click");
    await w.findAll(".run-item")[1].trigger("click");
    expect(w.emitted("run")?.[0]?.[0]).toEqual({ source: "script", index: 1, label: "Unit tests", cwd: "/home/me/proj" });
    expect(w.find(".run-pop").exists()).toBe(false); // closed after picking
  });
});
