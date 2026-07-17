import { describe, it, expect, vi, afterEach } from "vitest";
import { createApp, defineComponent, ref } from "vue";
import { flushPromises } from "@vue/test-utils";
import { useHeaderButtons } from "../../../src/composables/useHeaderButtons";

function withSetup<T>(composable: () => T): { result: T; unmount: () => void } {
  let result!: T;
  const app = createApp(defineComponent({ setup: () => ((result = composable()), () => null) }));
  app.mount(document.createElement("div"));
  return { result, unmount: () => app.unmount() };
}

const jsonResponse = (body: unknown) => ({ ok: true, json: () => Promise.resolve(body) }) as unknown as Response;
const params = (cwd: string | null) => ({ cwd: ref(cwd), session: ref<string | null>(null), agent: ref<"claude" | "codex">("claude") });

describe("useHeaderButtons", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("does not fetch and yields no buttons when cwd is null (command/launcher terminal)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { result, unmount } = withSetup(() => useHeaderButtons(params(null)));
    await flushPromises();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.buttons.value).toEqual([]);
    unmount();
  });

  it("fetches /api/header for a real cwd and exposes the resolved buttons", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ buttons: [{ id: "pr", label: "PR", run: "shell" }], chips: null })));
    vi.stubGlobal("fetch", fetchMock);
    const { result, unmount } = withSetup(() => useHeaderButtons(params("/proj")));
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/header?"));
    expect(result.buttons.value.map((b) => b.id)).toEqual(["pr"]);
    unmount();
  });
});
