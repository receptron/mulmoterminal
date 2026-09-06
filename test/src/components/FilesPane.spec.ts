import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import FilesPane from "../../../src/components/FilesPane.vue";

// Don't instantiate real CodeMirror (needs a full DOM); capture the change callback so a
// user edit can be simulated.
let onChange: () => void = () => {};
const fakeEditor = { setDoc: vi.fn(), getDoc: vi.fn(() => "edited text"), destroy: vi.fn() };
// Capture the pubsub handler so the IMMEDIATE path (Claude's write hook) can be driven — the
// timer path alone leaves it untested, which is where a real defect would hide.
const pubsub = vi.hoisted(() => ({ handlers: new Map<string, (data: unknown) => void>() }));
vi.mock("../../../src/composables/usePubSub", () => ({
  usePubSub: () => ({
    subscribe: (channel: string, cb: (data: unknown) => void) => {
      pubsub.handlers.set(channel, cb);
      return () => pubsub.handlers.delete(channel);
    },
    onReconnect: () => () => {},
  }),
}));
vi.mock("../../../src/components/cmEditor", async (orig) => {
  const actual = await orig<typeof import("../../../src/components/cmEditor")>();
  return { ...actual, createEditor: (_host: HTMLElement, cb: () => void) => ((onChange = cb), fakeEditor) };
});

function mockFs() {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/list")) return { ok: true, json: async () => ({ entries: [{ name: "README.md", dir: false, size: 10 }] }) };
    if (url.includes("/text")) return { ok: true, json: async () => ({ text: "# hello", version: "v1" }) };
    return { ok: true, json: async () => ({ ok: true, version: "v2" }), _init: init };
  }) as unknown as typeof fetch;
}

const writeCalls = () => (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.filter((c) => String(c[0]).includes("/write"));

async function openFileAndEdit(cwd: string | null = "/proj") {
  const w = mount(FilesPane, { props: { cwd } });
  await flushPromises();
  await w.findAll('[data-testid="files-row"]')[0].trigger("click");
  await flushPromises();
  onChange();
  await flushPromises();
  return w;
}

describe("FilesPane", () => {
  beforeEach(() => {
    fakeEditor.setDoc.mockClear();
    mockFs();
  });

  // The pane beside a zoomed grid cell has no route, no ?cwd= and no "is it open" — it is
  // handed a directory and mounted. That the overlay ALSO uses it is covered by its own spec.
  it("browses and opens a file from nothing but a cwd prop", async () => {
    const w = mount(FilesPane, { props: { cwd: "/proj" } });
    await flushPromises();
    expect(w.text()).toContain("README.md");

    await w.findAll('[data-testid="files-row"]')[0].trigger("click");
    await flushPromises();
    expect(fakeEditor.setDoc).toHaveBeenCalledWith("# hello", "README.md");
    const read = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.find((c) => String(c[0]).includes("/text"));
    expect(String(read?.[0])).toContain(encodeURIComponent("/proj"));
  });

  // The host guards its own navigation on this; a missed event means it guards on a stale answer.
  it("reports the buffer going dirty, and clean again after a save", async () => {
    const w = await openFileAndEdit();
    expect(w.emitted("dirty")?.at(-1)).toEqual([true]);

    await w
      .findAll("button")
      .find((b) => b.text().startsWith("Save"))
      ?.trigger("click");
    await flushPromises();
    expect(w.emitted("dirty")?.at(-1)).toEqual([false]);
  });

  // Bound to the pane's own subtree, not to window: with a pane open beside a terminal, a
  // window-level handler would save whenever the user pressed ⌘S while typing INTO the terminal.
  it("saves on ⌘S inside the pane, and ignores one raised outside it", async () => {
    const w = await openFileAndEdit();
    expect(writeCalls()).toHaveLength(0);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "s", metaKey: true, bubbles: true }));
    await flushPromises();
    expect(writeCalls()).toHaveLength(0);

    await w.trigger("keydown", { key: "s", metaKey: true });
    await flushPromises();
    expect(writeCalls()).toHaveLength(1);
  });

  // Saving on the way out rather than asking: the editor sits beside a terminal being worked
  // in, and the server keeps three generations of whatever a save replaces.
  it("saves the buffer when closing, without asking", async () => {
    const w = await openFileAndEdit();
    const confirmSpy = vi.spyOn(window, "confirm");

    await w.find('[aria-label="Close files"]').trigger("click");
    await flushPromises();
    expect(writeCalls()).toHaveLength(1);
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(w.emitted("close")).toHaveLength(1);
    confirmSpy.mockRestore();
  });

  it("saves the open file before opening another one", async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/list")) {
        return {
          ok: true,
          json: async () => ({
            entries: [
              { name: "README.md", dir: false, size: 10 },
              { name: "other.md", dir: false, size: 10 },
            ],
          }),
        };
      }
      if (url.includes("/text")) return { ok: true, json: async () => ({ text: "# hello", version: "v1" }) };
      return { ok: true, json: async () => ({ ok: true, version: "v2" }), _init: init };
    }) as unknown as typeof fetch;

    const w = mount(FilesPane, { props: { cwd: "/proj" } });
    await flushPromises();
    await w.findAll('[data-testid="files-row"]')[0].trigger("click");
    await flushPromises();
    onChange();
    await flushPromises();

    await w.findAll('[data-testid="files-row"]')[1].trigger("click");
    await flushPromises();
    expect(writeCalls()).toHaveLength(1);
    expect(fakeEditor.setDoc).toHaveBeenLastCalledWith("# hello", "other.md");
  });

  // A save can lose the version race on the way out, and there is nowhere to put a banner by
  // then — so the buffer goes to the backup store and the other writer's file is left alone.
  it("banks the buffer instead of a banner when the parting save hits a conflict", async () => {
    const w = await openFileAndEdit();
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/backup")) return { ok: true, json: async () => ({ stored: true }) };
      if (url.includes("/write")) return { ok: false, status: 409, json: async () => ({ error: "file changed on disk", version: "v9" }) };
      return { ok: true, json: async () => ({ text: "# hello", version: "v1" }) };
    }) as unknown as typeof fetch;

    await (w.vm as unknown as { flush: () => Promise<void> }).flush();
    await flushPromises();
    const calls = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
    expect(calls.some((u) => u.includes("/backup"))).toBe(true);
    expect(w.find('[data-testid="files-conflict"]').exists()).toBe(false);
  });

  // reload() is how the host says "the root changed and I already cleared it with the user" —
  // the pane never reacts to `cwd` itself, or it would discard a buffer still being asked about.
  it("re-reads the tree only when the host calls reload, not when cwd changes", async () => {
    const w = mount(FilesPane, { props: { cwd: "/proj" } });
    await flushPromises();
    const listCalls = () => (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.filter((c) => String(c[0]).includes("/list"));
    expect(listCalls()).toHaveLength(1);

    await w.setProps({ cwd: "/other" });
    await flushPromises();
    expect(listCalls()).toHaveLength(1);

    await (w.vm as unknown as { reload: () => Promise<void> }).reload();
    await flushPromises();
    expect(listCalls()).toHaveLength(2);
    expect(String(listCalls()[1][0])).toContain(encodeURIComponent("/other"));
  });
});

// Leaving happens WHILE the pane is being torn down. Anything flush() reads after its first
// await may already be gone, which is how a parting save's 409 fallback lost the buffer.
describe("FilesPane leaving mid-unmount", () => {
  beforeEach(() => {
    fakeEditor.setDoc.mockClear();
    mockFs();
  });

  it("still banks the buffer when the pane unmounts during the parting save", async () => {
    const w = await openFileAndEdit();
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/backup")) return { ok: true, json: async () => ({ stored: true }) };
      return { ok: false, status: 409, json: async () => ({ error: "file changed on disk", version: "v9" }) };
    }) as unknown as typeof fetch;

    const flushing = (w.vm as unknown as { flush: () => Promise<void> }).flush();
    w.unmount(); // the editor is destroyed while the write is in flight
    await flushing;
    await flushPromises();

    const calls = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
    expect(calls.some((u) => u.includes("/backup"))).toBe(true);
  });

  // Clearing `dirty` on a failed backup would leave the only copy nowhere and say it was fine.
  it("keeps the buffer marked unsaved when neither the save nor the backup lands", async () => {
    const w = await openFileAndEdit();
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ error: "nope" }) })) as unknown as typeof fetch;

    await (w.vm as unknown as { flush: () => Promise<void> }).flush();
    await flushPromises();
    expect(w.emitted("dirty")?.at(-1)).toEqual([true]);
  });

  // No awaiting an answer on the way out of the tab, so the backup goes unconditionally.
  it("banks and writes on pagehide, so a conflict there can't cost the buffer", async () => {
    await openFileAndEdit();
    const before = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    window.dispatchEvent(new Event("pagehide"));
    await flushPromises();

    const calls = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.slice(before).map((c) => String(c[0]));
    expect(calls.some((u) => u.includes("/backup"))).toBe(true);
    expect(calls.some((u) => u.includes("/write"))).toBe(true);
  });
});

// The server being down turns "leave and save" into "leave and lose". Every caller that CAN
// stay has to stay, because at that point the buffer is the only copy in existence.
describe("FilesPane when nothing can be saved or banked", () => {
  const allFail = () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/list"))
        return {
          ok: true,
          json: async () => ({
            entries: [
              { name: "README.md", dir: false, size: 10 },
              { name: "other.md", dir: false, size: 10 },
            ],
          }),
        };
      if (url.includes("/text")) return { ok: true, json: async () => ({ text: "# hello", version: "v1" }) };
      return { ok: false, status: 500, json: async () => ({ error: "server is down" }) };
    }) as unknown as typeof fetch;
  };

  beforeEach(() => {
    fakeEditor.setDoc.mockClear();
    mockFs();
  });

  it("reports it, and stays unsaved, instead of claiming success", async () => {
    const w = await openFileAndEdit();
    allFail();
    expect(await (w.vm as unknown as { flush: () => Promise<boolean> }).flush()).toBe(false);
    expect(w.emitted("dirty")?.at(-1)).toEqual([true]);
    expect(w.text()).toContain("server is down");
  });

  it("does not open another file over the top of it", async () => {
    allFail(); // reads still work; writes and backups do not
    const w = mount(FilesPane, { props: { cwd: "/proj" } });
    await flushPromises();
    await w.findAll('[data-testid="files-row"]')[0].trigger("click");
    await flushPromises();
    onChange();
    await flushPromises();

    fakeEditor.setDoc.mockClear();
    await w.findAll('[data-testid="files-row"]')[1].trigger("click");
    await flushPromises();
    expect(fakeEditor.setDoc).not.toHaveBeenCalled(); // still on the file with the edits
  });

  it("does not close", async () => {
    const w = await openFileAndEdit();
    allFail();
    await w.find('[aria-label="Close files"]').trigger("click");
    await flushPromises();
    expect(w.emitted("close")).toBeUndefined();
  });

  // "Kept as a backup either way" is the banner's promise; a store that refuses the write
  // means the honest move is to keep the buffer rather than discard it anyway.
  it("refuses to discard on the conflict banner when the backup is refused", async () => {
    const w = await openFileAndEdit();
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/backup")) return { ok: false, status: 500, json: async () => ({ error: "no room" }) };
      if (url.includes("/write")) return { ok: false, status: 409, json: async () => ({ error: "file changed on disk", version: "v9" }) };
      return { ok: true, json: async () => ({ text: "# hello", version: "v1" }) };
    }) as unknown as typeof fetch;

    await w
      .findAll("button")
      .find((b) => b.text().startsWith("Save"))
      ?.trigger("click");
    await flushPromises();
    fakeEditor.setDoc.mockClear();

    await w
      .findAll("button")
      .find((b) => b.text().startsWith("Reload"))
      ?.trigger("click");
    await flushPromises();
    expect(fakeEditor.setDoc).not.toHaveBeenCalled(); // the buffer is still there
    expect(w.text()).toContain("could not back up your version");
  });
});

// Coming back to a directory should look the way it was left. Only saved state is restored —
// the buffer went to disk (or the backup store) on the way out.
describe("FilesPane restoring a remembered tree", () => {
  const nestedFs = () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/list")) {
        const p = new URL(url, "https://x").searchParams.get("path");
        if (p === "")
          return {
            ok: true,
            json: async () => ({
              entries: [
                { name: "src", dir: true, size: 0 },
                { name: "README.md", dir: false, size: 10 },
              ],
            }),
          };
        if (p === "src") return { ok: true, json: async () => ({ entries: [{ name: "deep", dir: true, size: 0 }] }) };
        return { ok: true, json: async () => ({ entries: [{ name: "app.ts", dir: false, size: 5 }] }) };
      }
      if (url.includes("/text")) return { ok: true, json: async () => ({ text: "# hello", version: "v1" }) };
      return { ok: true, json: async () => ({ ok: true, version: "v2" }) };
    }) as unknown as typeof fetch;
  };

  beforeEach(() => {
    fakeEditor.setDoc.mockClear();
    nestedFs();
  });

  it("re-opens the remembered directories, parents first, and the file", async () => {
    const w = mount(FilesPane, {
      props: { cwd: "/proj", initialState: { openPath: "src/deep/app.ts", expanded: ["src/deep", "src"] } },
    });
    await flushPromises();

    // The nested directory could only be opened after its parent was fetched.
    expect(w.text()).toContain("app.ts");
    expect(fakeEditor.setDoc).toHaveBeenCalledWith("# hello", "app.ts");
  });

  it("skips anything that has since gone, without failing the rest", async () => {
    const w = mount(FilesPane, {
      props: { cwd: "/proj", initialState: { openPath: null, expanded: ["gone", "src"] } },
    });
    await flushPromises();
    expect(w.text()).toContain("deep"); // src still opened
  });

  // Regression: #1979. When the pane opens from a terminal link click, openFile() races with
  // restore() — the click fires loadFile during restore's async directory expansion, and without
  // the per-start baseline guard the remembered file overwrites the clicked one.
  // The test blocks the /list response for `src` so restore is paused in toggleDir(), then calls
  // openFile while restore is waiting, and finally releases the response to let restore finish.
  it("shows the clicked file, not the remembered one, when openFile races with restore (#1979)", async () => {
    let releaseSrcList!: () => void;
    const srcListGate = new Promise<void>((resolve) => (releaseSrcList = resolve));
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/list")) {
        const p = new URL(url, "https://x").searchParams.get("path");
        if (p === "")
          return {
            ok: true,
            json: async () => ({
              entries: [
                { name: "src", dir: true, size: 0 },
                { name: "README.md", dir: false, size: 10 },
              ],
            }),
          };
        if (p === "src") {
          await srcListGate;
          return { ok: true, json: async () => ({ entries: [{ name: "deep", dir: true, size: 0 }] }) };
        }
        return { ok: true, json: async () => ({ entries: [{ name: "app.ts", dir: false, size: 5 }] }) };
      }
      if (url.includes("/text")) return { ok: true, json: async () => ({ text: "# hello", version: "v1" }) };
      return { ok: true, json: async () => ({ ok: true, version: "v2" }) };
    }) as unknown as typeof fetch;

    const w = mount(FilesPane, {
      props: { cwd: "/proj", initialState: { openPath: "README.md", expanded: ["src"] } },
    });
    await flushPromises(); // restore starts and blocks on srcListGate inside toggleDir("src")

    // The click arrives while restore is paused.
    await (w.vm as unknown as { openFile: (p: string) => Promise<void> }).openFile("src/deep/app.ts");

    // Release restore — it finishes toggleDir and reaches the openPath guard.
    releaseSrcList();
    await flushPromises();

    expect(fakeEditor.setDoc.mock.calls.at(-1)?.[1]).toBe("app.ts");
  });

  it("reports what to remember", async () => {
    const w = mount(FilesPane, { props: { cwd: "/proj", initialState: { openPath: "README.md", expanded: ["src"] } } });
    await flushPromises();
    expect((w.vm as unknown as { snapshot: () => unknown }).snapshot()).toEqual({ openPath: "README.md", expanded: ["src"] });
  });
});

// The file moves under the editor as a matter of course here: the agent working in this
// directory edits the same files. The 409 on save is the hard guarantee; these two paths only
// get the news out before the user has typed into a file that already moved.
describe("FilesPane noticing an external change", () => {
  const serveVersion = (version: string | null, text = "# from the agent") => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/version")) return { ok: true, json: async () => ({ version }) };
      if (url.includes("/list")) return { ok: true, json: async () => ({ entries: [{ name: "README.md", dir: false, size: 10 }] }) };
      if (url.includes("/text")) return { ok: true, json: async () => ({ text, version }) };
      return { ok: true, json: async () => ({ ok: true, version: "v2" }) };
    }) as unknown as typeof fetch;
  };
  const check = async (w: ReturnType<typeof mount>) => {
    await (w.vm as unknown as { checkForExternalChange?: () => Promise<void> }).checkForExternalChange?.();
    vi.advanceTimersByTime(30_000);
    await flushPromises();
  };

  beforeEach(() => {
    fakeEditor.setDoc.mockClear();
    mockFs();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => vi.useRealTimers());

  it("silently takes the new content when nothing is being edited", async () => {
    const w = mount(FilesPane, { props: { cwd: "/proj" } });
    await flushPromises();
    await w.findAll('[data-testid="files-row"]')[0].trigger("click");
    await flushPromises();
    fakeEditor.setDoc.mockClear();

    serveVersion("v9");
    await check(w);
    expect(fakeEditor.setDoc).toHaveBeenCalledWith("# from the agent", "README.md");
    expect(w.find('[data-testid="files-conflict"]').exists()).toBe(false); // nothing to ask about
  });

  it("raises the banner instead of overwriting what is being edited", async () => {
    const w = await openFileAndEdit();
    fakeEditor.setDoc.mockClear();

    serveVersion("v9");
    await check(w);
    expect(w.find('[data-testid="files-conflict"]').exists()).toBe(true);
    expect(fakeEditor.setDoc).not.toHaveBeenCalled(); // the buffer is untouched
  });

  it("does nothing while the version still matches", async () => {
    const w = mount(FilesPane, { props: { cwd: "/proj" } });
    await flushPromises();
    await w.findAll('[data-testid="files-row"]')[0].trigger("click");
    await flushPromises();
    fakeEditor.setDoc.mockClear();

    serveVersion("v1"); // the version it was loaded at
    await check(w);
    expect(fakeEditor.setDoc).not.toHaveBeenCalled();
  });
});

// The hook path is the one that makes this feel immediate; the 30s timer is only the backstop.
describe("FilesPane reacting to the write hook", () => {
  const fire = (file: string) => pubsub.handlers.get("file-write")?.({ file });

  // The file is opened at v1, and only THEN does the agent rewrite it — anything else would be
  // "no change" and prove nothing.
  const server = { version: "v1", text: "# hello" };

  beforeEach(() => {
    fakeEditor.setDoc.mockClear();
    pubsub.handlers.clear();
    server.version = "v1";
    server.text = "# hello";
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/version")) return { ok: true, json: async () => ({ version: server.version }) };
      if (url.includes("/list")) return { ok: true, json: async () => ({ entries: [{ name: "README.md", dir: false, size: 10 }] }) };
      if (url.includes("/text")) return { ok: true, json: async () => ({ text: server.text, version: server.version }) };
      return { ok: true, json: async () => ({ ok: true, version: "v2" }) };
    }) as unknown as typeof fetch;
  });

  const openReadme = async () => {
    const w = mount(FilesPane, { props: { cwd: "/proj" } });
    await flushPromises();
    await w.findAll('[data-testid="files-row"]')[0].trigger("click");
    await flushPromises();
    fakeEditor.setDoc.mockClear();
    // The agent rewrites it while it sits open.
    server.version = "v9";
    server.text = "# from the agent";
    return w;
  };

  it("takes the new content as soon as the agent's write is announced", async () => {
    const w = await openReadme();
    fire("/proj/README.md");
    await flushPromises();
    expect(fakeEditor.setDoc).toHaveBeenCalledWith("# from the agent", "README.md");
    w.unmount();
  });

  it("ignores a write to some other file", async () => {
    const w = await openReadme();
    fire("/proj/somewhere/else.ts");
    await flushPromises();
    expect(fakeEditor.setDoc).not.toHaveBeenCalled();
    w.unmount();
  });

  it("stops listening once the pane is gone", async () => {
    const w = await openReadme();
    w.unmount();
    expect(pubsub.handlers.has("file-write")).toBe(false);
  });
});

// #910 regression. The tree and the open file are independent fetches, and until a path could
// be clicked in terminal output nothing ever started them at the same time. Sharing one
// "latest request wins" counter meant the file load cancelled the tree's own result: the pane
// showed the file next to "Empty directory.", and stayed that way. Caught by running the app,
// not by any test — so this is the test.
describe("opening a file while the tree is still loading", () => {
  let releaseList: (() => void) | null = null;

  beforeEach(() => {
    releaseList = null;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/list")) {
        // Hold the tree response open so the file load below is genuinely concurrent.
        await new Promise<void>((resolve) => (releaseList = resolve));
        return { ok: true, json: async () => ({ entries: [{ name: "src", dir: true, size: 0 }] }) };
      }
      return { ok: true, json: async () => ({ text: "export const x = 1;", version: "v1" }) };
    }) as unknown as typeof fetch;
  });

  it("keeps the tree — the file load must not cancel it", async () => {
    const w = mount(FilesPane, { props: { cwd: "/proj" } });
    await flushPromises();
    // The click in terminal output lands before the tree has answered.
    await (w.vm as unknown as { openFile: (p: string) => Promise<void> }).openFile("src/main.ts");
    await flushPromises();
    releaseList?.();
    await flushPromises();

    expect(fakeEditor.setDoc).toHaveBeenCalledWith("export const x = 1;", "main.ts");
    expect(w.findAll('[data-testid="files-row"]')).toHaveLength(1);
    expect(w.text()).not.toContain("Empty directory");
    w.unmount();
  });
});

// The Canvas button (#1374). What it is gated on matters twice over: it decides whether the
// button is offered at all, and it has to agree with the card TerminalGrid builds from the same
// row — a button that appears and does nothing is worse than no button.
// `showError` is how a host says why an action the pane STARTED could not finish (#1941). It is
// announced, not merely painted: the message arrives after an async round trip, so a reader who is
// not watching this pane would otherwise get the same silence the feature exists to remove.
describe("showError", () => {
  it("announces the message in a live region", async () => {
    mockFs();
    const w = mount(FilesPane, { props: { cwd: "/proj" } });
    await flushPromises();
    expect(w.find('[data-testid="files-error"]').exists()).toBe(false);

    w.vm.showError("File not found: stories/x.json");
    await flushPromises();
    const shown = w.find('[data-testid="files-error"]');
    expect(shown.text()).toBe("File not found: stories/x.json");
    expect(shown.attributes("role")).toBe("alert");
  });
});

describe("the Canvas button", () => {
  const withEntry = (name: string) => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/list")) return { ok: true, json: async () => ({ entries: [{ name, dir: false, size: 10 }] }) };
      return { ok: true, json: async () => ({ text: "x", version: "v1" }) };
    }) as unknown as typeof fetch;
  };

  const openRow = async (name: string, cwd: string | null, canvasTarget = true, workspace: string | null = null) => {
    // The pane takes the pair now (#1933); these cases are all the pre-named-root world, where the
    // workspace's own stories directory is the only root there is.
    withEntry(name);
    const w = mount(FilesPane, { props: { cwd, canvasTarget, storiesRoots: { workspaces: workspace ? [workspace] : [], roots: [] } } });
    await flushPromises();
    await w.findAll('[data-testid="files-row"]')[0].trigger("click");
    await flushPromises();
    return w;
  };

  const btn = (w: Awaited<ReturnType<typeof openRow>>) => w.find('[data-testid="files-canvas-btn"]');

  it("is offered for a file the Canvas can render, and hands back the row's own path", async () => {
    const w = await openRow("design.md", "/work/proj");
    expect(btn(w).exists()).toBe(true);
    await btn(w).trigger("click");
    // Relative: the grid joins it under the same cwd this pane resolves against.
    expect(w.emitted("open-in-canvas")).toEqual([["design.md"]]);
  });

  it("is not offered for a file no plugin renders", async () => {
    expect(btn(await openRow("notes.txt", "/work/proj")).exists()).toBe(false);
  });

  // FilesOverlay mounts this pane full-screen, where there is no enlarged cell to put a Canvas
  // beside — so the button must not appear even for a file that would render.
  it("is not offered without a cell to open it beside", async () => {
    expect(btn(await openRow("design.md", "/work/proj", false)).exists()).toBe(false);
  });

  // A story is the one file judged by WHERE it is rather than what it is called: the plugin only
  // takes a workspace-relative `stories/…`, so a project cell's own artifacts/stories holds files
  // it would not open. Same name, same shape, two different answers.
  it("is offered for a story in the workspace and withheld for one outside it", async () => {
    expect(btn(await openRow("tale.json", "/work/ws/artifacts/stories", true, "/work/ws")).exists()).toBe(true);
    expect(btn(await openRow("tale.json", "/work/other/artifacts/stories", true, "/work/ws")).exists()).toBe(false);
  });

  // The gate runs on the JOINED path, not the row's. `p.html` passes on its own and fails under a
  // directory with a dot segment, which the plugin's iframe mount refuses — so offering it there
  // would be offering a click that silently does nothing.
  it("is withheld when the cell's own directory is what the plugin refuses", async () => {
    expect(btn(await openRow("p.html", "/home/me/proj")).exists()).toBe(true);
    expect(btn(await openRow("p.html", "/home/me/.config/proj")).exists()).toBe(false);
  });
});
