// @vitest-environment node
//
// #2981. The live tmux server has to follow the config this process SERVES, however that config was
// adopted: a one-entry route re-reads the file under a lock and serves what it found, which can carry
// a prefix another mulmoterminal or a hand edit wrote since boot.
import { describe, it, expect, vi, afterAll, beforeEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import express from "express";
import { routeCall, jsonPost } from "../../helpers/routeCall";

// config-routes reads HOME at import, so the scratch home has to exist before it is imported; the
// import itself is at module scope so a loaded runner does not bill it to the first test.
const scratch = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const home = mkdtempSync(join(tmpdir(), "mt-tmuxprefix-"));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  return { home, file: join(home, ".mulmoterminal", "config.json") };
});
vi.mock("../../../server/infra/process/tmux.js", async (importOriginal) => ({ ...(await importOriginal<object>()), setTmuxPrefix: vi.fn() }));

mkdirSync(`${scratch.home}/.mulmoterminal`, { recursive: true });
writeFileSync(scratch.file, JSON.stringify({ tmuxPrefix: "C-]" }));
const { setTmuxPrefix } = await import("../../../server/infra/process/tmux.js");
const routes = await import("../../../server/config/config-routes.js");
const app = express();
app.use(express.json());
routes.mountConfigRoutes(app, scratch.home);
const bootCalls = vi.mocked(setTmuxPrefix).mock.calls.map(([prefix]) => prefix);

afterAll(() => rmSync(scratch.home, { recursive: true, force: true }));
beforeEach(() => vi.mocked(setTmuxPrefix).mockClear());

describe("tmux prefix follows the adopted config", () => {
  it("is applied at boot from the config file", () => {
    expect(bootCalls).toEqual(["C-]"]);
  });

  it("is applied when a POST /api/config changes it", async () => {
    await routeCall(app)("/api/config", jsonPost({ tmuxPrefix: "C-b" }));
    expect(setTmuxPrefix).toHaveBeenLastCalledWith("C-b");
  });

  it("is applied when a one-entry route adopts a prefix written to the file since boot", async () => {
    writeFileSync(scratch.file, JSON.stringify({ tmuxPrefix: "C-]" }));
    const res = await routeCall(app)("/api/config/keymap/binding", jsonPost({ action: "zoom-next", binding: "PageDown" }));
    expect(res.status).toBe(200);
    expect(setTmuxPrefix).toHaveBeenLastCalledWith("C-]");
  });
});
