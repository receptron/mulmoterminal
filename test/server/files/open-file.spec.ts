// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import { EventEmitter } from "node:events";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { appRequest } from "../../helpers/appRequest.js";
import { mountOpenFileRoute, type Spawner } from "../../../server/files/open-file.js";
import { makeTempDir } from "../../support/tempDir";
import { isRecord } from "../../../common/isRecord.js";

// The way out of a file the pane cannot show (#2038): hand it to the application that owns it.
// The spawn is INJECTED — a real one would launch Excel on the machine running the suite.
let dir: string;
let file: string;

function fakeChild(event: "spawn" | "error", message = ""): EventEmitter & { unref: () => void } {
  const child = Object.assign(new EventEmitter(), { unref: () => {} });
  setImmediate(() => child.emit(event, event === "error" ? new Error(message) : undefined));
  return child;
}

interface Call {
  cmd: string;
  args: string[];
}

function mount(outcome: () => "spawn" | "error") {
  const calls: Call[] = [];
  const spawner = ((cmd: string, args: string[]) => {
    calls.push({ cmd, args });
    return fakeChild(outcome(), "no such file or directory");
  }) as unknown as Spawner;
  const app = express();
  app.use(express.json());
  mountOpenFileRoute(app, { isAllowedOrigin: () => true, spawner });
  return { request: appRequest(app), calls };
}

beforeAll(() => {
  dir = makeTempDir("mt-openfile-");
  mkdirSync(path.join(dir, "reports"), { recursive: true });
  file = path.join(dir, "reports", "book.xlsx");
  writeFileSync(file, "PK");
});

const post = (request: ReturnType<typeof appRequest>, body: unknown) =>
  request("/api/files/open", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("POST /api/files/open", () => {
  it("hands the file to the platform opener, as a single argument", () => {
    return (async () => {
      const { request, calls } = mount(() => "spawn");
      const res = await post(request, { path: file });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      // One argument, no flag: this route OPENS the file, it does not reveal it. `reveal.ts` is
      // the one that selects, and the two must not drift into each other.
      expect(calls[0]?.args).toEqual([file]);
    })();
  });

  // A directory has its own route. Handing one here would launch a file manager from the endpoint
  // whose whole job is to launch an application.
  it("400s on a directory", async () => {
    const { request, calls } = mount(() => "spawn");
    expect((await post(request, { path: path.join(dir, "reports") })).status).toBe(400);
    expect(calls).toEqual([]);
  });

  it("400s without a path, and on a relative one", async () => {
    const { request } = mount(() => "spawn");
    expect((await post(request, {})).status).toBe(400);
    expect((await post(request, { path: "reports/book.xlsx" })).status).toBe(400);
  });

  it("404s on a path that is not there", async () => {
    const { request } = mount(() => "spawn");
    expect((await post(request, { path: path.join(dir, "nope.xlsx") })).status).toBe(404);
  });

  // The gate that stops a random website driving the machine — the same one the two sibling
  // routes use, checked before anything is spawned.
  it("403s a disallowed origin, before spawning anything", async () => {
    const calls: Call[] = [];
    const app = express();
    app.use(express.json());
    mountOpenFileRoute(app, {
      isAllowedOrigin: () => false,
      spawner: ((cmd: string, args: string[]) => {
        calls.push({ cmd, args });
        return fakeChild("spawn");
      }) as unknown as Spawner,
    });
    expect((await post(appRequest(app), { path: file })).status).toBe(403);
    expect(calls).toEqual([]);
  });

  // #1447: a host with no opener used to look exactly like a successful launch.
  it("reports 500 when nothing starts, naming what it tried", async () => {
    const { request, calls } = mount(() => "error");
    const res = await post(request, { path: file });
    expect(res.status).toBe(500);
    const body: unknown = await res.json();
    expect(String(isRecord(body) ? body.error : "")).toContain(calls[0]?.cmd ?? "");
  });
});
