// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import { EventEmitter } from "node:events";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { appRequest } from "../../helpers/appRequest.js";
import { mountRevealRoute, type Spawner } from "../../../server/files/reveal.js";
import { makeTempDir } from "../../support/tempDir";
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
    // The argv itself is `revealArgv`'s contract, pinned per platform in its own spec. What this
    // asserts is that the route asked for the FILE's form rather than the directory's.
    expect(calls[0]?.args).not.toEqual([file]);
    expect(calls[0]?.args.join(" ")).toContain(file);
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
    expect(calls[0]?.args.join(" ")).toContain(path.resolve(messy));
    expect(calls[0]?.args.join(" ")).not.toContain("/./");
  });
});
