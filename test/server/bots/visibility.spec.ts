// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { mountTmuxRoutes } from "../../../server/infra/tmux-routes.js";
import { markBotSession } from "../../../server/bots/session-marker.js";
import { routeCall } from "../../helpers/routeCall.js";
import type { SurvivingSession } from "../../../common/survivingSessions.js";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "bot-visible-"));
  vi.stubEnv("MULMOTERMINAL_HOME", dir);
});
afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(dir, { recursive: true, force: true });
});
describe("Bot terminal visibility", () => {
  it("omits Bots from the tmux survivor picker even after their process ends", async () => {
    const bot = randomUUID();
    const normal = randomUUID();
    markBotSession(bot);
    const row = (key: string): SurvivingSession => ({ key, cwd: "/tmp", agent: "claude", idleSeconds: 0, attached: false, resumable: true, reapable: false });
    const app = express();
    mountTmuxRoutes(app, {
      isAllowedOrigin: () => true,
      isValidSessionId: () => true,
      reapSession: vi.fn(),
      hasTmux: () => false,
      killTmux: () => true,
      sweep: () => ({ reaped: [], heldBack: 0, recent: 0, unclear: 0 }),
      survivingSessions: async () => [row(normal), row(bot)],
    });
    expect((await routeCall(app)("/api/tmux/sessions")).body.sessions).toEqual([row(normal)]);
  });
});
