import { describe, it, expect, vi, afterEach } from "vitest";
import { createApp, defineComponent, ref } from "vue";
import { flushPromises } from "@vue/test-utils";
import { useHeaderButtons, hasPickFileButton, isHeaderFolder, type HeaderButton } from "../../../src/composables/useHeaderButtons";
import { dirKeyOf } from "../../../src/composables/dirAddress";

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
    const fetchMock = vi.fn<(url: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(jsonResponse({ buttons: [{ id: "pr", label: "PR", run: "shell" }], chips: null })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { result, unmount } = withSetup(() => useHeaderButtons(params("/proj")));
    await flushPromises();
    // #1393: every request carries a deadline now, so the init is no longer absent.
    expect(fetchMock.mock.calls[0]?.[0]).toEqual(expect.stringContaining("/api/header?"));
    expect(result.buttons.value.map((b) => b.id)).toEqual(["pr"]);
    unmount();
  });
});

// #3506: a remote directory's header is the remote's, resolved there for its own session.
describe("useHeaderButtons on a remote directory", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("asks the host for the remote path, with the session, and asks a local one the same URL as before", async () => {
    const fetchMock = vi.fn<(url: RequestInfo | URL) => Promise<Response>>(() => Promise.resolve(jsonResponse({ buttons: [], chips: null })));
    vi.stubGlobal("fetch", fetchMock);
    const session = "0b8f0a0e-7c55-4c1e-9e0a-3f1d2c4b5a69";
    const remote = withSetup(() => useHeaderButtons({ ...params(dirKeyOf("lx", "/srv/my p")), session: ref<string | null>(session) }));
    const local = withSetup(() => useHeaderButtons(params("/srv/my p")));
    await flushPromises();
    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls).toContain(`/remote/lx/api/header?cwd=%2Fsrv%2Fmy+p&agent=claude&session=${session}`);
    expect(urls).toContain("/api/header?cwd=%2Fsrv%2Fmy+p&agent=claude");
    remote.unmount();
    local.unmount();
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

  it("sees a picker inside a folder", () => {
    expect(hasPickFileButton([{ id: "ops", label: "Ops", items: [btn({ id: "pick", open: { pickFile: true } })] }])).toBe(true);
    expect(hasPickFileButton([{ id: "ops", label: "Ops", items: [btn({ id: "url", open: { url: "https://x" } })] }])).toBe(false);
  });
});

describe("useHeaderButtons folders", () => {
  afterEach(() => vi.unstubAllGlobals());

  const load = async (buttons: unknown[]) => {
    vi.stubGlobal("fetch", () => Promise.resolve(jsonResponse({ buttons, chips: null })));
    const { result, unmount } = withSetup(() => useHeaderButtons(params("/proj")));
    await flushPromises();
    unmount();
    return result.buttons.value;
  };

  it("keeps a folder with the children that pass as buttons", async () => {
    const out = await load([
      {
        id: "ops",
        icon: "construction",
        label: "Ops",
        items: [
          { id: "t", label: "T", run: "shell" },
          { id: "bad", label: "Bad" },
        ],
      },
      { id: "pr", label: "PR", run: "shell" },
    ]);
    expect(out).toEqual([
      { id: "ops", icon: "construction", label: "Ops", items: [{ id: "t", label: "T", run: "shell" }] },
      { id: "pr", label: "PR", run: "shell" },
    ]);
    const [folder] = out;
    expect(folder && isHeaderFolder(folder)).toBe(true);
  });

  // A folder that would open onto an empty menu is not offered, like a button that would do nothing.
  it("drops a folder with no usable child, or with a malformed id / label / icon", async () => {
    expect(await load([{ id: "ops", label: "Ops", items: [] }])).toEqual([]);
    expect(await load([{ id: "ops", label: "Ops", items: [{ id: "bad", label: "Bad" }] }])).toEqual([]);
    expect(await load([{ label: "Ops", items: [{ id: "t", label: "T", run: "shell" }] }])).toEqual([]);
    expect(await load([{ id: "ops", label: "Ops", icon: 3, items: [{ id: "t", label: "T", run: "shell" }] }])).toEqual([]);
  });
});

// #2465. The palette's own entries arrive beside the buttons, checked the same way.
describe("useHeaderButtons commands", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("exposes the resolved commands, dropping one that would do nothing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          jsonResponse({
            buttons: [],
            commands: [
              { id: "release", label: "Release", run: "shell" },
              { id: "broken", label: "Broken" },
            ],
            chips: null,
          }),
        ),
      ),
    );
    const { result, unmount } = withSetup(() => useHeaderButtons(params("/proj")));
    await flushPromises();
    expect(result.commands.value.map((c) => c.id)).toEqual(["release"]);
    unmount();
  });

  it("has none when the response carries none", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(jsonResponse({ buttons: [], chips: null }))),
    );
    const { result, unmount } = withSetup(() => useHeaderButtons(params("/proj")));
    await flushPromises();
    expect(result.commands.value).toEqual([]);
    unmount();
  });
});
