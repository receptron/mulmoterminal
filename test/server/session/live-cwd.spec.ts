import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { makeTempDir } from "../../support/tempDir.js";
import { displayCwdFor, forgetLiveCwd, liveCwd, noteLiveCwd, replayLiveCwd, workTreeRootOf } from "../../../server/session/live-cwd.js";
import { ptys } from "../../../server/session/registry.js";
import type { PtyEntry } from "../../../server/session/types.js";

// Real repos with a real linked worktree: the whole point of this module is telling one
// checkout from another, and only git knows where a work tree ends.
let base = "";
let main = "";
let sub = "";
let worktree = "";
let nested = "";
let plain = "";

beforeAll(() => {
  base = makeTempDir("mt-livecwd-");
  main = path.join(base, "myrepo");
  mkdirSync(main);
  const git = (args: string[], cwd = main) =>
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- 'git' from PATH in a test; argv only, no shell
    execFileSync("git", args, { cwd, stdio: "pipe" });
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "t@example.invalid"]);
  git(["config", "user.name", "t"]);
  sub = path.join(main, "app");
  mkdirSync(sub);
  writeFileSync(path.join(main, "f.txt"), "x");
  git(["add", "f.txt"]);
  git(["commit", "-qm", "first"]);
  worktree = path.join(base, "wt");
  git(["worktree", "add", "-q", "-b", "side", worktree]);
  nested = path.join(worktree, "nested");
  mkdirSync(nested);
  plain = path.join(base, "notrepo");
  mkdirSync(plain);
});

afterAll(() => rmSync(base, { recursive: true, force: true }));

// git prints POSIX separators even on Windows; the inputs keep whatever shape they were
// given. Compare the resolved form so the two can't disagree about the same directory.
const norm = (p: string): string => path.resolve(p);

const SESSION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

interface FakeSocket {
  readyState: number;
  readonly OPEN: number;
  sent: string[];
  send(data: string): void;
  close(): void;
}

function fakeSocket(): FakeSocket {
  return {
    readyState: 1,
    OPEN: 1,
    sent: [],
    send(data: string) {
      this.sent.push(data);
    },
    close() {},
  };
}

function registerPty(cwd: string, socket: FakeSocket | null): void {
  ptys.set(SESSION, { cwd, ws: socket, active: true, agent: "claude" } as unknown as PtyEntry);
}

const frames = (socket: FakeSocket) => socket.sent.map((s) => JSON.parse(s));

beforeEach(() => {
  ptys.delete(SESSION);
  forgetLiveCwd(SESSION);
});

describe("workTreeRootOf", () => {
  it("rounds a directory inside a repo up to that work tree's root", async () => {
    expect(norm(await workTreeRootOf(sub))).toBe(norm(main));
  });

  it("reports a linked worktree as its own root, not the main repo's", async () => {
    expect(norm(await workTreeRootOf(worktree))).toBe(norm(worktree));
  });

  it("returns the directory itself when it is not in a work tree", async () => {
    expect(norm(await workTreeRootOf(plain))).toBe(norm(plain));
  });
});

describe("displayCwdFor", () => {
  it("keeps the spawn dir while the agent is still inside the spawn work tree", async () => {
    // A `cd app` mid-turn is the same checkout — the header must not redraw for it, and a
    // session spawned in a subdirectory must not have its display quietly rewritten either.
    expect(await displayCwdFor(sub, sub)).toBe(sub);
    expect(await displayCwdFor(sub, main)).toBe(main);
    expect(await displayCwdFor(main, sub)).toBe(sub);
  });

  it("reports the other work tree's ROOT once the agent is in one", async () => {
    expect(norm(await displayCwdFor(worktree, main))).toBe(norm(worktree));
  });

  it("falls back to the raw directory when the agent leaves git entirely", async () => {
    expect(norm(await displayCwdFor(plain, main))).toBe(norm(plain));
  });
});

describe("noteLiveCwd", () => {
  it("says nothing while the session stays in its spawn work tree", async () => {
    const socket = fakeSocket();
    registerPty(main, socket);
    await noteLiveCwd(SESSION, sub);
    expect(socket.sent).toEqual([]);
    expect(liveCwd(SESSION)).toBe(main);
  });

  it("pushes the work tree the session moved to", async () => {
    const socket = fakeSocket();
    registerPty(main, socket);
    await noteLiveCwd(SESSION, worktree);
    expect(frames(socket)).toHaveLength(1);
    expect(frames(socket)[0]).toMatchObject({ type: "cwd", id: SESSION });
    expect(norm(frames(socket)[0].cwd)).toBe(norm(worktree));
    expect(norm(liveCwd(SESSION) ?? "")).toBe(norm(worktree));
  });

  it("pushes once per move, not once per hook", async () => {
    const socket = fakeSocket();
    registerPty(main, socket);
    await noteLiveCwd(SESSION, worktree);
    await noteLiveCwd(SESSION, worktree);
    await noteLiveCwd(SESSION, nested);
    expect(socket.sent).toHaveLength(1);
  });

  it("pushes the spawn dir again when the session comes back", async () => {
    const socket = fakeSocket();
    registerPty(main, socket);
    await noteLiveCwd(SESSION, worktree);
    await noteLiveCwd(SESSION, main);
    expect(frames(socket).at(-1)).toEqual({ type: "cwd", id: SESSION, cwd: main });
    expect(liveCwd(SESSION)).toBe(main);
  });

  it("ignores a hook that carries no usable cwd", async () => {
    const socket = fakeSocket();
    registerPty(main, socket);
    await noteLiveCwd(SESSION, undefined);
    await noteLiveCwd(SESSION, "");
    await noteLiveCwd(SESSION, { cwd: worktree });
    expect(socket.sent).toEqual([]);
    expect(liveCwd(SESSION)).toBeNull();
  });

  it("remembers nothing for an id with no live pty", async () => {
    // Any well-formed uuid can be POSTed to /api/hook, and nothing would ever reap an entry
    // made for one — there is no session to forget it.
    await noteLiveCwd(SESSION, worktree);
    expect(liveCwd(SESSION)).toBeNull();
  });

  it("still records the move for a session whose browser is detached", async () => {
    registerPty(main, null);
    await noteLiveCwd(SESSION, worktree);
    expect(norm(liveCwd(SESSION) ?? "")).toBe(norm(worktree));
  });
});

describe("replayLiveCwd", () => {
  it("tells a reattaching browser where the session actually is", async () => {
    registerPty(main, null);
    await noteLiveCwd(SESSION, worktree);
    const socket = fakeSocket();
    expect(replayLiveCwd(socket, SESSION, main)).toBe(true);
    expect(frames(socket)).toHaveLength(1);
    expect(norm(frames(socket)[0].cwd)).toBe(norm(worktree));
  });

  it("stays quiet for a session that never moved", () => {
    const socket = fakeSocket();
    expect(replayLiveCwd(socket, SESSION, main)).toBe(false);
    expect(socket.sent).toEqual([]);
  });

  // The regression this exists for: replay used to be gated on the connection resolving as a
  // reattach, and a session whose agent has MOVED never does — its transcript went with it, so
  // the exists-on-disk check fails and the socket is logged as "new". That gate silenced the
  // replay for exactly the sessions it was written for, and since noteLiveCwd only speaks on a
  // change, one reload left the header on the abandoned directory permanently.
  it("replays after a reload even though a moved session no longer looks reattachable", async () => {
    registerPty(main, null);
    await noteLiveCwd(SESSION, worktree); // the browser that was told has since gone away
    const reloaded = fakeSocket();
    expect(replayLiveCwd(reloaded, SESSION, main)).toBe(true);
    expect(norm(frames(reloaded)[0].cwd)).toBe(norm(worktree));
    // ...and the hook that follows the reload says nothing, which is why the replay has to.
    registerPty(main, reloaded);
    const before = reloaded.sent.length;
    await noteLiveCwd(SESSION, worktree);
    expect(reloaded.sent).toHaveLength(before);
  });

  it("stays quiet when the reported cwd already IS the moved-to one", async () => {
    registerPty(main, null);
    await noteLiveCwd(SESSION, worktree);
    const socket = fakeSocket();
    expect(replayLiveCwd(socket, SESSION, worktree)).toBe(false);
  });
});

describe("forgetLiveCwd", () => {
  it("drops a torn-down session's directory", async () => {
    registerPty(main, null);
    await noteLiveCwd(SESSION, worktree);
    forgetLiveCwd(SESSION);
    expect(liveCwd(SESSION)).toBeNull();
  });
});
