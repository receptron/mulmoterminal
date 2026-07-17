import { describe, it, expect, vi, afterEach } from "vitest";
import { createApp, defineComponent, ref } from "vue";
import { flushPromises } from "@vue/test-utils";
import { useSessionContext } from "../../../src/composables/../../src/composables/useSessionContext";

function withSetup<T>(composable: () => T): { result: T; unmount: () => void } {
  let result!: T;
  const app = createApp(defineComponent({ setup: () => ((result = composable()), () => null) }));
  app.mount(document.createElement("div"));
  return { result, unmount: () => app.unmount() };
}

const jsonResponse = (body: unknown) => ({ ok: true, json: () => Promise.resolve(body) }) as unknown as Response;

describe("useSessionContext", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("fetches /api/session/:id (with cwd) and exposes the running model", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ context: { model: "claude-opus-4-8", contextTokens: 42 } })));
    vi.stubGlobal("fetch", fetchMock);
    const { result, unmount } = withSetup(() => useSessionContext(ref<string | null>("sess-1"), ref<string | null>("/proj")));
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledWith("/api/session/sess-1?cwd=%2Fproj");
    expect(result.context.value?.model).toBe("claude-opus-4-8");
    unmount();
  });

  it("does not fetch and stays null when there is no session id", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { result, unmount } = withSetup(() => useSessionContext(ref<string | null>(null), ref<string | null>(null)));
    await flushPromises();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.context.value).toBeNull();
    unmount();
  });

  it("drops the old model when the session switches, even if the new fetch fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ context: { model: "claude-opus-4-8", contextTokens: 1 } }))
      .mockResolvedValueOnce({ ok: false } as Response);
    vi.stubGlobal("fetch", fetchMock);
    const id = ref<string | null>("sess-1");
    const { result, unmount } = withSetup(() => useSessionContext(id, ref<string | null>(null)));
    await flushPromises();
    expect(result.context.value?.model).toBe("claude-opus-4-8");
    id.value = "sess-2"; // switch session; the refetch fails (ok:false)
    await flushPromises();
    expect(result.context.value).toBeNull(); // no stale sess-1 model
    unmount();
  });
});
