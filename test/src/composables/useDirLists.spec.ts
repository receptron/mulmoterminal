import { describe, it, expect, vi, beforeEach } from "vitest";
import { useResumableSessions, useDirScripts, useDirWorktrees } from "../../../src/composables/useDirLists";
import { dirKeyOf } from "../../../src/composables/dirAddress";

// The three launcher lists share one loader, so the hazards are tested once each: a superseded
// answer must not land, a refused read must not keep the previous directory's rows, and no
// directory must not fetch at all.

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const ok = (json: unknown) => ({ ok: true, json: async () => json });

beforeEach(() => {
  globalThis.fetch = vi.fn(async () => ok({})) as unknown as typeof fetch;
});

describe("useResumableSessions", () => {
  it("lists the sessions and the cwd they were resolved for", async () => {
    globalThis.fetch = vi.fn(async () => ok({ sessions: [{ id: "a", title: "one", mtime: 1 }], cwd: "/resolved" })) as unknown as typeof fetch;
    const { value, load } = useResumableSessions();
    await load("/typed", "claude");
    expect(value.value).toEqual({ sessions: [{ id: "a", title: "one", mtime: 1 }], cwd: "/resolved" });
  });

  it("falls back to the requested dir when the server doesn't name one", async () => {
    globalThis.fetch = vi.fn(async () => ok({ sessions: [] })) as unknown as typeof fetch;
    const { value, load } = useResumableSessions();
    await load("/asked", "claude");
    expect(value.value.cwd).toBe("/asked");
  });

  it("empties the list — and forgets the cwd — when there is no dir to ask about", async () => {
    globalThis.fetch = vi.fn(async () => ok({ sessions: [{ id: "a", title: "one", mtime: 1 }], cwd: "/x" })) as unknown as typeof fetch;
    const { value, load } = useResumableSessions();
    await load("/x", "claude");
    await load(null, "claude");
    expect(value.value).toEqual({ sessions: [], cwd: null });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  // The reason every one of these carries a request token: typing a path fires a read per
  // keystroke, and the answers can come back in any order.
  it("drops an answer a newer request has superseded", async () => {
    const slow = deferred<ReturnType<typeof ok>>();
    globalThis.fetch = vi.fn(async (url: string) =>
      String(url).includes("slow") ? slow.promise : ok({ sessions: [{ id: "fast", title: "fast", mtime: 2 }], cwd: "/fast" }),
    ) as unknown as typeof fetch;

    const { value, load } = useResumableSessions();
    const first = load("/slow", "claude");
    await load("/fast", "claude");
    slow.resolve(ok({ sessions: [{ id: "stale", title: "stale", mtime: 1 }], cwd: "/slow" }));
    await first;

    expect(value.value).toEqual({ sessions: [{ id: "fast", title: "fast", mtime: 2 }], cwd: "/fast" });
  });

  // #1372: the rows have to go when the FIELD changes, not when the replacement lands. Until then
  // they are the previous directory's, and clicking one resumes exactly the session it names.
  it("empties the rows and reports loading the moment the dir is forgotten", async () => {
    globalThis.fetch = vi.fn(async () => ok({ sessions: [{ id: "a", title: "one", mtime: 1 }], cwd: "/x" })) as unknown as typeof fetch;
    const { value, loading, forget, load } = useResumableSessions();
    await load("/x", "claude");
    expect(loading.value).toBe(false);
    forget();
    expect(value.value).toEqual({ sessions: [], cwd: null });
    expect(loading.value).toBe(true);
  });

  it("drops an answer that was already in flight when the dir was forgotten", async () => {
    const slow = deferred<ReturnType<typeof ok>>();
    globalThis.fetch = vi.fn(async () => slow.promise) as unknown as typeof fetch;
    const { value, load, forget } = useResumableSessions();
    const pending = load("/slow", "claude");
    forget();
    slow.resolve(ok({ sessions: [{ id: "stale", title: "stale", mtime: 1 }], cwd: "/slow" }));
    await pending;
    expect(value.value).toEqual({ sessions: [], cwd: null });
  });

  it("empties the rows before it fetches, and stops loading when the answer lands", async () => {
    globalThis.fetch = vi.fn(async (url: string) => {
      const cwd = new URL(String(url), "http://localhost").searchParams.get("cwd");
      return ok({ sessions: [{ id: `s:${cwd}`, title: "one", mtime: 1 }], cwd });
    }) as unknown as typeof fetch;
    const { value, loading, load } = useResumableSessions();
    await load("/x", "claude");
    const next = load("/y", "claude");
    // Not awaited: /x's row is gone already, rather than standing there until /y answers.
    expect(value.value).toEqual({ sessions: [], cwd: null });
    expect(loading.value).toBe(true);
    await next;
    expect(value.value.cwd).toBe("/y");
    expect(loading.value).toBe(false);
  });

  it("is not left loading when there is no dir to ask about", async () => {
    const { loading, forget, load } = useResumableSessions();
    forget();
    await load(null, "claude");
    expect(loading.value).toBe(false);
  });

  // The flag follows the same rule as the value: the newest request owns it. A superseded one
  // clearing it would say "loaded" while the request that replaced it is still in flight.
  it("leaves the flag to the request that superseded this one", async () => {
    const slow = deferred<ReturnType<typeof ok>>();
    const stillPending = deferred<ReturnType<typeof ok>>();
    globalThis.fetch = vi.fn(async (url: string) => (String(url).includes("slow") ? slow.promise : stillPending.promise)) as unknown as typeof fetch;
    const { loading, load } = useResumableSessions();
    const first = load("/slow", "claude");
    const newer = load("/newer", "claude");
    slow.resolve(ok({ sessions: [], cwd: "/slow" }));
    await first;
    expect(loading.value).toBe(true);
    stillPending.resolve(ok({ sessions: [], cwd: "/newer" }));
    await newer;
    expect(loading.value).toBe(false);
  });

  // #1417: the list is per AGENT as well as per directory. Every agent keeps its history in its
  // own store, so asking the wrong route offers conversations the picked agent cannot resume —
  // which is what this did for codex, agy and grok until the route became a function of the agent.
  it("asks each agent's own route", async () => {
    const urls: string[] = [];
    globalThis.fetch = vi.fn(async (url: string) => {
      urls.push(String(url));
      return ok({ sessions: [], cwd: "/x" });
    }) as unknown as typeof fetch;
    const { load } = useResumableSessions();
    await load("/x", "claude");
    await load("/x", "codex");
    await load("/x", "antigravity");
    await load("/x", "grok");
    expect(urls).toEqual(["/api/sessions?cwd=%2Fx", "/api/codex/sessions?cwd=%2Fx", "/api/antigravity/sessions?cwd=%2Fx", "/api/grok/sessions?cwd=%2Fx"]);
  });

  // The agent is read when the URL is built, not when the answer lands: a switch mid-flight must
  // supersede the older request rather than relabel it.
  it("keeps a superseded agent's answer out of the newer agent's list", async () => {
    const slow = deferred<ReturnType<typeof ok>>();
    globalThis.fetch = vi.fn(async (url: string) =>
      String(url).includes("codex") ? slow.promise : ok({ sessions: [{ id: "cl", title: "claude row", mtime: 2 }], cwd: "/x" }),
    ) as unknown as typeof fetch;
    const { value, load } = useResumableSessions();
    const codex = load("/x", "codex");
    await load("/x", "claude");
    slow.resolve(ok({ sessions: [{ id: "cx", title: "codex row", mtime: 1 }], cwd: "/x" }));
    await codex;
    expect(value.value.sessions).toEqual([{ id: "cl", title: "claude row", mtime: 2 }]);
  });

  it("clears the rows when the read throws, rather than showing another dir's", async () => {
    globalThis.fetch = vi.fn(async () => ok({ sessions: [{ id: "a", title: "one", mtime: 1 }], cwd: "/x" })) as unknown as typeof fetch;
    const { value, load } = useResumableSessions();
    await load("/x", "claude");
    globalThis.fetch = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    await load("/y", "claude");
    expect(value.value).toEqual({ sessions: [], cwd: null });
  });
});

describe("useDirScripts", () => {
  // #3506: a remote directory's scripts are its host's, and run in its plain path there.
  it("asks a remote directory's host, and gives the plain path to run in", async () => {
    globalThis.fetch = vi.fn(async () => ok({ scripts: [{ index: 0, label: "build", command: "yarn build" }] })) as unknown as typeof fetch;
    const { value, load } = useDirScripts();
    await load(dirKeyOf("lx", "/srv/p"));
    expect(vi.mocked(globalThis.fetch).mock.calls.map(([url]) => String(url))).toEqual(["/remote/lx/api/scripts?cwd=%2Fsrv%2Fp"]);
    expect(value.value.cwd).toBe("/srv/p");
  });

  it("lists the scripts and the cwd they run in", async () => {
    globalThis.fetch = vi.fn(async () => ok({ scripts: [{ index: 0, label: "build", command: "yarn build" }], cwd: "/resolved" })) as unknown as typeof fetch;
    const { value, load } = useDirScripts();
    await load("/typed");
    expect(value.value).toEqual({ scripts: [{ index: 0, label: "build", command: "yarn build" }], cwd: "/resolved" });
  });

  // A refused read means "nothing to offer here", not "keep what the last directory had" — and
  // the dir asked about is still the one the (empty) list belongs to.
  it("reads a refused response as an empty list for the dir asked about", async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })) as unknown as typeof fetch;
    const { value, load } = useDirScripts();
    await load("/asked");
    expect(value.value).toEqual({ scripts: [], cwd: "/asked" });
  });

  it("ignores a body whose list is not an array", async () => {
    globalThis.fetch = vi.fn(async () => ok({ scripts: "nope", cwd: "/x" })) as unknown as typeof fetch;
    const { value, load } = useDirScripts();
    await load("/x");
    expect(value.value.scripts).toEqual([]);
  });
});

describe("useDirWorktrees", () => {
  it("reports the repo and its worktrees", async () => {
    const worktrees = [{ path: "/wt/a", branch: "agent/a", task: "a", dirty: true }];
    globalThis.fetch = vi.fn(async () => ok({ isGit: true, worktrees })) as unknown as typeof fetch;
    const { value, load } = useDirWorktrees();
    await load("/repo");
    expect(value.value).toEqual({ isGit: true, worktrees });
  });

  it("says not-a-repo when the read is refused", async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })) as unknown as typeof fetch;
    const { value, load } = useDirWorktrees();
    await load("/plain");
    expect(value.value).toEqual({ isGit: false, worktrees: [] });
  });
});
