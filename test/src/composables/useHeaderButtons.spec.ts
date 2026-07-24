import { describe, it, expect, vi, afterEach } from "vitest";
import { createApp, defineComponent, ref } from "vue";
import { flushPromises } from "@vue/test-utils";
import { useHeaderButtons, hasPickFileButton, type HeaderButton } from "../../../src/composables/useHeaderButtons";

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

describe("hasPickFileButton", () => {
  const btn = (over: Partial<HeaderButton>): HeaderButton => ({ id: "x", label: "x", run: "open", ...over });

  it("is true when an open button carries pickFile", () => {
    expect(hasPickFileButton([btn({ id: "pick", open: { pickFile: true } })])).toBe(true);
    expect(hasPickFileButton([btn({ id: "url", open: { url: "https://x" } }), btn({ id: "pick", open: { pickFile: true } })])).toBe(true);
  });

  it("is false when the picker was configured away", () => {
    expect(hasPickFileButton([btn({ id: "url", open: { url: "https://x" } }), btn({ id: "rev", open: { reveal: "${dir}" } })])).toBe(false);
    expect(hasPickFileButton([])).toBe(false);
  });

  it("does not count a non-open button or pickFile:false", () => {
    expect(hasPickFileButton([btn({ id: "sh", run: "shell" }), btn({ id: "p", open: { pickFile: false } })])).toBe(false);
  });
});
