import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { effectScope } from "vue";
import { currentGitlabHosts, useAppConfig } from "../../../src/composables/useAppConfig";
import { globalHeaderStatusColors, globalHeaderStatusTint } from "../../../src/composables/headerStatusColors";
import { DEFAULT_HEADER_STATUS_TINT } from "../../../common/headerStatusColors";

// Where the server keeps the worktrees it created. The GET carries it (the real /api/config does,
// alongside `home`) because that is the only way this side can tell one of ours from a directory
// that merely looks like one — see isManagedWorktreePath.
const WORKTREES_ROOT = "/Users/me/.mulmoterminal/worktrees";

interface Preset {
  label: string;
  path: string;
}

// A stand-in for the SERVER'S list, not an echo of what the client posted — because that is the
// property under test. Recording a directory is a ONE-ENTRY mutation applied on the server
// (`/api/config/cwd-presets/record`), so a client whose own copy is empty or stale cannot send it
// back as the whole list and delete the rest. An echoing fake could not tell the difference
// between the fix and the bug it replaced, which is why it is gone.
//
// `gate` stalls the GET; `snapshot` is what that stalled GET will answer with — taken when it
// STARTS, so a slow response is genuinely stale rather than magically current.
function mockServer(initial: Preset[] = [], opts: { gate?: Promise<void>; get?: Record<string, unknown>; delayMs?: number } = {}) {
  let list: Preset[] = [...initial];
  globalThis.fetch = vi.fn(async (url: string, init?: { body?: string }) => {
    const target = String(url);
    const body: Record<string, unknown> = init?.body ? JSON.parse(init.body) : {};
    if (opts.delayMs && target.startsWith("/api/config/cwd-presets/")) await new Promise((resolve) => setTimeout(resolve, opts.delayMs));
    if (target === "/api/config/cwd-presets/record") {
      const existing = list.find((preset) => preset.path === body.path);
      list = [existing ?? { label: String(body.label), path: String(body.path) }, ...list.filter((preset) => preset.path !== body.path)];
      return { ok: true, json: async () => ({ cwdPresets: list }) };
    }
    if (target === "/api/config/cwd-presets/remove") {
      list = list.filter((preset) => preset.path !== body.path);
      return { ok: true, json: async () => ({ cwdPresets: list }) };
    }
    if (!init?.body) {
      const snapshot = [...list];
      await opts.gate;
      return { ok: true, json: async () => ({ cwdPresets: snapshot, worktreesRoot: WORKTREES_ROOT, ...opts.get }) };
    }
    // POST /api/config — the genuine replace-all: a settings-UI reorder.
    if (Array.isArray(body.cwdPresets)) list = body.cwdPresets as Preset[];
    return { ok: true, json: async () => ({ cwdPresets: list }) };
  }) as unknown as typeof fetch;
  // What ANOTHER mulmoterminal doing its own one-entry write looks like from here.
  return { recordExternally: (preset: Preset) => (list = [preset, ...list.filter((entry) => entry.path !== preset.path)]) };
}

const mockConfigFetch = () => mockServer();

beforeEach(() => {
  localStorage.clear();
  mockConfigFetch();
});

// What the browser keeps of `/api/config`'s stories roots. `canonical` is the spelling the server
// RESOLVED, and the Canvas reads a card's wire path against it to decide what the card is about
// (#1976) — dropping it here would quietly put one deck back on two cards.
describe("useAppConfig — the stories roots off the wire", () => {
  it("keeps the resolved spelling alongside the ones the file is compared against", async () => {
    mockServer([], { get: { storiesRoots: [{ id: "W", canonical: "/private/w", paths: ["/w", "/private/w"] }] } });
    const { storiesRoots, loadConfig } = useAppConfig();
    await loadConfig();
    expect(storiesRoots.value).toEqual([{ id: "W", canonical: "/private/w", paths: ["/w", "/private/w"] }]);
  });

  // A server older than #1976 sends no `canonical`. The root still gates the Files pane's Canvas
  // entry; only the identity resolution stands down, which is the behaviour before that change.
  it("keeps a root that names no resolved spelling", async () => {
    mockServer([], {
      get: {
        storiesRoots: [
          { id: "W", paths: ["/w"] },
          { id: "bad", canonical: 7, paths: ["/x"] },
        ],
      },
    });
    const { storiesRoots, loadConfig } = useAppConfig();
    await loadConfig();
    expect(storiesRoots.value).toEqual([
      { id: "W", paths: ["/w"] },
      { id: "bad", paths: ["/x"] },
    ]);
  });
});

describe("useAppConfig — auto preset recording", () => {
  it("recordPreset prepends a new dir with a basename label", async () => {
    const { presets, recordPreset } = useAppConfig();
    await recordPreset("/home/me/alpha");
    expect(presets.value).toEqual([{ label: "alpha", path: "/home/me/alpha" }]);
  });

  it("moves an already-known dir to the front on reuse (most-recently-used)", async () => {
    const { presets, recordPreset } = useAppConfig();
    await recordPreset("/a/one");
    await recordPreset("/b/two");
    await recordPreset("/a/one"); // reuse → bumps to front
    expect(presets.value.map((p) => p.path)).toEqual(["/a/one", "/b/two"]);
  });

  it("keeps an existing entry's label when bumping it to the front", async () => {
    // Seeded on the SERVER — the label the user gave a directory lives in the file, and it is the
    // server that decides what a record does to it now.
    mockServer([
      { label: "two", path: "/b/two" },
      { label: "Custom", path: "/a/one" }, // a manual label from legacy cwdPresets
    ]);
    const { presets, recordPreset } = useAppConfig();
    await recordPreset("/a/one");
    expect(presets.value).toEqual([
      { label: "Custom", path: "/a/one" },
      { label: "two", path: "/b/two" },
    ]);
  });

  it("does not re-write when the dir is already at the front", async () => {
    const { presets, recordPreset } = useAppConfig();
    await recordPreset("/a");
    const before = vi.mocked(globalThis.fetch).mock.calls.length;
    await recordPreset("/a"); // already most-recent → no POST
    expect(vi.mocked(globalThis.fetch).mock.calls).toHaveLength(before);
    expect(presets.value.map((p) => p.path)).toEqual(["/a"]);
  });

  it("has no cap — keeps every distinct dir, newest first", async () => {
    const { presets, recordPreset } = useAppConfig();
    for (const d of ["/a", "/b", "/c", "/d", "/e", "/f"]) await recordPreset(d);
    expect(presets.value).toHaveLength(6);
    expect(presets.value[0].path).toBe("/f");
  });

  it("ignores a null or empty path", async () => {
    const { presets, recordPreset } = useAppConfig();
    await recordPreset(null);
    await recordPreset("");
    expect(presets.value).toEqual([]);
  });

  // A worktree launches like anywhere else, so every isolated task used to leave a chip behind —
  // for a directory that is one branch for one task and is deleted with it.
  const WORKTREE = `${WORKTREES_ROOT}/myrepo-1a2b3c4d/fix-bug`;

  it("does not record a managed worktree", async () => {
    const { presets, recordPreset, loadConfig } = useAppConfig();
    await loadConfig(); // the root arrives with the config; without it nothing here is a worktree
    await recordPreset(WORKTREE);
    expect(presets.value).toEqual([]);
  });

  it("still records the repository the worktree came from", async () => {
    const { presets, recordPreset, loadConfig } = useAppConfig();
    await loadConfig();
    await recordPreset("/home/me/myrepo");
    await recordPreset(WORKTREE);
    expect(presets.value.map((p) => p.path)).toEqual(["/home/me/myrepo"]);
  });

  // Anchored on the managed root, not on the path's shape: a directory another tool laid out the
  // same way is a real working directory, and dropping it would silently lose it (Codex on #1543).
  it("records a same-shaped directory outside the managed root", async () => {
    const { presets, recordPreset, loadConfig } = useAppConfig();
    await loadConfig();
    await recordPreset("/home/me/dev/worktrees/myrepo-1a2b3c4d/fix-bug");
    expect(presets.value.map((p) => p.path)).toEqual(["/home/me/dev/worktrees/myrepo-1a2b3c4d/fix-bug"]);
  });

  // Saved config is the user's, so an entry an earlier version recorded is left where it is
  // rather than dropped — it just stops being maintained (no bump to the front).
  it("leaves an already-saved worktree entry alone instead of bumping it", async () => {
    mockServer([
      { label: "alpha", path: "/home/me/alpha" },
      { label: "myrepo (fix-bug)", path: WORKTREE },
    ]);
    const { presets, recordPreset, loadConfig } = useAppConfig();
    await loadConfig();
    const before = vi.mocked(globalThis.fetch).mock.calls.length;
    await recordPreset(WORKTREE);
    expect(vi.mocked(globalThis.fetch).mock.calls).toHaveLength(before); // no POST
    expect(presets.value.map((p) => p.path)).toEqual(["/home/me/alpha", WORKTREE]);
  });

  it("removePreset drops the matching path", async () => {
    const { presets, recordPreset, removePreset } = useAppConfig();
    await recordPreset("/a");
    await recordPreset("/b");
    await removePreset("/a");
    expect(presets.value.map((p) => p.path)).toEqual(["/b"]);
  });

  it("imports legacy localStorage recents (recent_dirs_v1) to the FRONT of presets on load, then clears the key", async () => {
    localStorage.setItem("recent_dirs_v1", JSON.stringify(["/r/one", "/r/two"]));
    mockServer([{ label: "kept", path: "/p/kept" }], { get: { cwd: "/w", home: "/h", soundFile: null } });
    const { presets, loadConfig } = useAppConfig();
    await loadConfig();
    expect(presets.value).toEqual([
      { label: "one", path: "/r/one" }, // most-recent legacy dir prepended, ahead of existing
      { label: "two", path: "/r/two" },
      { label: "kept", path: "/p/kept" },
    ]);
    expect(localStorage.getItem("recent_dirs_v1")).toBeNull();
  });

  it("does not duplicate a legacy recent already present, but still clears the key", async () => {
    localStorage.setItem("recent_dirs_v1", JSON.stringify(["/p/kept", "/r/new"]));
    mockServer([{ label: "kept", path: "/p/kept" }], { get: { cwd: "/w", home: "/h", soundFile: null } });
    const { presets, loadConfig } = useAppConfig();
    await loadConfig();
    expect(presets.value.map((p) => p.path)).toEqual(["/r/new", "/p/kept"]);
    expect(localStorage.getItem("recent_dirs_v1")).toBeNull();
  });

  it("loadConfig does not clobber a preset recorded while the initial GET is in flight (#164 review)", async () => {
    let releaseGet: () => void = () => {};
    const getGate = new Promise<void>((r) => {
      releaseGet = r;
    });
    mockServer([], { gate: getGate, get: { cwd: "/w", home: "/h", soundFile: null } });
    const { presets, loadConfig, recordPreset } = useAppConfig();
    const loading = loadConfig(); // GET in flight (stalled)
    await recordPreset("/launched/now"); // user launches before the GET resolves
    releaseGet(); // the stale (empty) GET snapshot now lands
    await loading;
    expect(presets.value.map((p) => p.path)).toEqual(["/launched/now"]);
  });

  // THE BUG THIS PAIR OF ROUTES EXISTS FOR. A launch during (or after a failed) initial GET used
  // to persist "[the one just launched]" as the WHOLE list, and every other saved directory was
  // gone from a file every mulmoterminal on the machine shares — taking the projects whose
  // collections the server serves with it (2026-08-09).
  it("records a directory WITHOUT deleting the ones this tab has never seen", async () => {
    mockServer([
      { label: "mag2", path: "/srv/mag2" },
      { label: "site", path: "/srv/site" },
    ]);
    const { presets, recordPreset } = useAppConfig();
    // No loadConfig: this tab's own list is empty, exactly as it is during the first GET.
    expect(presets.value).toEqual([]);
    await recordPreset("/srv/new");
    expect(presets.value.map((p) => p.path)).toEqual(["/srv/new", "/srv/mag2", "/srv/site"]);
  });

  it("removes one directory WITHOUT deleting the ones this tab has never seen", async () => {
    mockServer([
      { label: "mag2", path: "/srv/mag2" },
      { label: "site", path: "/srv/site" },
    ]);
    const { presets, removePreset } = useAppConfig();
    await removePreset("/srv/mag2");
    expect(presets.value.map((p) => p.path)).toEqual(["/srv/site"]);
  });

  // The legacy import is ADD-ONLY, so it has no business sending a whole list: an authoritative
  // GET describes the instant it completed, and another instance can record a directory before
  // the import's write lands. A replace-all built from the earlier read would delete it.
  it("imports legacy recents without erasing a directory saved meanwhile", async () => {
    localStorage.setItem("recent_dirs_v1", JSON.stringify(["/legacy/one"]));
    const server = mockServer([{ label: "kept", path: "/p/kept" }], { get: { cwd: "/w" } });
    const { presets, loadConfig } = useAppConfig();
    const loading = loadConfig();
    // Another mulmoterminal saves a directory while the import is in flight.
    server.recordExternally({ label: "other", path: "/srv/other" });
    await loading;
    expect(presets.value.map((p) => p.path)).toContain("/srv/other");
    expect(presets.value.map((p) => p.path)).toContain("/legacy/one");
    expect(presets.value.map((p) => p.path)).toContain("/p/kept");
  });

  // A save that fails must lose the RECORD, never the list.
  it("leaves the list alone when the server refuses the record", async () => {
    mockServer([{ label: "mag2", path: "/srv/mag2" }]);
    const { presets, loadConfig, recordPreset } = useAppConfig();
    await loadConfig();
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })) as unknown as typeof fetch;
    await recordPreset("/srv/new");
    expect(presets.value.map((p) => p.path)).toEqual(["/srv/mag2"]);
  });

  // The other side of the test above: a launch that lands before the initial GET has no worktree
  // root to judge by, and deciding without it recorded the very worktree the guard exists to keep
  // out (Codex on #1543). A path with the worktree SHAPE waits for the root; anything else must
  // NOT wait, which is what keeps the #164 guarantee above intact.
  it("does not record a managed worktree launched before the initial config lands", async () => {
    let releaseGet: () => void = () => {};
    const getGate = new Promise<void>((r) => {
      releaseGet = r;
    });
    globalThis.fetch = vi.fn(async (_url: string, init?: { body?: string }) => {
      if (!init?.body) {
        await getGate;
        return { ok: true, json: async () => ({ cwd: "/w", home: "/h", worktreesRoot: WORKTREES_ROOT, cwdPresets: [] }) };
      }
      const body = JSON.parse(init.body);
      return { ok: true, json: async () => ({ cwdPresets: body.cwdPresets ?? [] }) };
    }) as unknown as typeof fetch;
    const { presets, loadConfig, recordPreset } = useAppConfig();
    const loading = loadConfig(); // GET in flight (stalled) — the root is not known yet
    const recording = recordPreset(`${WORKTREES_ROOT}/myrepo-1a2b3c4d/fix-bug`); // deliberately not awaited
    releaseGet();
    await Promise.all([loading, recording]);
    expect(presets.value).toEqual([]);
  });

  // The wait above must happen BEFORE the preset write lock is taken. `loadConfig` finishes with
  // `migrateLegacyRecents`, which needs that same lock — so waiting from inside it made the load
  // and the record wait on each other forever, and only an UPGRADING user (one with legacy recents
  // to import) ever hit it (Codex on #1543). Without the fix this test hangs to its timeout.
  it("does not deadlock the initial load of an upgrading user who launches a worktree", async () => {
    localStorage.setItem("recent_dirs_v1", JSON.stringify(["/legacy/one"]));
    let releaseGet: () => void = () => {};
    const getGate = new Promise<void>((r) => {
      releaseGet = r;
    });
    mockServer([], { gate: getGate, get: { cwd: "/w" } });
    const { presets, loadConfig, recordPreset } = useAppConfig();
    const loading = loadConfig();
    const recording = recordPreset(`${WORKTREES_ROOT}/myrepo-1a2b3c4d/fix-bug`);
    releaseGet();
    await Promise.all([loading, recording]);
    // The legacy import completed; the worktree was still refused.
    expect(presets.value.map((p) => p.path)).toEqual(["/legacy/one"]);
  });

  it("serializes concurrent records so neither write clobbers the other (#163 review)", async () => {
    // Two records in flight at once, against a slow server. The clobber this guarded against is
    // now impossible by construction — the server applies one entry at a time to its own list, so
    // neither request carries the other's absence. Serialization still decides the ORDER, and the
    // guarantee the ticket asked for (both survive) is asserted the same way.
    mockServer([], { delayMs: 5 });
    const { presets, recordPreset } = useAppConfig();
    await Promise.all([recordPreset("/a"), recordPreset("/b")]);
    expect(presets.value.map((p) => p.path).sort()).toEqual(["/a", "/b"]);
  });
});

// A saver reads the server's ECHO back into its ref. When the reader that validates that echo
// disagrees with the real interface, every entry is filtered out and the list silently EMPTIES on
// save — which is what a wrong field name did here (Codex review on #1294).
describe("useAppConfig — a save keeps what the server echoed", () => {
  // Echo whatever was posted, as the real /api/config does for a partial update.
  function echoPosted() {
    globalThis.fetch = vi.fn(async (_url: string, init?: { body?: string }) => {
      const body: Record<string, unknown> = init?.body ? JSON.parse(init.body) : {};
      return { ok: true, json: async () => body };
    }) as unknown as typeof fetch;
  }

  beforeEach(echoPosted);

  it("keeps quick commands after saving them", async () => {
    const { quickCommands, saveQuickCommands } = useAppConfig();
    const next = [{ label: "Deploy", text: "/deploy" }];
    expect(await saveQuickCommands(next)).toBe(true);
    expect(quickCommands.value).toEqual(next);
  });

  it("keeps user MCP servers after saving them", async () => {
    const { userMcpServers, saveUserMcpServers } = useAppConfig();
    const next = [{ id: "docs", url: "https://example.test/mcp" }];
    expect(await saveUserMcpServers(next)).toBe(true);
    expect(userMcpServers.value).toEqual(next);
  });

  it("keeps launchers and pr repos after saving them", async () => {
    const { launchers, saveLaunchers, prRepos, savePrRepos } = useAppConfig();
    expect(await saveLaunchers([{ label: "zsh", command: "/bin/zsh" }])).toBe(true);
    expect(launchers.value).toEqual([{ label: "zsh", command: "/bin/zsh" }]);
    expect(await savePrRepos(["receptron/mulmoterminal"])).toBe(true);
    expect(prRepos.value).toEqual(["receptron/mulmoterminal"]);
  });
});

// loadConfig runs on every page open, and it used to take the server's arrays at face value while
// the SAVE paths filtered them through isLauncher/isQuickCommand/isUserMcpServer. A config file
// that was hand-edited (or written by an older version) therefore loaded entries the rest of the
// app assumes are well-formed — a launcher with no `command`, a quick command with no `text`.
describe("useAppConfig — loadConfig validates what the server sends", () => {
  function mockConfigGet(payload: Record<string, unknown>) {
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => payload })) as unknown as typeof fetch;
  }

  it("keeps well-formed entries and drops malformed ones, per list", async () => {
    mockConfigGet({
      launchers: [{ label: "shell", command: "zsh" }, { label: "broken" }, "not an object"],
      quickCommands: [{ label: "hi", text: "hello" }, { label: "no text" }],
      userMcpServers: [{ id: "a", url: "https://x" }, { id: "b" }],
      pushKinds: ["finished", "not-a-kind"],
      prRepos: ["owner/repo", 42],
      cwdPresets: [{ label: "proj", path: "/p" }, { label: "no path" }],
    });
    const { loadConfig, launchers, quickCommands, userMcpServers, pushKinds, prRepos, presets } = useAppConfig();

    await loadConfig();

    expect(launchers.value).toEqual([{ label: "shell", command: "zsh" }]);
    expect(quickCommands.value).toEqual([{ label: "hi", text: "hello" }]);
    expect(userMcpServers.value).toEqual([{ id: "a", url: "https://x" }]);
    expect(pushKinds.value).toEqual(["finished"]);
    expect(prRepos.value).toEqual(["owner/repo"]);
    expect(presets.value).toEqual([{ label: "proj", path: "/p" }]);
  });

  // The declared self-hosted GitLab hosts (#1332). config.json-only, so the browser can never write
  // them — but it decides from them (an issue row on such a host can start work), and without this
  // adoption that decision is made against an empty list on every page.
  it("adopts the declared gitlab hosts, dropping anything that is not a string", async () => {
    mockConfigGet({ gitlabHosts: ["gitlab.hogefuga.com", 42] });
    const { loadConfig } = useAppConfig();

    await loadConfig();

    expect(currentGitlabHosts()).toEqual(["gitlab.hogefuga.com"]);
  });

  // The GLOBAL half of #1617. TerminalCell's own specs set the singleton directly, so they prove
  // the cell READS it and would all still pass if this hydration were deleted and /api/config
  // stopped filling it — the whole feature would be dead with a green suite. (Codex review on
  // #1619 asked for exactly this.)
  it("hydrates the header status defaults from /api/config", async () => {
    mockConfigGet({ headerStatusColors: { working: "#166534" }, headerStatusTint: "none" });
    const { loadConfig } = useAppConfig();
    await loadConfig();

    expect(globalHeaderStatusColors.value).toEqual({ working: { background: "#166534", text: null } });
    expect(globalHeaderStatusTint.value).toBe("none");
  });

  // And a config that says nothing must leave the built-ins in place rather than an empty tint,
  // which would read as a mode nothing paints.
  it("falls back to the built-in tint when the config names none", async () => {
    mockConfigGet({ headerStatusColors: { working: "#166534" }, headerStatusTint: "none" });
    const { loadConfig } = useAppConfig();
    await loadConfig();

    mockConfigGet({});
    await loadConfig();

    expect(globalHeaderStatusColors.value).toEqual({});
    expect(globalHeaderStatusTint.value).toBe(DEFAULT_HEADER_STATUS_TINT);
  });

  // A body that is not a JSON object at all must leave what is already shown alone rather than
  // throw past the caller — loadConfig is fire-and-forget on mount. The refs are module-level
  // singletons, so "unchanged" is the observable behaviour, not "empty".
  it("survives a non-object body and leaves the current lists alone", async () => {
    mockConfigGet({ launchers: [{ label: "shell", command: "zsh" }] });
    const { loadConfig, launchers } = useAppConfig();
    await loadConfig();
    const before = [...launchers.value];

    mockConfigGet([] as unknown as Record<string, unknown>);
    await expect(loadConfig()).resolves.toBeUndefined();

    expect(launchers.value).toEqual(before);
  });
});

// A page that loads while the backend is restarting gets NOTHING from /api/config — and nothing
// re-read it, so the launcher showed no saved directories for as long as that tab stayed open. In
// this repo's own dev loop that is the common case rather than the rare one: Vite keeps serving
// the page from its own port and answers the proxied /api with a 502 for the seconds the backend
// takes to come back.
describe("useAppConfig — loadConfig retries a request that failed", () => {
  // The fetches a run made, so a test can say how many attempts happened rather than only what
  // landed. `answers` is consumed one per call; the last one repeats.
  function mockAttempts(...answers: Array<{ ok: boolean; body?: unknown }>) {
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (url: string) => {
      calls.push(String(url));
      const answer = answers[Math.min(calls.length - 1, answers.length - 1)];
      if (!answer.ok) throw new Error("ECONNREFUSED");
      return { ok: true, json: async () => answer.body ?? {} };
    }) as unknown as typeof fetch;
    return calls;
  }

  const DOWN = { ok: false };
  const UP = (body: unknown) => ({ ok: true, body });

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("fills the launcher in once the backend comes back", async () => {
    const calls = mockAttempts(DOWN, DOWN, UP({ cwdPresets: [{ label: "proj", path: "/p" }] }));
    const { loadConfig, presets } = useAppConfig();

    await loadConfig();
    expect(presets.value).toEqual([]); // the state the bug left behind — now temporary

    await vi.advanceTimersByTimeAsync(1_500);

    expect(presets.value).toEqual([{ label: "proj", path: "/p" }]);
    expect(calls).toHaveLength(3);
  });

  // A retry that the caller had to await would make `onMounted(loadConfig)` block a mount on a
  // server that may never answer.
  it("returns from the first attempt instead of awaiting the chain", async () => {
    mockAttempts(DOWN, UP({ cwdPresets: [{ label: "proj", path: "/p" }] }));
    const { loadConfig, presets } = useAppConfig();

    await expect(loadConfig()).resolves.toBeUndefined();
    expect(presets.value).toEqual([]);
  });

  it("stops rather than polling a server that is down for good", async () => {
    const calls = mockAttempts(DOWN);
    const { loadConfig } = useAppConfig();

    await loadConfig();
    await vi.advanceTimersByTimeAsync(120_000);

    expect(calls).toHaveLength(10); // the initial attempt plus the nine retries
  });

  // A 200 is the server's real answer even when the body is unusable. Retrying re-reads the same
  // body, and this spec is also what keeps the other loadConfig tests from leaving a chain running
  // into the next one.
  it("does not retry a body of the wrong shape", async () => {
    const calls = mockAttempts(UP([]));
    const { loadConfig } = useAppConfig();

    await loadConfig();
    await vi.advanceTimersByTimeAsync(120_000);

    expect(calls).toHaveLength(1);
  });

  // The same rule one step earlier: a body that will not PARSE at all. The wrong-shape test above
  // cannot see this — its `json()` resolves — and with one `try` around the whole read this case
  // came out the far side as a failed request and armed the chain (Codex on #1771).
  it("does not retry a body that will not parse", async () => {
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (url: string) => {
      calls.push(String(url));
      return {
        ok: true,
        json: async () => {
          throw new SyntaxError("Unexpected end of JSON input");
        },
      };
    }) as unknown as typeof fetch;
    const { loadConfig } = useAppConfig();

    await expect(loadConfig()).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(120_000);

    expect(calls).toHaveLength(1);
  });

  // A non-2xx IS retryable, and it is the shape the dev proxy answers with while the backend is
  // restarting (502, with a text/plain body that never reaches `json()`).
  it("retries a 502 from the dev proxy", async () => {
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (url: string) => {
      calls.push(String(url));
      return calls.length === 1 ? { ok: false, status: 502 } : { ok: true, json: async () => ({ cwdPresets: [{ label: "proj", path: "/p" }] }) };
    }) as unknown as typeof fetch;
    const { loadConfig, presets } = useAppConfig();

    await loadConfig();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(presets.value).toEqual([{ label: "proj", path: "/p" }]);
    expect(calls).toHaveLength(2);
  });

  // Silence for half a minute and then silence forever is the same empty launcher this whole
  // change exists to explain. When the retries give up, the shell gets something to render.
  it("reports the config as unavailable only once the retries give up", async () => {
    mockAttempts(DOWN);
    const { loadConfig, configUnavailable } = useAppConfig();

    await loadConfig();
    expect(configUnavailable.value).toBe(false); // still trying — nothing to tell the user yet

    await vi.advanceTimersByTimeAsync(120_000);
    expect(configUnavailable.value).toBe(true);
  });

  it("takes the notice back when a later read succeeds", async () => {
    mockAttempts(DOWN);
    const { loadConfig, configUnavailable } = useAppConfig();
    await loadConfig();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(configUnavailable.value).toBe(true);

    mockAttempts(UP({ cwdPresets: [{ label: "proj", path: "/p" }] }));
    await loadConfig();

    expect(configUnavailable.value).toBe(false);
  });

  it("abandons the chain when the scope that started it goes away", async () => {
    const calls = mockAttempts(DOWN);
    const scope = effectScope();
    await scope.run(async () => {
      const { loadConfig } = useAppConfig();
      await loadConfig();
    });

    scope.stop();
    await vi.advanceTimersByTimeAsync(120_000);

    expect(calls).toHaveLength(1);
  });

  // The same hazard one step in: an attempt that is ALREADY IN FLIGHT when a newer load answers.
  // It is aborted, but a response that had landed before the abort would otherwise be adopted on
  // top of the fresh one — and the module-level singletons (launchers, quick commands, the global
  // settings) have no version guard of their own to catch it (Codex on #1771).
  it("does not adopt an answer that arrived after a newer load overtook it", async () => {
    let releaseStale: () => void = () => {};
    const stalled = new Promise<void>((resolve) => (releaseStale = resolve));
    let call = 0;
    globalThis.fetch = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        await stalled;
        return { ok: true, json: async () => ({ launchers: [{ label: "stale", command: "old" }] }) };
      }
      return { ok: true, json: async () => ({ launchers: [{ label: "fresh", command: "new" }] }) };
    }) as unknown as typeof fetch;

    const { loadConfig, launchers } = useAppConfig();
    const first = loadConfig();
    await loadConfig();
    expect(launchers.value).toEqual([{ label: "fresh", command: "new" }]);

    releaseStale();
    await first;
    await vi.advanceTimersByTimeAsync(120_000);

    expect(launchers.value).toEqual([{ label: "fresh", command: "new" }]);
  });

  // Two chains writing the same refs is how a stale answer lands on top of a fresh one. A remount
  // (or an HMR update, which re-runs the shell's setup) is the case that produces it.
  it("lets a later load supersede the chain an earlier one left running", async () => {
    const calls = mockAttempts(DOWN);
    const { loadConfig, presets } = useAppConfig();
    await loadConfig();

    mockAttempts(UP({ cwdPresets: [{ label: "fresh", path: "/fresh" }] }));
    await loadConfig();
    await vi.advanceTimersByTimeAsync(120_000);

    expect(presets.value).toEqual([{ label: "fresh", path: "/fresh" }]);
    expect(calls).toHaveLength(1); // the abandoned chain never fired again
  });
});
