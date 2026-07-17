import { describe, it, expect, vi, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import TimelineOverlay from "../../src/components/TimelineOverlay.vue";

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

  it("closes on a document-level Escape keydown (focus-independent)", async () => {
    vi.stubGlobal("fetch", mockFetch({ events, truncated: false }));
    const w = mount(TimelineOverlay, { attachTo: document.body, props: { sessionId: "s", cwd: "/x", open: true } });
    await flushPromises();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(w.emitted("close")).toBeTruthy();
    w.unmount();
  });

  it("ignores a stale response superseded by a newer open", async () => {
    const resp = (payload: unknown) => ({ ok: true, json: () => Promise.resolve(payload) });
    let resolveStale: (v: unknown) => void = () => {};
    const stale = new Promise((r) => {
      resolveStale = r;
    });
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(stale) // first open (session a) resolves LAST
      .mockResolvedValueOnce(resp({ events: [{ ts: "t", tool: "Read", summary: "B" }], truncated: false }));
    vi.stubGlobal("fetch", fetchMock);

    const w = mount(TimelineOverlay, { props: { sessionId: "a", cwd: "/x", open: true } });
    await w.setProps({ open: false });
    await w.setProps({ sessionId: "b", open: true }); // second open supersedes the first
    await flushPromises();
    resolveStale(resp({ events: [{ ts: "t", tool: "Bash", summary: "A" }], truncated: false }));
    await flushPromises();

    expect(w.findAll(".tl-row .tl-tool").map((n) => n.text())).toEqual(["Read"]); // newest wins, stale ignored
    w.unmount();
  });

  it("clears the truncated flag on a later error (no stale '+')", async () => {
    const okTrunc = { ok: true, json: () => Promise.resolve({ events, truncated: true }) };
    const fail = { ok: false, json: () => Promise.resolve({}) };
    const fetchMock = vi.fn().mockResolvedValueOnce(okTrunc).mockResolvedValueOnce(fail);
    vi.stubGlobal("fetch", fetchMock);
    const w = mount(TimelineOverlay, { props: { sessionId: "a", cwd: "/x", open: true } });
    await flushPromises();
    expect(w.find(".tl-count").text()).toContain("+");
    await w.setProps({ sessionId: "b" }); // reload → error
    await flushPromises();
    expect(w.find(".tl-count").text()).not.toContain("+");
    w.unmount();
  });

  it("reloads when the session changes while the overlay stays open", async () => {
    const fetchMock = mockFetch({ events, truncated: false });
    vi.stubGlobal("fetch", fetchMock);
    const w = mount(TimelineOverlay, { props: { sessionId: "a", cwd: "/x", open: true } });
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await w.setProps({ sessionId: "b" });
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    w.unmount();
  });
});
