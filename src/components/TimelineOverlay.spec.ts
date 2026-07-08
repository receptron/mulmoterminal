import { describe, it, expect, vi, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import TimelineOverlay from "./TimelineOverlay.vue";

const events = [
  { ts: "2026-06-29T04:42:01.468Z", tool: "Bash", summary: "git status" },
  { ts: "2026-06-29T04:42:12.806Z", tool: "Read", summary: "/a/b.ts" },
];

const mockFetch = (payload: unknown, ok = true) => vi.fn().mockResolvedValue({ ok, json: () => Promise.resolve(payload) });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TimelineOverlay", () => {
  it("renders nothing when closed", () => {
    const w = mount(TimelineOverlay, { props: { sessionId: "s", cwd: "/x", open: false } });
    expect(w.find(".tl-modal").exists()).toBe(false);
  });

  it("loads and lists tool events newest-first when opened", async () => {
    vi.stubGlobal("fetch", mockFetch({ events, truncated: false }));
    const w = mount(TimelineOverlay, { props: { sessionId: "s", cwd: "/x", open: true } });
    await flushPromises();
    const rows = w.findAll(".tl-row");
    expect(rows).toHaveLength(2);
    // newest (Read) first
    expect(rows[0].find(".tl-tool").text()).toBe("Read");
    expect(rows[1].find(".tl-tool").text()).toBe("Bash");
    expect(w.find(".tl-count").text()).toContain("2 steps");
  });

  it("shows an empty state when there is no activity", async () => {
    vi.stubGlobal("fetch", mockFetch({ events: [], truncated: false }));
    const w = mount(TimelineOverlay, { props: { sessionId: "s", cwd: "/x", open: true } });
    await flushPromises();
    expect(w.find(".tl-empty").text()).toContain("No tool activity");
  });

  it("shows an error state when the fetch fails", async () => {
    vi.stubGlobal("fetch", mockFetch({}, false));
    const w = mount(TimelineOverlay, { props: { sessionId: "s", cwd: "/x", open: true } });
    await flushPromises();
    expect(w.find(".tl-empty").text()).toContain("Couldn't load");
  });

  it("emits close from the ✕ button", async () => {
    vi.stubGlobal("fetch", mockFetch({ events, truncated: false }));
    const w = mount(TimelineOverlay, { props: { sessionId: "s", cwd: "/x", open: true } });
    await flushPromises();
    await w.find(".tl-close").trigger("click");
    expect(w.emitted("close")).toBeTruthy();
  });
});
