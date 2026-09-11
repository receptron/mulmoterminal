// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import { EventEmitter } from "node:events";
import { mkdirSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { appRequest } from "../../helpers/appRequest.js";
import { mountRevealRoute, type Spawner } from "../../../server/files/reveal.js";
import { revealArgv } from "../../../server/files/reveal-argv.js";
import { makeTempDir } from "../../support/tempDir";
import { canSymlink } from "../../support/canSymlink";
import { isRecord } from "../../../common/isRecord.js";

// The route that hands a produced file to another app (#2039): it opens the OS file manager, so
// the spawn is INJECTED — a real one would put a Finder window on the machine running the suite,
// and the thing worth asserting is the argv, not that a window appeared.
let dir: string;
let file: string;

/** A child that reports a successful start, like a file manager that came up. */
function fakeChild(event: "spawn" | "error", message = ""): EventEmitter & { unref: () => void } {
  const child = Object.assign(new EventEmitter(), { unref: () => {} });
  // After the listeners are attached, which happens synchronously in the route.
  setImmediate(() => child.emit(event, event === "error" ? new Error(message) : undefined));
  return child;
}

interface Call {
  cmd: string;
  args: string[];
}

function mount(outcome: (call: Call) => "spawn" | "error"): { request: ReturnType<typeof appRequest>; calls: Call[] } {
  const calls: Call[] = [];
  const spawner = ((cmd: string, args: string[]) => {
    calls.push({ cmd, args });
    return fakeChild(outcome({ cmd, args }), "no such file or directory");
  }) as unknown as Spawner;
  const app = express();
  app.use(express.json());
  mountRevealRoute(app, { isAllowedOrigin: () => true, spawner });
  return { request: appRequest(app), calls };
}

beforeAll(() => {
  dir = makeTempDir("mt-reveal-");
  mkdirSync(path.join(dir, "reports"), { recursive: true });
  file = path.join(dir, "reports", "2026-08.pdf");
  writeFileSync(file, "%PDF-1.4\n");
});

const post = (request: ReturnType<typeof appRequest>, body: unknown) =>
  request("/api/files/reveal", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("POST /api/files/reveal", () => {
  it("spawns the platform opener and answers ok", async () => {
    const { request, calls } = mount(() => "spawn");
    const res = await post(request, { path: file });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    // Composed against `revealArgv` rather than spelled out: WHICH argv each platform wants is
    // that function's contract, pinned per platform in its own spec, and on Linux the file is
    // deliberately reduced to its folder (there is no portable "select this item"). Asserting a
    // literal here passed on macOS and Windows and went red on Linux — the route's own job is to
    // pass the RESOLVED path and the right `isDir`, which is what this now checks.
    expect(calls[0]?.args).toEqual(revealArgv(calls[0]?.cmd ?? "", file, false));
  });

  it("opens a directory as itself", async () => {
    const { request, calls } = mount(() => "spawn");
    expect((await post(request, { path: path.join(dir, "reports") })).status).toBe(200);
    expect(calls[0]?.args).toEqual([path.join(dir, "reports")]);
  });

  it("400s without a path", async () => {
    const { request } = mount(() => "spawn");
    expect((await post(request, {})).status).toBe(400);
  });

  it("400s on a relative path", async () => {
    const { request } = mount(() => "spawn");
    expect((await post(request, { path: "reports/2026-08.pdf" })).status).toBe(400);
  });

  it("404s on a path that is not there", async () => {
    const { request } = mount(() => "spawn");
    const res = await post(request, { path: path.join(dir, "nope.pdf") });
    expect(res.status).toBe(404);
  });

  // The gate that stops a random website driving the machine — the same one /api/open-dir uses.
  it("403s a disallowed origin, before spawning anything", async () => {
    const calls: Call[] = [];
    const app = express();
    app.use(express.json());
    mountRevealRoute(app, {
      isAllowedOrigin: () => false,
      spawner: ((cmd: string, args: string[]) => {
        calls.push({ cmd, args });
        return fakeChild("spawn");
      }) as unknown as Spawner,
    });
    const res = await post(appRequest(app), { path: file });
    expect(res.status).toBe(403);
    expect(calls).toEqual([]);
  });

  // #1447: a host with no file manager used to look exactly like a successful reveal — the route
  // said ok and nothing appeared. The answer has to wait for an opener to actually start.
  it("reports 500 when no opener starts, naming what it tried", async () => {
    const { request, calls } = mount(() => "error");
    const res = await post(request, { path: file });
    expect(res.status).toBe(500);
    const body: unknown = await res.json();
    expect(String(isRecord(body) ? body.error : "")).toContain(calls[0]?.cmd ?? "");
    expect(calls.length).toBeGreaterThanOrEqual(1);
  });

  // The browser joins a row onto the tree's root with `/` whatever the root looks like, so the
  // path arrives with the separators of neither side in particular. `explorer /select,` is
  // particular about them, and this is the side that knows which the host uses.
  it("straightens the separators before handing the path to the file manager", async () => {
    const { request, calls } = mount(() => "spawn");
    const messy = path.join(dir, "reports") + "/./2026-08.pdf";
    expect((await post(request, { path: messy })).status).toBe(200);
    expect(calls[0]?.args).toEqual(revealArgv(calls[0]?.cmd ?? "", path.resolve(messy), false));
    expect(calls[0]?.args.join(" ")).not.toContain("/./");
  });

  // The security property this route rests on, stated where both halves meet: the guard requires
  // an ABSOLUTE path, and every absolute spelling on every platform begins with `/`, `\\` or a
  // drive letter — so the argument DERIVED from the path can never begin with `-`. `open -R -foo`
  // reading its own target as a flag is therefore not reachable, and it stays that way only while
  // the absolute-path check does. (Observed during Claude review, not flagged by Codex.)
  it("can never hand the opener an argument that looks like a flag", async () => {
    const { request, calls } = mount(() => "spawn");
    const dashed = path.join(dir, "reports", "-R.pdf");
    writeFileSync(dashed, "%PDF-1.4\n");
    expect((await post(request, { path: dashed })).status).toBe(200);
    // The LAST argument is the one derived from the path, in all three shapes (`["-R", p]`,
    // [`/select,${p}`], `[dirname]`). Any earlier one is a flag WE chose, fixed in the source.
    expect(calls[0]?.args.at(-1)?.startsWith("-")).toBe(false);
    // And the relative spelling that COULD produce one is refused before any spawn.
    const before = calls.length;
    expect((await post(request, { path: "-R.pdf" })).status).toBe(400);
    expect(calls).toHaveLength(before);
  });

  // `path.resolve` folds `..` LEXICALLY; the kernel folds it through symlinks. So a path carrying
  // a literal `..` after a symlinked directory names one file to `statSync` and a different one to
  // `path.resolve` — measured on this fixture: `<root>/link/../adir` stats as a DIRECTORY and its
  // resolved spelling stats as a FILE. Validating one and spawning the other is what this pins
  // shut: the route normalises BEFORE the guard stats, so both are the same string (Codex P2).
  //
  // `runIf(canSymlink)`: Windows needs Developer Mode to make one, and a fixture that was never
  // created reads as broken behaviour rather than as untestable (docs/windows-gotchas.md).
  it.runIf(canSymlink)("validates the same pathname it hands to the file manager", async () => {
    const { request, calls } = mount(() => "spawn");
    const root = makeTempDir("mt-reveal-sym-");
    mkdirSync(path.join(root, "deep", "sub"), { recursive: true });
    mkdirSync(path.join(root, "deep", "adir"));
    writeFileSync(path.join(root, "adir"), "a FILE where the lexical fold lands");
    symlinkSync(path.join(root, "deep", "sub"), path.join(root, "link"));

    // Built by concatenation: `path.join` would fold the `..` before the route ever saw it.
    const asked = root + "/link/../adir";
    const lexical = path.resolve(asked);
    // MEASURED, not assumed. On POSIX the kernel follows `link` and only then folds `..`, so this
    // names a DIRECTORY while `path.resolve` names the FILE beside it — the mismatch Codex found.
    // Win32 folds `..` lexically in the path API itself, before the reparse point, so the two
    // agree there and the mismatch cannot arise at all. Asserting the divergence unconditionally
    // is what turned this test red on Windows CI while passing on macOS.
    const diverges = statSync(asked).isDirectory() !== statSync(lexical).isDirectory();
    expect(diverges).toBe(process.platform !== "win32");

    expect((await post(request, { path: asked })).status).toBe(200);
    // The invariant, which holds on both: whatever the guard statted is what gets spawned. The
    // route normalises BEFORE the stat, so `isDir` describes `lexical` and not the other one.
    expect(calls[0]?.args).toEqual(revealArgv(calls[0]?.cmd ?? "", lexical, statSync(lexical).isDirectory()));
  });
});
