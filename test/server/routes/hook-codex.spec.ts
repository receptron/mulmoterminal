// @vitest-environment node
// The codex branch of /api/hook, pinned at the ROUTE: codex-hook.spec.ts proves the translation,
// this proves it is wired — that a PermissionRequest reaches the flag claude's Notification sets, and
// that it is attributed by the header alone.
import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import { routeCall, jsonPost } from "../../helpers/routeCall";
import { mountHookRoute } from "../../../server/routes/hook-routes";
import { ptys } from "../../../server/session/registry";

vi.mock("../../../server/session/session-reads.js", () => ({
  latestUserPrompt: vi.fn(async () => null),
  sessionLastTurn: vi.fn(async () => ({ prompt: null, reply: null })),
}));

const ID = "4078f9a6-4ce0-4906-a544-ca0cf917eb96";
const CODEX_OWN_ID = "01a0d782-f3c7-7b91-90a5-f42a6496d9a2";
const PAYLOAD = {
  session_id: CODEX_OWN_ID,
  cwd: "/tmp/probe",
  hook_event_name: "PermissionRequest",
  tool_name: "Bash",
  tool_input: { command: "touch /tmp/x", description: "Allow creating /tmp/x outside the sandbox?" },
};

const deps = {
  setWorking: vi.fn(),
  setWaiting: vi.fn(),
  publishActivity: vi.fn(),
  forgetTitle: vi.fn(),
  noteTitleTurn: vi.fn(),
  noteWorkPhase: vi.fn(),
  maybeGenerateTitle: vi.fn(async () => {}),
  recordToolCallStart: vi.fn(async () => {}),
  recordToolCallEnd: vi.fn(async () => {}),
  publishDirConfig: vi.fn(),
  publishFileWrite: vi.fn(),
  publishPromptSubmitted: vi.fn(),
  publishQuestion: vi.fn(),
  uiPort: "34567",
};

const app = express();
app.use(express.json());
mountHookRoute(app, deps);
const call = routeCall(app);

const postCodex = async (headers: Record<string, string>) => {
  const res = await call("/api/hook", jsonPost(PAYLOAD, { "x-mt-agent": "codex", "x-mt-hook": "PermissionRequest", ...headers }));
  expect(res.status).toBe(200);
};

const liveCell = (active: boolean) => {
  const entry = { term: { pid: 1 }, ws: null, buffer: "", cwd: "/tmp/probe", tmux: true, active, agent: "codex" };
  ptys.set(ID, entry as unknown as NonNullable<ReturnType<typeof ptys.get>>);
};

beforeEach(() => {
  ptys.delete(ID);
  vi.clearAllMocks();
});

describe("/api/hook with x-mt-agent: codex", () => {
  it("flags an unwatched cell as blocked on the approval dialog", async () => {
    liveCell(false);
    await postCodex({ "x-mt-session": ID });
    expect(deps.setWaiting).toHaveBeenCalledWith(ID, true, "Notification");
    expect(deps.setWorking).not.toHaveBeenCalled();
  });

  it("leaves the cell the user is looking at alone", async () => {
    liveCell(true);
    await postCodex({ "x-mt-session": ID });
    expect(deps.setWaiting).not.toHaveBeenCalled();
  });

  it("does nothing without x-mt-session, even though codex's own id is a well-formed uuid", async () => {
    await postCodex({});
    expect(deps.setWaiting).not.toHaveBeenCalled();
    expect(deps.setWorking).not.toHaveBeenCalled();
  });

  it("ignores a codex hook it did not register", async () => {
    liveCell(false);
    const res = await call("/api/hook", jsonPost(PAYLOAD, { "x-mt-agent": "codex", "x-mt-hook": "Stop", "x-mt-session": ID }));
    expect(res.status).toBe(200);
    expect(deps.setWaiting).not.toHaveBeenCalled();
    expect(deps.setWorking).not.toHaveBeenCalled();
  });
});
