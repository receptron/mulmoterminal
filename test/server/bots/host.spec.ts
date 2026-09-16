// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { startBots, dispatchBotTool, handleBotHook } from "../../../server/bots/host.js";
import { ptys } from "../../../server/session/registry.js";
import type { PtyEntry } from "../../../server/session/types.js";
import { forgetBotInput, noteBotUserInput } from "../../../server/bots/input-gate.js";
import { isBotSession } from "../../../server/bots/session-marker.js";
import { tmuxAttachedClientCount, tmuxCaptureStyledPane } from "../../../server/infra/tmux.js";
import { idleScreen, resumeScreen, permissionScreen } from "./prompt-fixtures.js";
import { observeSessionBotHook } from "../../../server/bots/hooks.js";

vi.mock("../../../server/session/registry.js", () => ({ ptys: new Map(), backgroundMarkers: new Set() }));
vi.mock("../../../server/infra/tmux.js", () => ({
  tmuxAvailable: () => true,
  tmuxHasSession: () => false,
  tmuxKillSession: vi.fn(() => true),
  tmuxAttachedClientCount: vi.fn(() => 1),
  tmuxCaptureStyledPane: vi.fn(() => "────────────────\n❯ \n────────────────\n? for shortcuts\n"),
}));
vi.mock("../../../server/config/config-routes.js", () => ({ getTerminalSubmit: () => "cr" }));

let dir: string;
const owner = randomUUID();
function entry(id: string): PtyEntry {
  return {
    agent: "claude",
    cwd: dir,
    ws: null,
    active: false,
    tmux: true,
    buffer: "",
    term: {
      write: vi.fn((text: string) => {
        if (text === "\r") handleBotHook(id, "UserPromptSubmit");
      }),
    } as unknown as PtyEntry["term"],
  };
}
const spawn = vi.fn((id: string) => {
  const value = entry(id);
  ptys.set(id, value);
  return value;
});
beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(tmuxCaptureStyledPane).mockReturnValue("────────────────\n❯ \n────────────────\n? for shortcuts\n");
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "bot-host-"));
  vi.stubEnv("MULMOTERMINAL_HOME", dir);
  ptys.set(owner, entry(owner));
  startBots(34567, spawn, (id) => {
    ptys.delete(id);
    forgetBotInput(id);
  });
});
afterEach(() => {
  for (const id of ptys.keys()) forgetBotInput(id);
  ptys.clear();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});
function create() {
  dispatchBotTool(owner, "manageBot", { action: "create", name: "helper", role: "Find test gaps" });
  const id = spawn.mock.calls[0]?.[0];
  if (!id) throw new Error("Bot was not spawned");
  const state: { bots: Array<{ id: string }> } = JSON.parse(fs.readFileSync(path.join(dir, "bots", "34567", "state.json"), "utf8"));
  const botId = state.bots[0]?.id;
  if (!botId) throw new Error("Bot was not saved");
  return { id, botId };
}

describe("Bot host transport", () => {
  it("disables tools when recovery cannot persist state, preserving the saved Bots", async () => {
    const bot = create();
    vi.mocked(tmuxCaptureStyledPane).mockReturnValue(permissionScreen());
    await vi.advanceTimersByTimeAsync(1600);
    const file = path.join(dir, "bots", "34567", "state.json");
    const before = fs.readFileSync(file, "utf8");
    vi.clearAllTimers();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const write = vi.spyOn(fs, "writeFileSync").mockImplementationOnce(() => {
      throw new Error("disk unavailable");
    });
    try {
      startBots(34567, spawn, vi.fn());
      expect(error).toHaveBeenCalledWith(expect.stringContaining("initialization failed"), expect.any(Error));
      expect(() => dispatchBotTool(owner, "manageBot", { action: "list" })).toThrow("service is not available");
      expect(vi.getTimerCount()).toBe(0);
      expect(fs.readFileSync(file, "utf8")).toBe(before);
      expect(ptys.has(bot.id)).toBe(true);
    } finally {
      write.mockRestore();
      error.mockRestore();
    }
  });

  it("spawns without a viewer and uses an MCP reply to start a frontend turn", async () => {
    const bot = create();
    expect(spawn).toHaveBeenCalledWith(bot.id, null, null, expect.objectContaining({ cwd: dir, botRole: "Find test gaps", attachGuiMcp: true }));
    expect(isBotSession(bot.id)).toBe(true);
    const result = dispatchBotTool(owner, "sendToBot", { botId: bot.botId, text: "Inspect code" }) as { requestId: string };
    handleBotHook(bot.id, "UserPromptSubmit");
    handleBotHook(bot.id, "Stop");
    await vi.advanceTimersByTimeAsync(1600);
    expect(ptys.get(bot.id)?.term.write).toHaveBeenCalledWith(expect.stringContaining(result.requestId));
    dispatchBotTool(bot.id, "replyToFrontend", { requestId: result.requestId, text: "Test the reconnect path" });
    handleBotHook(bot.id, "Stop");
    await vi.advanceTimersByTimeAsync(1600);
    expect(ptys.get(owner)?.term.write).not.toHaveBeenCalled(); // unknown frontend readiness
    handleBotHook(owner, "Stop");
    await vi.advanceTimersByTimeAsync(1600);
    expect(ptys.get(owner)?.term.write).toHaveBeenCalledWith(expect.stringContaining("readBotReplies"));
    expect(ptys.get(owner)?.term.write).toHaveBeenCalledWith("\r");
    expect(dispatchBotTool(owner, "readBotReplies", {})).toEqual([expect.objectContaining({ text: "Test the reconnect path" })]);
    await vi.advanceTimersByTimeAsync(6000);
    expect(ptys.get(owner)?.term.write).toHaveBeenCalledTimes(2);
  });

  it("holds drafts and other tmux clients; resumes after a genuine user turn", async () => {
    const bot = create();
    dispatchBotTool(owner, "sendToBot", { botId: bot.botId, text: "task" });
    dispatchBotTool(owner, "manageBot", { action: "kill", botId: bot.botId }); // a reply without using a model
    noteBotUserInput(owner);
    handleBotHook(owner, "Stop");
    await vi.advanceTimersByTimeAsync(6000);
    expect(ptys.get(owner)?.term.write).not.toHaveBeenCalled();
    handleBotHook(owner, "UserPromptSubmit");
    handleBotHook(owner, "Stop");
    vi.mocked(tmuxAttachedClientCount).mockReturnValue(2);
    await vi.advanceTimersByTimeAsync(2000);
    expect(ptys.get(owner)?.term.write).not.toHaveBeenCalled();
    vi.mocked(tmuxAttachedClientCount).mockReturnValue(1);
    await vi.advanceTimersByTimeAsync(1600);
    expect(ptys.get(owner)?.term.write).toHaveBeenCalledWith("\r");
    expect(isBotSession(bot.id)).toBe(true); // killed transcripts stay hidden
  });

  it("hides new transcript ids after compact and distinguishes idle reminders from dialogs", async () => {
    const bot = create();
    const transcript = randomUUID();
    expect(observeSessionBotHook(bot.id, { session_id: transcript, source: "compact" }, "SessionStart", undefined)).toBe(true);
    expect(isBotSession(transcript)).toBe(true);
    expect(observeSessionBotHook(owner, {}, "Notification", "idle_prompt")).toBe(false);
    dispatchBotTool(owner, "sendToBot", { botId: bot.botId, text: "task" });
    observeSessionBotHook(bot.id, {}, "Notification", "idle_prompt");
    await vi.advanceTimersByTimeAsync(1600);
    expect(ptys.get(bot.id)?.term.write).toHaveBeenCalledWith(expect.stringContaining("task"));
    observeSessionBotHook(bot.id, {}, "Notification", "permission_prompt");
    expect(dispatchBotTool(owner, "readBotReplies", {})).toEqual([expect.objectContaining({ kind: "question" })]);
  });

  it("does not mark a notification delivered when the CLI never acknowledges the submit", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const bot = create();
    dispatchBotTool(owner, "sendToBot", { botId: bot.botId, text: "task" });
    dispatchBotTool(owner, "manageBot", { action: "kill", botId: bot.botId });
    const frontend = ptys.get(owner);
    if (!frontend) throw new Error("Missing frontend");
    vi.mocked(frontend.term.write).mockImplementation(() => {});
    handleBotHook(owner, "Stop");
    await vi.advanceTimersByTimeAsync(8000);
    const saved: { replies: Array<{ notified: boolean }> } = JSON.parse(fs.readFileSync(path.join(dir, "bots", "34567", "state.json"), "utf8"));
    expect(saved.replies[0]?.notified).toBe(false);
    expect(frontend.term.write).toHaveBeenCalledTimes(2); // no blind replay after timeout
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("wakes a second terminal for a shared Bot's reply, leaving its creator idle", async () => {
    const bot = create();
    const other = randomUUID();
    ptys.set(other, entry(other));
    expect(dispatchBotTool(other, "manageBot", { action: "list" })).toEqual([expect.objectContaining({ botId: bot.botId })]);
    const request = dispatchBotTool(other, "sendToBot", { botId: bot.botId, text: "shared task" }) as { requestId: string };
    handleBotHook(bot.id, "UserPromptSubmit");
    handleBotHook(bot.id, "Stop");
    handleBotHook(owner, "Stop");
    handleBotHook(other, "Stop");
    await vi.advanceTimersByTimeAsync(1600);
    dispatchBotTool(bot.id, "replyToFrontend", { requestId: request.requestId, text: "for second terminal" });
    handleBotHook(bot.id, "Stop");
    await vi.advanceTimersByTimeAsync(1600);
    expect(ptys.get(other)?.term.write).toHaveBeenCalledWith(expect.stringContaining("readBotReplies"));
    expect(ptys.get(other)?.term.write).toHaveBeenCalledWith("\r");
    expect(ptys.get(owner)?.term.write).not.toHaveBeenCalled();
    expect(dispatchBotTool(owner, "readBotReplies", {})).toEqual([]);
    expect(dispatchBotTool(other, "readBotReplies", {})).toEqual([expect.objectContaining({ text: "for second terminal" })]);
  });

  it("recovers idle surviving Bots after restart and accepts work from a second terminal", async () => {
    const bot = create();
    vi.clearAllTimers(); // the previous host stops, while the tmux-backed PTY survives
    forgetBotInput(bot.id);
    const bar = "─".repeat(80);
    vi.mocked(tmuxCaptureStyledPane).mockReturnValue(`${bar}\n❯ \u001b[2msuggestion\u001b[0m\n${bar}\n? for shortcuts\n`);
    startBots(34567, spawn, (id) => {
      ptys.delete(id);
    });
    const other = randomUUID();
    ptys.set(other, entry(other));
    const request = dispatchBotTool(other, "sendToBot", { botId: bot.botId, text: "after restart" }) as { requestId: string };
    await vi.advanceTimersByTimeAsync(4000);
    expect(ptys.get(bot.id)?.term.write).toHaveBeenCalledWith(expect.stringContaining(request.requestId));
    expect(ptys.get(owner)?.term.write).not.toHaveBeenCalled();
    expect(tmuxCaptureStyledPane).not.toHaveBeenCalledWith(owner, 0);
    dispatchBotTool(bot.id, "replyToFrontend", { requestId: request.requestId, text: "same context" });
    expect(dispatchBotTool(other, "readBotReplies", {})).toEqual([expect.objectContaining({ text: "same context" })]);
    expect(dispatchBotTool(other, "manageBot", { action: "list" })).toEqual([expect.objectContaining({ botId: bot.botId })]);
    vi.mocked(tmuxCaptureStyledPane).mockReturnValue(null);
  });

  it("automatically answers a summary dialog and then dispatches the queued task with the same request id", async () => {
    const bot = create();
    const request = dispatchBotTool(owner, "sendToBot", { botId: bot.botId, text: "after summary" }) as { requestId: string };
    let screen = resumeScreen("2");
    vi.mocked(tmuxCaptureStyledPane).mockImplementation(() => screen);
    const terminal = ptys.get(bot.id)?.term;
    if (!terminal) throw new Error("No Bot terminal");
    vi.mocked(terminal.write).mockImplementation((text) => {
      if (text === "\x1b[A") screen = resumeScreen("1");
      if (text === "\r" && screen.includes("Resume from summary")) {
        handleBotHook(bot.id, "PreCompact");
        screen = idleScreen;
        handleBotHook(bot.id, "SessionStart", "compact");
      } else if (text === "\r") handleBotHook(bot.id, "UserPromptSubmit");
    });
    await vi.advanceTimersByTimeAsync(4500);
    expect(terminal.write).toHaveBeenCalledWith("\x1b[A");
    expect(terminal.write).toHaveBeenCalledWith(expect.stringContaining(request.requestId));
    expect(vi.mocked(terminal.write).mock.calls.filter(([text]) => text === "\r")).toHaveLength(2);
    expect(dispatchBotTool(owner, "manageBot", { action: "inspect", botId: bot.botId })).toMatchObject({
      waitingPrompt: null,
      requests: [{ requestId: request.requestId, state: "sent" }],
    });
  });

  it("exposes a CLI question to a different terminal and accepts a verified answer without a Bot UI", async () => {
    const bot = create();
    let screen = permissionScreen("2");
    vi.mocked(tmuxCaptureStyledPane).mockImplementation(() => screen);
    await vi.advanceTimersByTimeAsync(1600);
    const other = randomUUID();
    ptys.set(other, entry(other));
    const details = dispatchBotTool(other, "manageBot", { action: "inspect", botId: bot.botId }) as { waitingPrompt: { promptId: string } };
    const terminal = ptys.get(bot.id)?.term;
    if (!terminal) throw new Error("No Bot terminal");
    vi.mocked(terminal.write).mockImplementation((text) => {
      if (text === "\x1b[A") screen = permissionScreen("1");
      if (text === "\r") screen = idleScreen;
    });
    const answer = dispatchBotTool(other, "manageBot", { action: "respond", botId: bot.botId, promptId: details.waitingPrompt.promptId, optionId: "1" });
    await vi.advanceTimersByTimeAsync(1600);
    await expect(answer).resolves.toMatchObject({ status: "answering" });
    expect(terminal.write).toHaveBeenCalledWith("\r");
    expect(dispatchBotTool(other, "manageBot", { action: "inspect", botId: bot.botId })).toMatchObject({ waitingPrompt: null });
    expect(isBotSession(bot.id)).toBe(true);
  });

  it("refuses unsupported frontends and frontend-only tools called by Bots", () => {
    const bot = create();
    expect(() => dispatchBotTool(bot.id, "manageBot", { action: "list" })).toThrow("not available");
    expect(() => dispatchBotTool(owner, "replyToFrontend", { requestId: randomUUID(), text: "fake" })).toThrow("not available");
    const frontend = ptys.get(owner);
    if (!frontend) throw new Error("Missing frontend");
    frontend.agent = "codex";
    expect(() => dispatchBotTool(owner, "manageBot", { action: "create", name: "unsupported", role: "role" })).toThrow("requires a live Claude");
    expect(() => dispatchBotTool(owner, "sendToBot", { botId: bot.botId, text: "unsupported" })).toThrow("requires a live Claude");
    expect(() => dispatchBotTool(owner, "manageBot", { action: "compact", botId: bot.botId })).toThrow("requires a live Claude");
    expect(spawn).toHaveBeenCalledOnce();
  });
});
