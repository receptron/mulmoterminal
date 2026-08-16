import { describe, it, expect, vi, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import PromptsPane from "../../../src/components/PromptsPane.vue";
import { PROMPT_SUBMITTED_CHANNEL } from "../../../common/promptChannel";

// The pane subscribes to its own prompt channel; the handler is captured so a test can push an
// event at it without a socket.
const handlers = new Map<string, (data: unknown) => void>();
vi.mock("../../../src/composables/usePubSub", () => ({
  usePubSub: () => ({
    subscribe: (channel: string, cb: (data: unknown) => void) => {
      handlers.set(channel, cb);
      return () => handlers.delete(channel);
    },
  }),
}));

const prompts = [
  { at: Date.parse("2026-08-16T02:31:02.318Z"), text: "セルを並べたときに自分の命令が分からなくなる" },
  { at: Date.parse("2026-08-16T02:38:14.044Z"), text: "ok" },
];

const mockFetch = (payload: unknown, ok = true) => vi.fn().mockResolvedValue({ ok, json: () => Promise.resolve(payload) });

const mountPane = (props: Record<string, unknown> = {}) => mount(PromptsPane, { props: { sessionId: "s1", cwd: "/repo", agent: "claude", ...props } });

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals(); // restoreAllMocks does not undo stubGlobal (CodeRabbit, #1749)
  handlers.clear();
});

describe("PromptsPane", () => {
  it("lists the session's prompts newest first", async () => {
    vi.stubGlobal("fetch", mockFetch({ prompts, truncated: false }));
    const w = mountPane();
    await flushPromises();
    const rows = w.findAll('[data-testid="prompt-text"]');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.text()).toBe("ok");
    expect(rows[1]?.text()).toContain("自分の命令");
    expect(w.get('[data-testid="prompts-count"]').text()).toBe("2");
  });

  it("asks the server for THIS cell's session and agent", async () => {
    const fetchMock = mockFetch({ prompts: [], truncated: false });
    vi.stubGlobal("fetch", fetchMock);
    mountPane({ sessionId: "abc", agent: "codex", cwd: "/w" });
    await flushPromises();
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain("session=abc");
    expect(url).toContain("agent=codex");
    expect(url).toContain(encodeURIComponent("/w"));
  });

  it("marks a capped list so the missing prompts are the OLD ones", async () => {
    vi.stubGlobal("fetch", mockFetch({ prompts, truncated: true }));
    const w = mountPane();
    await flushPromises();
    expect(w.get('[data-testid="prompts-count"]').text()).toBe("2+");
    expect(w.text()).toContain("Older prompts aren't shown");
  });

  it("says which kind of empty it is", async () => {
    vi.stubGlobal("fetch", mockFetch({ prompts: [], truncated: false }));
    const w = mountPane();
    await flushPromises();
    expect(w.get('[data-testid="prompts-empty"]').text()).toContain("Nothing sent");

    const cellWithNoSession = mountPane({ sessionId: null });
    await flushPromises();
    expect(cellWithNoSession.get('[data-testid="prompts-empty"]').text()).toContain("hasn't started a session");
  });

  it("says so when the read fails, rather than showing an empty history", async () => {
    vi.stubGlobal("fetch", mockFetch({}, false));
    const w = mountPane();
    await flushPromises();
    expect(w.get('[data-testid="prompts-empty"]').text()).toContain("Couldn't read");
  });

  it("reloads when this session gets a prompt, and on nothing else", async () => {
    vi.useFakeTimers();
    const fetchMock = mockFetch({ prompts, truncated: false });
    vi.stubGlobal("fetch", fetchMock);
    mountPane({ sessionId: "s1" });
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const push = handlers.get(PROMPT_SUBMITTED_CHANNEL);
    push?.({ sessionId: "other" }); // another cell's prompt
    push?.({ nope: true }); // a frame of the wrong shape
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    push?.({ sessionId: "s1" });
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  // Codex, #1749: the pane used to read the `sessions` activity row, which publishes nothing when
  // the working flag does not move — so a second prompt inside one running turn never refreshed it.
  // That prompt is the reason this pane exists, hence a signal that does not depend on a flag.
  it("reloads for EVERY prompt, including ones sent inside a turn already running", async () => {
    vi.useFakeTimers();
    const fetchMock = mockFetch({ prompts, truncated: false });
    vi.stubGlobal("fetch", fetchMock);
    mountPane({ sessionId: "s1" });
    await flushPromises();

    const push = handlers.get(PROMPT_SUBMITTED_CHANNEL);
    push?.({ sessionId: "s1" });
    await vi.advanceTimersByTimeAsync(2000);
    push?.({ sessionId: "s1" });
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchMock).toHaveBeenCalledTimes(3); // the mount, then one per prompt
    vi.useRealTimers();
  });

  it("follows the zoom: a changed session reloads rather than keeping the last cell's prompts", async () => {
    const fetchMock = mockFetch({ prompts, truncated: false });
    vi.stubGlobal("fetch", fetchMock);
    const w = mountPane({ sessionId: "s1" });
    await flushPromises();
    await w.setProps({ sessionId: "s2" });
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("session=s2");
  });

  // Codex, #1749: the `req` counter stops a slow response from LANDING on the wrong cell, and did
  // nothing about the rows already on screen — so walking the zoom showed the previous terminal's
  // prompts under the new one's header until the request came back.
  it("clears the previous session's rows while the new one is still loading", async () => {
    let release: ((body: unknown) => void) | undefined;
    const slow = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ prompts, truncated: false }) })
      .mockReturnValueOnce(new Promise((resolve) => (release = () => resolve({ ok: true, json: () => Promise.resolve({ prompts: [], truncated: false }) }))));
    vi.stubGlobal("fetch", slow);
    const w = mountPane({ sessionId: "s1" });
    await flushPromises();
    expect(w.findAll('[data-testid="prompt-row"]')).toHaveLength(2);

    await w.setProps({ sessionId: "s2" });
    await flushPromises();
    expect(w.findAll('[data-testid="prompt-row"]')).toHaveLength(0); // NOT s1's two, while s2 loads
    release?.(null);
    await flushPromises();
    expect(w.get('[data-testid="prompts-empty"]').text()).toContain("Nothing sent");
  });

  // The early return bumps `req`, so the in-flight load never reaches its own `finally`.
  it("does not sit on 'Loading…' when the zoom moves to a cell with no session", async () => {
    const never = vi.fn().mockReturnValue(new Promise(() => {}));
    vi.stubGlobal("fetch", never);
    const w = mountPane({ sessionId: "s1" });
    await flushPromises();
    await w.setProps({ sessionId: null });
    await flushPromises();
    expect(w.get('[data-testid="prompts-empty"]').text()).toContain("hasn't started a session");
  });

  it("does not blank the list when the SAME session simply gets a new prompt", async () => {
    vi.useFakeTimers();
    const fetchMock = mockFetch({ prompts, truncated: false });
    vi.stubGlobal("fetch", fetchMock);
    const w = mountPane({ sessionId: "s1" });
    await flushPromises();
    const push = handlers.get(PROMPT_SUBMITTED_CHANNEL);
    expect(push).toBeDefined(); // or the assertion below would pass without the pane doing anything
    push?.({ sessionId: "s1" });
    await vi.advanceTimersByTimeAsync(500);
    expect(w.findAll('[data-testid="prompt-row"]')).toHaveLength(2);
    vi.useRealTimers();
  });

  it("drops a row with no text and keeps one whose time is unreadable", async () => {
    vi.stubGlobal("fetch", mockFetch({ prompts: [{ at: null, text: "no clock" }, { at: 1, text: "" }, { text: 5 }, null], truncated: false }));
    const w = mountPane();
    await flushPromises();
    const rows = w.findAll('[data-testid="prompt-text"]');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.text()).toBe("no clock");
    expect(w.get('[data-testid="prompt-time"]').text()).toBe("");
  });

  it("clamps a long prompt until it is clicked", async () => {
    vi.stubGlobal("fetch", mockFetch({ prompts: [{ at: 1, text: "x".repeat(500) }], truncated: false }));
    const w = mountPane();
    await flushPromises();
    expect(w.get('[data-testid="prompt-text"]').classes()).toContain("line-clamp-3");
    await w.get('[data-testid="prompt-row"] button').trigger("click");
    expect(w.get('[data-testid="prompt-text"]').classes()).not.toContain("line-clamp-3");
  });

  it("emits close and toggleExpand from its header", async () => {
    vi.stubGlobal("fetch", mockFetch({ prompts, truncated: false }));
    const w = mountPane();
    await flushPromises();
    await w.get('[data-testid="prompts-close-btn"]').trigger("click");
    await w.get('[data-testid="prompts-expand-btn"]').trigger("click");
    expect(w.emitted("close")).toHaveLength(1);
    expect(w.emitted("toggleExpand")).toHaveLength(1);
  });
});
