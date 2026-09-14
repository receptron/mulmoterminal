// @vitest-environment node
// The machine-global hook file cursor reads, and the poster it runs.
//
// Most of what is pinned here was measured against cursor-agent 2026.09.10-fd3934a and fails
// SILENTLY when it regresses — a cell that runs perfectly and reports nothing — so a spec is the
// only thing that would catch it.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  cursorHooksJson,
  cursorHooksFile,
  cursorPosterScript,
  cursorPosterSource,
  syncCursorHooksFile,
  removeCursorHooksFile,
  repairStaleCursorHooksFile,
} from "../../../server/agents/cursor-hooks-file.js";

const liveInstances = vi.hoisted(() => vi.fn<() => { pid: number; port: number | null }[]>(() => []));
vi.mock("../../../bin/instances.js", () => ({ liveInstances }));

let home: string;
let mtHome: string;

beforeEach(() => {
  home = mkdtempSync(path.join(os.tmpdir(), "cursor-home-"));
  mtHome = mkdtempSync(path.join(os.tmpdir(), "mt-home-"));
  liveInstances.mockReturnValue([]);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(mtHome, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const read = (): string => readFileSync(cursorHooksFile(home), "utf8");
const commandsIn = (text: string): string[] => {
  const parsed: unknown = JSON.parse(text);
  const hooks = (parsed as { hooks: Record<string, { command: string }[]> }).hooks;
  return Object.values(hooks).flatMap((list) => list.map((entry) => entry.command));
};

/** The generated file, refusing to continue if the builder declined — `!` is forbidden here, and a
 *  silent `null` would make every assertion below vacuous. */
const built = (port: number, script: string): string => {
  const json = cursorHooksJson(port, script);
  if (json === null) throw new Error(`cursorHooksJson declined for ${script}`);
  return json;
};

describe("cursorHooksJson", () => {
  it("puts NO URL in any command — cursor silently refuses such an entry, and one refusal voids the whole file", () => {
    for (const command of commandsIn(built(8765, "/mt/cursor-hook.mjs"))) {
      expect(command).not.toMatch(/https?:\/\//);
      expect(command).not.toContain("://");
    }
  });

  it("passes the port as a bare trailing argument, which is what lets the URL live in the poster", () => {
    for (const command of commandsIn(built(8765, "/mt/cursor-hook.mjs"))) {
      expect(command.split(" ").at(-1)).toBe("8765");
    }
  });

  it("refuses to build anything when a path contains a space, rather than writing a file that voids itself", () => {
    // cursor splits the command itself and this file has no verified quoting, so a spaced path is
    // an entry it cannot run — and one such entry loses every OTHER event too.
    expect(cursorHooksJson(8765, "/Program Files/cursor-hook.mjs")).toBeNull();
  });

  it("names the poster in every command, which is what makes the file recognisable as ours", () => {
    for (const command of commandsIn(built(8765, "/mt/cursor-hook.mjs"))) {
      expect(command).toContain("cursor-hook.mjs");
    }
  });
});

describe("cursorPosterSource", () => {
  it("carries the URL, since the command line may not", () => {
    expect(cursorPosterSource()).toContain("/api/hook");
  });
  it("identifies itself as cursor's, so the route knows which vocabulary to translate", () => {
    expect(cursorPosterSource()).toContain('"x-mt-agent": "cursor"');
  });
});

describe("syncCursorHooksFile", () => {
  it("writes the hook file and the poster", () => {
    syncCursorHooksFile(8765, home, mtHome);
    expect(existsSync(cursorHooksFile(home))).toBe(true);
    expect(readFileSync(cursorPosterScript(mtHome), "utf8")).toContain("/api/hook");
  });

  it("leaves a file it did not write alone — cursor reads ONE fixed path, which a user may already own", () => {
    const theirs = '{"version":1,"hooks":{"stop":[{"command":"/usr/local/bin/their-hook"}]}}';
    mkdirSync(path.dirname(cursorHooksFile(home)), { recursive: true });
    writeFileSync(cursorHooksFile(home), theirs, "utf8");
    syncCursorHooksFile(8765, home, mtHome);
    expect(read()).toBe(theirs);
  });

  it("takes over a file of OURS that names another port, and says so", () => {
    syncCursorHooksFile(8765, home, mtHome);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    syncCursorHooksFile(9999, home, mtHome);
    expect(commandsIn(read())[0].split(" ").at(-1)).toBe("9999");
    expect(warn.mock.calls.flat().join(" ")).toContain("another MulmoTerminal instance");
  });

  it("refreshes the poster even when the hook file already matches, so an old build's copy is replaced", () => {
    syncCursorHooksFile(8765, home, mtHome);
    writeFileSync(cursorPosterScript(mtHome), "// stale", "utf8");
    syncCursorHooksFile(8765, home, mtHome);
    expect(readFileSync(cursorPosterScript(mtHome), "utf8")).toContain("/api/hook");
  });
});

describe("removeCursorHooksFile", () => {
  it("removes what THIS process published", () => {
    syncCursorHooksFile(8765, home, mtHome);
    removeCursorHooksFile(home);
    expect(existsSync(cursorHooksFile(home))).toBe(false);
  });

  it("removes nothing this process never published, however much the file looks like ours", () => {
    mkdirSync(path.dirname(cursorHooksFile(home)), { recursive: true });
    writeFileSync(cursorHooksFile(home), built(8765, path.join(mtHome, "cursor-hook.mjs")), "utf8");
    removeCursorHooksFile(home);
    expect(existsSync(cursorHooksFile(home))).toBe(true);
  });

  it("leaves a peer's file when the peer took ours over after we published", () => {
    syncCursorHooksFile(8765, home, mtHome);
    // A peer rewrites it for its own port; our published bytes no longer match.
    writeFileSync(cursorHooksFile(home), built(9999, path.join(mtHome, "cursor-hook.mjs")), "utf8");
    removeCursorHooksFile(home);
    expect(existsSync(cursorHooksFile(home))).toBe(true);
  });
});

describe("repairStaleCursorHooksFile", () => {
  it("creates nothing on a machine that has never run a cursor cell", () => {
    repairStaleCursorHooksFile(8765, home, mtHome);
    expect(existsSync(cursorHooksFile(home))).toBe(false);
  });

  it("rewrites a file left by a dead server onto this server's port", () => {
    mkdirSync(path.dirname(cursorHooksFile(home)), { recursive: true });
    writeFileSync(cursorHooksFile(home), built(4242, path.join(mtHome, "cursor-hook.mjs")), "utf8");
    repairStaleCursorHooksFile(8765, home, mtHome);
    expect(commandsIn(read())[0].split(" ").at(-1)).toBe("8765");
  });

  it("leaves a LIVE peer's file alone — its cells may be running right now", () => {
    mkdirSync(path.dirname(cursorHooksFile(home)), { recursive: true });
    writeFileSync(cursorHooksFile(home), built(4242, path.join(mtHome, "cursor-hook.mjs")), "utf8");
    liveInstances.mockReturnValue([{ pid: 4321, port: 4242 }]);
    repairStaleCursorHooksFile(8765, home, mtHome);
    expect(commandsIn(read())[0].split(" ").at(-1)).toBe("4242");
  });

  it("leaves a file that is not ours alone", () => {
    const theirs = '{"version":1,"hooks":{"stop":[{"command":"/usr/local/bin/their-hook"}]}}';
    mkdirSync(path.dirname(cursorHooksFile(home)), { recursive: true });
    writeFileSync(cursorHooksFile(home), theirs, "utf8");
    repairStaleCursorHooksFile(8765, home, mtHome);
    expect(read()).toBe(theirs);
  });
});

describe("a foreign file whose command merely CONTAINS our poster's name", () => {
  // Codex reproduced this on round 12 of #2065: the ownership check asked only whether the command
  // contained "cursor-hook.mjs", so a user's own hook script called `my-cursor-hook.mjs` was read
  // as ours and OVERWRITTEN — the one thing this file's design says must never happen. It matters
  // here more than for copilot because cursor's path is the user's single fixed
  // `~/.cursor/hooks.json` rather than a name we chose inside a directory copilot scans.
  const foreign = JSON.stringify({ version: 1, hooks: { stop: [{ command: "/usr/local/bin/my-cursor-hook.mjs stop" }] } }, null, 2);
  const write = (): void => {
    mkdirSync(path.dirname(cursorHooksFile(home)), { recursive: true });
    writeFileSync(cursorHooksFile(home), foreign, "utf8");
  };

  it("is left alone by a spawn's sync", () => {
    write();
    syncCursorHooksFile(8765, home, mtHome);
    expect(read()).toBe(foreign);
  });

  it("is left alone by the startup repair", () => {
    write();
    repairStaleCursorHooksFile(8765, home, mtHome);
    expect(read()).toBe(foreign);
  });

  it("is not ours even when the command names our poster's BASENAME from another directory", () => {
    mkdirSync(path.dirname(cursorHooksFile(home)), { recursive: true });
    const elsewhere = JSON.stringify({ version: 1, hooks: { stop: [{ command: `/usr/bin/node /somewhere/else/${"cursor-hook.mjs"} stop 8765` }] } }, null, 2);
    writeFileSync(cursorHooksFile(home), elsewhere, "utf8");
    syncCursorHooksFile(8765, home, mtHome);
    expect(read()).toBe(elsewhere);
  });

  it("still recognises OUR file when node itself has moved — the path we do not check", () => {
    // A node upgrade must not make our own file unrecognisable to us: refused by the sync, never
    // replaced, posting to a dead port forever. Token 0 is deliberately not part of the signature.
    syncCursorHooksFile(8765, home, mtHome);
    const ours = read().replace(process.execPath, "/opt/some-other-node/bin/node");
    writeFileSync(cursorHooksFile(home), ours, "utf8");
    syncCursorHooksFile(9999, home, mtHome);
    expect(commandsIn(read())[0].split(" ").at(-1)).toBe("9999");
  });
});

describe("a crash leftover naming THIS server's port", () => {
  // A server crashes without running its exit handler; a new one starts on the same port. Nobody
  // else can be bound to it, so the file is our predecessor's. The startup repair used to return
  // early on the port match and leave it UN-ADOPTED — `publishedByThisProcess` stayed empty, so
  // this server's own clean shutdown then declined to remove it and it outlived us pointing at a
  // port nobody serves (Codex round 13 of #2065).
  it("is adopted at startup, so this server's clean exit removes it", () => {
    mkdirSync(path.dirname(cursorHooksFile(home)), { recursive: true });
    writeFileSync(cursorHooksFile(home), built(8765, path.join(mtHome, "cursor-hook.mjs")), "utf8");
    repairStaleCursorHooksFile(8765, home, mtHome);
    removeCursorHooksFile(home);
    expect(existsSync(cursorHooksFile(home))).toBe(false);
  });

  it("is still left alone when it is a LIVE peer's, on another port", () => {
    mkdirSync(path.dirname(cursorHooksFile(home)), { recursive: true });
    writeFileSync(cursorHooksFile(home), built(4242, path.join(mtHome, "cursor-hook.mjs")), "utf8");
    liveInstances.mockReturnValue([{ pid: 4321, port: 4242 }]);
    repairStaleCursorHooksFile(8765, home, mtHome);
    expect(commandsIn(read())[0].split(" ").at(-1)).toBe("4242");
  });
});
