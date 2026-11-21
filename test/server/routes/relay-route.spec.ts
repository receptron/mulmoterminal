// @vitest-environment node
//
// The relay round trip at the routes (#3389): read what is new, record where it ended, read again.
// Through the real claude reader and the real marker log, under a scratch HOME so nothing is
// appended to the developer's own ~/.mulmoterminal.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import express from "express";
import { jsonPost, routeCall } from "../../helpers/routeCall";
import { takeScratchHome } from "../../support/scratchHome.js";

const scratchHome = takeScratchHome("mt-relay-route-");
const CWD = path.join(scratchHome.path, "source");

const { mountSessionRoutes } = await import("../../../server/routes/session-routes.js");
const { projectSessionsDir } = await import("../../../server/session/project-dir.js");

afterAll(() => scratchHome.release());

const SESSION = "5b1c2d3e-4f50-4a61-8b72-93a4b5c6d7e8";
const app = express();
app.use(express.json());
mountSessionRoutes(app, { freshenRosterTitle: () => {}, publishActivity: () => {}, agentOfSession: () => null });
const call = routeCall(app);

const line = (record: unknown): string => `${JSON.stringify(record)}\n`;
const exchange = (n: number): string =>
  line({ type: "user", message: { role: "user", content: `prompt ${n}` } }) +
  line({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: `reply ${n}` }], stop_reason: "end_turn" } });
const transcript = () => path.join(projectSessionsDir(CWD), `${SESSION}.jsonl`);

const query = (dest: string) => new URLSearchParams({ session: SESSION, agent: "claude", cwd: CWD, dest }).toString();
const relay = (dest = "/dest/a") => call(`/api/transcript/relay?${query(dest)}`);
const record = (mark: unknown, dest = "/dest/a") => call(`/api/transcript/relay-mark?${query(dest)}`, jsonPost({ mark }));

beforeAll(async () => {
  await fs.mkdir(CWD, { recursive: true });
  await fs.mkdir(projectSessionsDir(CWD), { recursive: true });
  await fs.writeFile(transcript(), exchange(1) + exchange(2) + exchange(3));
});

describe("GET /api/transcript/relay + POST /api/transcript/relay-mark", () => {
  it("sends every exchange the first time, nothing after recording, and only the new one after that", async () => {
    const first = await relay();
    expect(first.body).toMatchObject({ status: "ok", count: 3 });
    expect(first.body.text).toContain("prompt 1");
    expect(first.body.text).toContain("reply 3");

    expect((await record(first.body.mark)).status).toBe(200);
    expect((await relay()).body).toMatchObject({ status: "nothing-new", text: "", count: 0 });

    await fs.appendFile(transcript(), exchange(4));
    const next = await relay();
    expect(next.body).toMatchObject({ status: "ok", count: 1 });
    expect(next.body.text).toContain("prompt 4");
    expect(next.body.text).not.toContain("prompt 3");
  });

  it("keeps a separate marker per destination directory", async () => {
    expect((await relay("/dest/b")).body).toMatchObject({ status: "ok", count: 4 });
  });

  it("writes the marker to the log under the mulmoterminal home", async () => {
    const log = await fs.readFile(path.join(scratchHome.path, ".mulmoterminal", "relay-marks.jsonl"), "utf8");
    expect(log.trim().split("\n")).toHaveLength(1);
    expect(log).toContain('"dest":"/dest/a"');
  });

  it("refuses a missing destination and a malformed marker", async () => {
    expect((await call(`/api/transcript/relay?${new URLSearchParams({ session: SESSION, cwd: CWD })}`)).status).toBe(400);
    expect((await record("not-a-mark")).status).toBe(400);
  });
});
