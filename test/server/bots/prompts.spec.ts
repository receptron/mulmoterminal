// @vitest-environment node
import { afterEach, assert, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { BotStore } from "../../../server/bots/store.js";
import { BotService, type BotRuntime } from "../../../server/bots/service.js";
import { botScreen, choiceScreen, unknownPrompt } from "../../../server/bots/prompt-screen.js";
import { answerChoice } from "../../../server/bots/prompt-input.js";
import { idleScreen, permissionScreen, resumeScreen } from "./prompt-fixtures.js";

const directories: string[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
function setup(policy: "summary" | "ask" = "summary") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bot-prompts-"));
  directories.push(dir);
  const file = path.join(dir, "state.json");
  const store = new BotStore(file);
  const owner = randomUUID();
  const available = new Set<string>();
  let screen = idleScreen;
  const answer = vi.fn(async () => true);
  const runtime: BotRuntime = {
    spawn: vi.fn(),
    mark: vi.fn(),
    alive: () => true,
    kill: vi.fn(),
    ready: (id) => available.has(id),
    status: (id) => (available.has(id) ? "ready" : "unknown"),
    send: vi.fn(async () => true),
    inspect: () => botScreen(screen),
    answer,
  };
  const service = new BotService(store, runtime);
  const botId = service.create(owner, "editor", "Edit text", dir, policy).botId;
  const bot = store.state.bots[0];
  assert(bot);
  available.add(bot.sessionId);
  return {
    dir,
    file,
    store,
    owner,
    botId,
    bot,
    runtime,
    answer,
    service,
    available,
    setScreen: (value: string) => {
      screen = value;
    },
  };
}

function detected(screen: string) {
  const parsed = choiceScreen(screen);
  assert(parsed);
  return parsed.prompt;
}

describe("persistent CLI questions", () => {
  it("keeps a question and its task while the original frontend is closed, and another frontend can answer", async () => {
    const s = setup();
    const request = s.service.enqueue(s.owner, s.botId, "edit the draft");
    s.setScreen(permissionScreen());
    await s.service.tick();
    expect(s.runtime.send).not.toHaveBeenCalled();
    const saved = new BotStore(s.file);
    expect(saved.state.bots[0]?.requests[0]?.state).toBe("queued");
    expect(saved.state.prompts[0]).toMatchObject({ owner: s.owner, requestId: request.requestId, state: "waiting", notified: false });
    const restored = new BotService(saved, s.runtime);
    restored.recover();
    const other = randomUUID();
    const prompt = restored.list(other)[0]?.waitingPrompt;
    assert(prompt);
    expect(restored.list(other)[0]?.status).toBe("waiting_for_input");
    expect(restored.read(other, false)).toEqual([]); // shared inspection doesn't steal the mailbox
    await restored.respond(other, s.botId, prompt.promptId, "1");
    expect(saved.state.prompts[0]?.answeredBy).toBe(other);
    s.setScreen(idleScreen);
    await restored.tick();
    expect(s.runtime.send).toHaveBeenCalledExactlyOnceWith(s.bot.sessionId, expect.stringContaining(request.requestId));
    restored.reply(s.bot.sessionId, request.requestId, "edited", "result");
    expect(restored.read(s.owner, false)).toEqual([expect.objectContaining({ text: "edited" })]);
  });

  it("holds an in-flight request during a CLI question and does not resend it after the answer", async () => {
    const s = setup();
    const request = s.service.enqueue(s.owner, s.botId, "do once");
    await s.service.tick();
    s.service.onBlocked(s.bot.sessionId, "Permission needed");
    s.setScreen(permissionScreen());
    await s.service.tick();
    const prompt = s.service.inspect(randomUUID(), s.botId).waitingPrompt;
    assert(prompt);
    expect(s.store.state.bots[0]?.requests[0]?.state).toBe("sent");
    await s.service.respond(randomUUID(), s.botId, prompt.promptId, "1");
    s.service.onProgress(s.bot.sessionId);
    s.setScreen(idleScreen);
    await s.service.tick();
    expect(s.runtime.send).toHaveBeenCalledTimes(1);
    s.service.reply(s.bot.sessionId, request.requestId, "done", "result");
    expect(s.service.read(s.owner, false)).toEqual([expect.objectContaining({ text: "done" })]);
  });

  it("notifies the original frontend once when it returns, without completing the task", async () => {
    const s = setup();
    s.service.enqueue(s.owner, s.botId, "task");
    s.setScreen(permissionScreen());
    await s.service.tick();
    s.available.add(s.owner);
    await s.service.tick();
    await s.service.tick();
    expect(s.runtime.send).toHaveBeenCalledExactlyOnceWith(s.owner, expect.stringContaining("readBotReplies"));
    expect(s.service.read(s.owner, false)).toEqual([expect.objectContaining({ kind: "question", prompt: expect.objectContaining({ state: "waiting" }) })]);
    expect(s.service.list(randomUUID())[0]?.waitingPrompt).not.toBeNull();
    expect(s.store.state.bots[0]?.requests[0]?.state).toBe("queued");
  });

  it("claims a response durably before writing keys and refuses concurrent responses", async () => {
    const s = setup();
    const prompt = s.service.prompts.record(s.bot, detected(permissionScreen()));
    let finish: ((value: boolean) => void) | undefined;
    s.answer.mockImplementation(async () => {
      expect(new BotStore(s.file).state.prompts[0]?.state).toBe("answering");
      return new Promise<boolean>((resolve) => {
        finish = resolve;
      });
    });
    // BotPrompts captures the same mocked runtime function at construction.
    const first = s.service.respond(s.owner, s.botId, prompt.id, "1");
    await expect(s.service.respond(randomUUID(), s.botId, prompt.id, "2")).rejects.toThrow("already claimed");
    assert(finish);
    finish(true);
    await first;
    expect(s.runtime.answer).toHaveBeenCalledTimes(1);
    expect(s.store.state.prompts[0]?.answerId).toBe("1");
  });

  it("does not replay an answer after a crash and rejects stale question ids", async () => {
    const s = setup();
    const prompt = s.service.prompts.record(s.bot, detected(permissionScreen()));
    await s.service.respond(s.owner, s.botId, prompt.id, "1");
    const restored = new BotService(new BotStore(s.file), s.runtime);
    restored.recover();
    expect(restored.inspect(s.owner, s.botId).waitingPrompt?.state).toBe("uncertain");
    await expect(restored.respond(randomUUID(), s.botId, prompt.id, "1")).rejects.toThrow("already claimed");
    restored.prompts.record(s.bot, detected(permissionScreen("2", "Another command?")));
    await expect(restored.respond(s.owner, s.botId, prompt.id, "1")).rejects.toThrow("no longer current");
    expect(s.runtime.answer).toHaveBeenCalledTimes(1);
  });

  it("automatically selects summary with no frontend, but only after stable observations", async () => {
    vi.useFakeTimers();
    const s = setup();
    s.setScreen(resumeScreen());
    await s.service.tick();
    expect(s.runtime.answer).not.toHaveBeenCalled();
    vi.advanceTimersByTime(750);
    await s.service.tick();
    expect(s.runtime.answer).toHaveBeenCalledExactlyOnceWith(s.bot, expect.objectContaining({ kind: "resume-summary" }), "1");
    await s.service.tick();
    expect(s.runtime.answer).toHaveBeenCalledTimes(1);
    s.service.onStop(s.bot.sessionId, true);
    expect(s.service.inspect(s.owner, s.botId).waitingPrompt?.state).toBe("answering");
    vi.advanceTimersByTime(1500);
    await s.service.tick(); // delayed repaint must not create a second summary answer
    expect(s.runtime.answer).toHaveBeenCalledTimes(1);
    const restored = new BotService(new BotStore(s.file), s.runtime);
    restored.recover();
    await restored.tick();
    expect(s.runtime.answer).toHaveBeenCalledTimes(1);
    s.setScreen(idleScreen);
    await restored.tick();
    expect(restored.inspect(s.owner, s.botId).waitingPrompt).toBeNull();
  });

  it("respects ask policy and never automatically answers permission or unknown screens", async () => {
    vi.useFakeTimers();
    const s = setup("ask");
    for (const screen of [resumeScreen(), permissionScreen(), "Login\nPaste your authentication code:"]) {
      s.setScreen(screen);
      await s.service.tick();
      vi.advanceTimersByTime(10000);
      await s.service.tick();
    }
    expect(s.runtime.answer).not.toHaveBeenCalled();
    const prompt = s.service.inspect(s.owner, s.botId).waitingPrompt;
    assert(prompt);
    await expect(s.service.respond(s.owner, s.botId, prompt.promptId, "1")).rejects.toThrow("cannot accept");
    expect(() => s.service.inspect(s.bot.sessionId, s.botId)).toThrow("only a frontend");
  });

  it("migrates v2 state without losing tasks and applies the default summary policy", () => {
    const s = setup();
    s.service.enqueue(s.owner, s.botId, "existing task");
    const { prompts, ...withoutPrompts } = s.store.state;
    expect(prompts).toEqual([]);
    const legacy = {
      ...withoutPrompts,
      version: 2,
      bots: s.store.state.bots.map(({ resumePolicy, ...bot }) => {
        expect(resumePolicy).toBe("summary");
        return bot;
      }),
    };
    fs.writeFileSync(s.file, JSON.stringify(legacy));
    const restored = new BotStore(s.file);
    expect(restored.state.version).toBe(3);
    expect(restored.state.prompts).toEqual([]);
    expect(restored.state.bots[0]).toMatchObject({ id: s.botId, resumePolicy: "summary", requests: [expect.objectContaining({ text: "existing task" })] });
  });

  it("retains an uncertain answer when terminal submission fails, without retrying it", async () => {
    const s = setup();
    const prompt = s.service.prompts.record(s.bot, detected(permissionScreen()));
    s.answer.mockRejectedValueOnce(new Error("partial write"));
    await expect(s.service.respond(s.owner, s.botId, prompt.id, "1")).rejects.toThrow("partial write");
    expect(new BotStore(s.file).state.prompts[0]?.state).toBe("uncertain");
    await expect(s.service.respond(randomUUID(), s.botId, prompt.id, "1")).rejects.toThrow("already claimed");
    expect(s.answer).toHaveBeenCalledTimes(1);
  });

  it("holds uncertain task delivery across restart without losing or automatically replaying it", async () => {
    const s = setup();
    s.service.enqueue(s.owner, s.botId, "do once");
    vi.mocked(s.runtime.send).mockRejectedValueOnce(new Error("lost acknowledgement"));
    await s.service.tick();
    expect(s.store.state.bots[0]?.requests[0]?.state).toBe("uncertain");
    expect(s.service.inspect(s.owner, s.botId).waitingPrompt?.kind).toBe("unknown");
    const restored = new BotService(new BotStore(s.file), s.runtime);
    restored.recover();
    await restored.tick();
    expect(s.runtime.send).toHaveBeenCalledTimes(1);
    expect(restored.inspect(s.owner, s.botId).waitingPrompt?.kind).toBe("unknown");
  });
});

describe("verified terminal choice input", () => {
  it("navigates to the named option and verifies it before Enter", async () => {
    const s = setup();
    const prompt = s.service.prompts.record(s.bot, detected(resumeScreen()));
    let raw = resumeScreen("2");
    const write = vi.fn((text) => {
      if (text === "\x1b[A") raw = resumeScreen("1");
    });
    expect(await answerChoice({ capture: () => raw, exclusive: () => true, write, pause: async () => {} }, prompt, "1")).toBe(true);
    expect(write.mock.calls).toEqual([["\x1b[A"], ["\r"]]);
  });

  it("never sends Enter when the dialog changes during navigation", async () => {
    const s = setup();
    const prompt = s.service.prompts.record(s.bot, detected(resumeScreen()));
    let raw = resumeScreen();
    const write = vi.fn(() => {
      raw = permissionScreen();
    });
    expect(await answerChoice({ capture: () => raw, exclusive: () => true, write, pause: async () => {} }, prompt, "1")).toBe(false);
    expect(write.mock.calls).toEqual([["\x1b[A"]]);
  });

  it("refuses extra clients, vanished dialogs, unknown layouts and invalid choices", async () => {
    const s = setup();
    const prompt = s.service.prompts.record(s.bot, detected(resumeScreen()));
    const write = vi.fn();
    const terminal = { capture: () => resumeScreen(), exclusive: () => false, write, pause: async () => {} };
    expect(await answerChoice(terminal, prompt, "1")).toBe(false);
    expect(await answerChoice({ ...terminal, exclusive: () => true, capture: () => idleScreen }, prompt, "1")).toBe(false);
    expect(await answerChoice({ ...terminal, exclusive: () => true }, prompt, "9")).toBe(false);
    expect(await answerChoice({ ...terminal, exclusive: () => true }, { ...prompt, ...unknownPrompt("login") }, "1")).toBe(false);
    expect(write).not.toHaveBeenCalled();
  });
});
