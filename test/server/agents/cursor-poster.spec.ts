// @vitest-environment node
// The generated poster, RUN rather than read.
//
// It is a string this repo emits into the user's home and cursor executes on every turn, so the
// only honest test is to execute it. What it has to get right is the case round 16 of #2065 found:
// a hook file OUTLIVES the server that wrote it — a crash skips the exit handler, and a user who
// edits the file makes it one MulmoTerminal may no longer rewrite or remove — so a stranded
// command must be HARMLESS rather than merely unlucky. Without the registry check it posts every
// prompt and tool argument to a bare local port that by then may belong to something else.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { cursorPosterSource } from "../../../server/agents/cursor-hooks-file.js";

let dir: string;
let instances: string;
let poster: string;
let server: Server;
let port: number;
let received: string[];
let identifies: boolean;

beforeEach(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), "cursor-poster-"));
  instances = path.join(dir, "instances");
  mkdirSync(instances, { recursive: true });
  poster = path.join(dir, "cursor-hook.mjs");
  writeFileSync(poster, cursorPosterSource(instances), "utf8");
  received = [];
  identifies = true;
  server = createServer((req, res) => {
    req.resume();
    if (req.method === "GET") {
      // The pre-flight. A server that is not us answers something else — or nothing recognisable.
      res.writeHead(200, { "content-type": "application/json" });
      res.end(identifies ? JSON.stringify({ mulmoterminal: true }) : JSON.stringify({ hello: "some other program" }));
      return;
    }
    received.push(String(req.headers["x-mt-hook"]));
    res.writeHead(200, { "content-type": "application/json" });
    res.end("{}");
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  port = typeof address === "object" && address !== null ? address.port : 0;
});

afterEach(async () => {
  await new Promise<void>((done) => server.close(() => done()));
  rmSync(dir, { recursive: true, force: true });
});

/** Run the poster exactly as cursor would, and give the request a moment to land.
 *
 *  ASYNCHRONOUSLY, and that is not a style choice: the listener this test asserts against lives in
 *  THIS process, so `execFileSync` deadlocks — the poster waits for a response the blocked event
 *  loop cannot send, and the only thing that ends it is the poster's own 5-second timeout. The
 *  first version of this file did exactly that and read as "the poster is slow". */
const post = async (): Promise<void> => {
  const out = await new Promise<string>((done, fail) => {
    const child = execFile(process.execPath, [poster, "stop", String(port)], { encoding: "utf8" }, (err, stdout) => (err ? fail(err) : done(stdout)));
    child.stdin?.end('{"conversation_id":"x"}');
  });
  // Cursor reads stdout as the hook's answer; `{}` is "no opinion", and it must be there whether or
  // not the post happened.
  expect(out).toBe("{}");
  await new Promise((done) => setTimeout(done, 250));
};

const registerInstance = (pid: number, onPort: number): void =>
  writeFileSync(path.join(instances, `${pid}.json`), JSON.stringify({ pid, port: onPort, startedAt: Date.now() }), "utf8");

describe("the generated cursor poster", () => {
  it("posts when a LIVE instance serves that port", async () => {
    registerInstance(process.pid, port); // this test process is alive by definition
    await post();
    expect(received).toEqual(["stop"]);
  });

  it("posts NOTHING when the registry names no instance on that port", async () => {
    registerInstance(process.pid, port + 1);
    await post();
    expect(received).toEqual([]);
  });

  it("posts NOTHING when the instance on that port is dead", async () => {
    // A pid that cannot be running: `process.kill(pid, 0)` throws ESRCH for it.
    registerInstance(0x7ffffffe, port);
    await post();
    expect(received).toEqual([]);
  });

  it("sends NOTHING when the port answers but is not us — a recycled pid the registry still names", async () => {
    // The registry says a live process holds this port, and it does; it is simply not a
    // MulmoTerminal. Only the pre-flight can tell those apart, and the payload is the user's prompt
    // and their tool arguments (Codex round 17 of #2065).
    registerInstance(process.pid, port);
    identifies = false;
    await post();
    expect(received).toEqual([]);
  });

  it("fails OPEN when there is no registry at all", async () => {
    // A machine where it was never writable keeps the status it has today, rather than losing it
    // to a check that cannot be answered.
    rmSync(instances, { recursive: true, force: true });
    await post();
    expect(received).toEqual(["stop"]);
  });
});
