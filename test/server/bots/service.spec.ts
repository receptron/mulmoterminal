// @vitest-environment node
import { assert, afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { BotStore } from "../../../server/bots/store.js";
import { BotService, type BotRuntime } from "../../../server/bots/service.js";

const directories: string[] = [];
afterEach(() => {
  for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bot-service-"));
  directories.push(dir);
  const file = path.join(dir, "state.json");
  const owner = randomUUID();
  const ready = new Set<string>();
  const live = new Set<string>();
  const runtime: BotRuntime = {
    spawn: vi.fn((bot) => {
      live.add(bot.sessionId);
    }),
    mark: vi.fn(),
    alive: (id) => live.has(id),
    kill: vi.fn((id) => {
      live.delete(id);
    }),
    ready: (id) => ready.has(id),
    status: (id) => (ready.has(id) ? "ready" : "busy"),
    send: vi.fn(async (id) => {
      ready.delete(id);
      return true;
    }),
  };
  const store = new BotStore(file);
  const service = new BotService(store, runtime);
  const botId = service.create(owner, "research", "Inspect tests", dir).botId;
  const bot = store.state.bots[0];
  assert(bot);
  const sessionId = bot.sessionId;
  return { service, store, runtime, owner, botId, sessionId, ready, live, file };
}

describe("durable background Bots", () => {
  it("rejects duplicate names across terminals without spawning or changing roles", () => {
    const s = setup();
    const before = JSON.stringify(s.store.state);
    expect(() => s.service.create(randomUUID(), " research ", "different role", "/elsewhere")).toThrow(s.botId);
    expect(s.runtime.spawn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(s.store.state)).toBe(before);
    expect(() => s.service.create(s.owner, "   ", "role", "/tmp")).toThrow("blank");
  });

  it("identifies a replacement after another terminal kills the listed Bot, without sending or creating", () => {
    const s = setup();
    const other = randomUUID();
    const staleId = s.service.list(other)[0]?.botId;
    expect(staleId).toBe(s.botId);
    s.service.kill(s.owner, s.botId);
    const replacement = s.service.create(s.owner, "research", "Inspect tests", "/tmp");
    expect(() => s.service.enqueue(other, s.botId, "task")).toThrow(replacement.botId);
    expect(s.store.state.bots[1]?.requests).toEqual([]);
    expect(s.runtime.spawn).toHaveBeenCalledTimes(2);
    expect(s.runtime.kill).toHaveBeenCalledTimes(1);
    const request = s.service.enqueue(other, replacement.botId, "task");
    expect(s.store.state.bots[1]?.requests[0]).toMatchObject({ id: request.requestId, requester: other });
  });

  it("preserves a live Bot and its context when readiness times out", async () => {
    const s = setup();
    s.runtime.status = () => "unknown";
    s.service.enqueue(s.owner, s.botId, "not delivered");
    s.store.change((state) => {
      const request = state.bots[0]?.requests[0];
      assert(request);
      request.createdAt -= 120001;
    });
    await s.service.tick();
    expect(s.runtime.send).not.toHaveBeenCalled();
    expect(s.runtime.kill).not.toHaveBeenCalled();
    expect(s.service.list(s.owner)[0]?.botId).toBe(s.botId);
    expect(s.service.read(s.owner, false)[0]?.kind).toBe("question");
    expect(s.store.state.bots[0]?.requests[0]?.state).toBe("queued");
  });

  it("returns immediately, serializes requests, persists the reply before waking the owning frontend", async () => {
    const s = setup();
    const a = s.service.enqueue(s.owner, s.botId, "first\n  indented");
    const b = s.service.enqueue(s.owner, s.botId, "second");
    await s.service.tick();
    expect(s.runtime.send).not.toHaveBeenCalled();
    s.ready.add(s.sessionId);
    await s.service.tick();
    expect(s.runtime.send).toHaveBeenCalledExactlyOnceWith(s.sessionId, expect.stringContaining(JSON.stringify("first\n  indented")));
    s.ready.add(s.sessionId);
    await s.service.tick(); // even a spurious ready signal cannot send over an outstanding request
    expect(s.runtime.send).toHaveBeenCalledTimes(1);
    s.service.reply(s.sessionId, a.requestId, "found a gap", "result");
    expect(new BotStore(s.file).state.replies[0]?.text).toBe("found a gap");
    s.ready.delete(s.sessionId);
    await s.service.tick();
    expect(s.runtime.send).toHaveBeenCalledTimes(1); // frontend busy
    s.ready.add(s.owner);
    await s.service.tick();
    expect(s.runtime.send).toHaveBeenLastCalledWith(s.owner, expect.stringContaining("readBotReplies"));
    expect(s.service.read(s.owner, false)).toEqual([expect.objectContaining({ requestId: a.requestId, text: "found a gap" })]);
    expect(s.service.read(s.owner, false)).toEqual([]);
    s.ready.add(s.sessionId);
    await s.service.tick();
    expect(s.runtime.send).toHaveBeenLastCalledWith(s.sessionId, expect.stringContaining(b.requestId));
  });

  it("rejects unknown Bots, forged/queued replies, and Bot-created Bots", async () => {
    const s = setup();
    const request = s.service.enqueue(s.owner, s.botId, "task");
    expect(() => s.service.kill(s.owner, randomUUID())).toThrow("not found");
    expect(() => s.service.reply(s.sessionId, request.requestId, "early", "result")).toThrow("not assigned");
    expect(() => s.service.create(s.sessionId, "nested", "role", "/tmp")).toThrow("only a frontend");
    s.ready.add(s.sessionId);
    await s.service.tick();
    expect(() => s.service.reply(randomUUID(), request.requestId, "wrong", "result")).toThrow();
    s.service.reply(s.sessionId, request.requestId, "ok", "result");
    expect(s.service.reply(s.sessionId, request.requestId, "duplicate", "result")).toEqual({ received: true, duplicate: true });
    expect(s.store.state.replies).toHaveLength(1);
    expect(s.service.read(randomUUID(), true)).toEqual([]);
  });

  it("coalesces unread replies and can recover a lost read response", async () => {
    const s = setup();
    for (const text of ["a", "b"]) {
      const request = s.service.enqueue(s.owner, s.botId, text);
      s.ready.add(s.sessionId);
      await s.service.tick();
      s.service.reply(s.sessionId, request.requestId, text, "result");
    }
    s.ready.add(s.owner);
    await s.service.tick();
    expect(vi.mocked(s.runtime.send).mock.calls.filter(([id]) => id === s.owner)).toHaveLength(1);
    const replies = s.service.read(s.owner, false);
    expect(replies).toHaveLength(2);
    expect(s.service.read(s.owner, true)).toEqual(replies);
    s.ready.add(s.owner);
    await s.service.tick();
    expect(vi.mocked(s.runtime.send).mock.calls.filter(([id]) => id === s.owner)).toHaveLength(1);
  });

  it("queues compact, ignores auto-compaction during work, and keeps the same Bot", async () => {
    const s = setup();
    const work = s.service.enqueue(s.owner, s.botId, "task");
    const compact = s.service.enqueue(s.owner, s.botId, "", "compact");
    s.ready.add(s.sessionId);
    await s.service.tick();
    s.service.onStop(s.sessionId, true);
    expect(s.store.state.replies).toHaveLength(0);
    s.service.reply(s.sessionId, work.requestId, "ok", "result");
    s.ready.add(s.sessionId);
    await s.service.tick();
    expect(s.runtime.send).toHaveBeenLastCalledWith(s.sessionId, "/compact");
    s.service.onStop(s.sessionId, true);
    expect(s.service.read(s.owner, false)).toContainEqual(expect.objectContaining({ requestId: compact.requestId, kind: "result" }));
    expect(s.runtime.spawn).toHaveBeenCalledTimes(1);
    expect(s.service.list(s.owner)[0]?.botId).toBe(s.botId);
  });

  it("reports missing replies and blocked turns instead of leaving the requester waiting", async () => {
    const s = setup();
    s.service.enqueue(s.owner, s.botId, "task");
    s.ready.add(s.sessionId);
    await s.service.tick();
    s.service.onStop(s.sessionId);
    expect(s.store.state.replies[0]?.kind).toBe("error");
    s.service.enqueue(s.owner, s.botId, "permission");
    s.ready.add(s.sessionId);
    await s.service.tick();
    s.service.onBlocked(s.sessionId);
    s.service.onBlocked(s.sessionId);
    expect(s.store.state.replies).toHaveLength(1);
    expect(s.store.state.prompts).toHaveLength(1);
    expect(s.store.state.bots[0]?.requests[1]?.state).toBe("sent");
  });

  it("kill resolves outstanding work and cannot resurrect the Bot", async () => {
    const s = setup();
    s.service.enqueue(s.owner, s.botId, "a");
    s.service.enqueue(s.owner, s.botId, "b");
    s.ready.add(s.sessionId);
    await s.service.tick();
    expect(s.service.kill(s.owner, s.botId)).toEqual({ ended: true });
    expect(s.runtime.kill).toHaveBeenCalledWith(s.sessionId);
    expect(s.service.list(s.owner)).toEqual([]);
    expect(s.service.read(s.owner, false)).toHaveLength(2);
    expect(() => s.service.enqueue(s.owner, s.botId, "c")).toThrow("ended");
  });

  it("retains mailbox and does not replay a possibly delivered request after restart", async () => {
    const s = setup();
    const request = s.service.enqueue(s.owner, s.botId, "do once");
    s.ready.add(s.sessionId);
    await s.service.tick();
    s.store.change((state) => {
      const request = state.bots[0]?.requests[0];
      assert(request);
      request.state = "uncertain";
    });
    const resumed = new BotService(new BotStore(s.file), s.runtime);
    resumed.recover();
    s.ready.add(s.sessionId);
    await resumed.tick();
    expect(s.runtime.send).toHaveBeenCalledTimes(1);
    resumed.reply(s.sessionId, request.requestId, "finished", "result");
    const restored = new BotService(new BotStore(s.file), s.runtime);
    s.ready.add(s.owner);
    await restored.tick();
    expect(s.runtime.send).toHaveBeenLastCalledWith(s.owner, expect.stringContaining("readBotReplies"));
    expect(restored.read(s.owner, false)[0]?.text).toBe("finished");
  });

  it.each(["kill", "reply"])("does not create a stale delivery question after a concurrent %s", async (action) => {
    const s = setup();
    const request = s.service.enqueue(s.owner, s.botId, "do once");
    let fail: ((error: Error) => void) | undefined;
    const started = new Promise<void>((resolve) => {
      vi.mocked(s.runtime.send).mockImplementationOnce(async () => {
        resolve();
        return new Promise<boolean>((_resolve, reject) => {
          fail = reject;
        });
      });
    });
    s.ready.add(s.sessionId);
    const tick = s.service.tick();
    await started;
    if (action === "kill") s.service.kill(randomUUID(), s.botId);
    else s.service.reply(s.sessionId, request.requestId, "done", "result");
    assert(fail);
    fail(new Error("lost acknowledgement"));
    await tick;
    expect(new BotStore(s.file).state.prompts).toEqual([]);
    expect(s.service.inspect(s.owner, s.botId).waitingPrompt).toBeNull();
    expect(s.service.read(s.owner, false)).toEqual([expect.objectContaining({ requestId: request.requestId, kind: action === "kill" ? "error" : "result" })]);
  });

  it("shares one Bot across terminals but sends each reply and wakeup only to its requester", async () => {
    const s = setup();
    const other = randomUUID();
    expect(s.service.list(other)[0]?.botId).toBe(s.botId);
    expect(s.service.list(other)[0]?.cwd).toBe(s.service.list(s.owner)[0]?.cwd);
    const first = s.service.enqueue(s.owner, s.botId, "from creator");
    const second = s.service.enqueue(other, s.botId, "from another terminal");
    s.ready.add(s.sessionId);
    await s.service.tick();
    s.service.reply(s.sessionId, first.requestId, "first result", "result");
    s.ready.add(s.owner);
    s.ready.add(other);
    await s.service.tick();
    expect(s.runtime.send).toHaveBeenLastCalledWith(s.owner, expect.stringContaining("readBotReplies"));
    expect(s.service.read(other, false)).toEqual([]);
    expect(s.service.read(s.owner, false)).toEqual([expect.objectContaining({ requestId: first.requestId })]);
    s.ready.add(s.sessionId);
    await s.service.tick();
    expect(s.runtime.send).toHaveBeenLastCalledWith(s.sessionId, expect.stringContaining(second.requestId));
    s.service.reply(s.sessionId, second.requestId, "second result", "result");
    s.ready.add(s.owner);
    await s.service.tick();
    expect(s.runtime.send).toHaveBeenLastCalledWith(other, expect.stringContaining("readBotReplies"));
    expect(s.service.read(s.owner, false)).toEqual([]);
    expect(s.service.read(other, false)).toEqual([expect.objectContaining({ requestId: second.requestId, text: "second result" })]);
    expect(vi.mocked(s.runtime.send).mock.calls.filter(([id]) => id === s.owner)).toHaveLength(1);
    expect(new BotStore(s.file).state.bots[0]?.requests.map((request) => request.requester)).toEqual([s.owner, other]);
  });

  it("allows another terminal to compact and kill, routing compact and interrupted work per request", async () => {
    const s = setup();
    const other = randomUUID();
    const killer = randomUUID();
    const compact = s.service.enqueue(other, s.botId, "", "compact");
    s.ready.add(s.sessionId);
    await s.service.tick();
    s.service.onStop(s.sessionId, true);
    expect(s.service.read(s.owner, false)).toEqual([]);
    expect(s.service.read(other, false)).toEqual([expect.objectContaining({ requestId: compact.requestId, kind: "result" })]);
    const a = s.service.enqueue(s.owner, s.botId, "a");
    const b = s.service.enqueue(other, s.botId, "b");
    s.ready.add(s.sessionId);
    await s.service.tick();
    s.service.kill(killer, s.botId);
    expect(s.service.list(other)).toEqual([]);
    expect(s.service.read(s.owner, false)).toEqual([expect.objectContaining({ requestId: a.requestId, kind: "error" })]);
    expect(s.service.read(other, false)).toEqual([expect.objectContaining({ requestId: b.requestId, kind: "error" })]);
    expect(s.service.read(killer, false)).toEqual([]);
  });

  it("migrates legacy requests to their creator without losing unread replies, then persists new requesters", async () => {
    const s = setup();
    const other = randomUUID();
    const completed = s.service.enqueue(s.owner, s.botId, "done");
    s.ready.add(s.sessionId);
    await s.service.tick();
    s.service.reply(s.sessionId, completed.requestId, "legacy result", "result");
    const queued = s.service.enqueue(s.owner, s.botId, "legacy queued");
    const legacy = {
      ...s.store.state,
      version: 1,
      bots: s.store.state.bots.map((bot) => ({
        ...bot,
        requests: bot.requests.map(({ requester, ...request }) => {
          expect(requester).toBe(s.owner);
          return request;
        }),
      })),
    };
    fs.writeFileSync(s.file, JSON.stringify(legacy));
    const store = new BotStore(s.file);
    const restored = new BotService(store, s.runtime);
    expect(store.state.version).toBe(3);
    expect(store.state.bots[0]?.requests.find((request) => request.id === queued.requestId)?.requester).toBe(s.owner);
    expect(restored.list(other)[0]?.botId).toBe(s.botId);
    const added = restored.enqueue(other, s.botId, "new shared task");
    expect(restored.read(other, false)).toEqual([]);
    expect(restored.read(s.owner, false)).toEqual([expect.objectContaining({ requestId: completed.requestId, text: "legacy result" })]);
    const reopened = new BotStore(s.file);
    expect(reopened.state.version).toBe(3);
    expect(reopened.state.bots[0]?.requests.find((request) => request.id === added.requestId)?.requester).toBe(other);
    expect(reopened.state.bots[0]?.requests.find((request) => request.id === queued.requestId)?.state).toBe("queued");
    // A v2 record must never silently guess a recipient when it is missing.
    fs.writeFileSync(s.file, JSON.stringify({ ...legacy, version: 2 }));
    expect(() => new BotStore(s.file)).toThrow();
  });

  it("reports a missing tmux process on recovery and refuses corrupt stores", () => {
    const s = setup();
    s.service.enqueue(s.owner, s.botId, "task");
    s.live.clear();
    s.service.recover();
    expect(s.service.read(s.owner, false)[0]?.kind).toBe("error");
    fs.writeFileSync(s.file, "bad json");
    expect(() => new BotStore(s.file)).toThrow();
    expect(fs.readFileSync(s.file, "utf8")).toBe("bad json");
  });
});
