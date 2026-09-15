// jsdom (the project default) rather than node: these modules read localStorage at import.
//
// The race Codex found in round 1 of PR #2085: availability arrives over HTTP, so a chat spawned
// programmatically at boot — a collection action, a plugin — could read the remembered `claude` and
// start it on a machine that has no Claude Code. The answer landing afterwards cannot fix a session
// that is already spawned.
//
// `vi.resetModules()` + a per-test import is load-bearing here and not a style choice: both modules
// under test hold MODULE-SCOPE state (the remembered agent, the settled-availability flag), and a
// second test sharing it would assert against an answer the first test already fetched.
import { describe, it, expect, vi, afterEach } from "vitest";

const CODEX_ONLY = {
  agents: [
    { agent: "claude", installed: false },
    { agent: "codex", installed: true },
  ],
};

const responseOf = (body: unknown): Response => ({ ok: true, status: 200, json: () => Promise.resolve(body) }) as unknown as Response;

const AVAILABILITY_DELAY_MS = 5;

/** fetch that answers `/api/agents` only after the caller has had a chance to run ahead of it. */
function slowAvailabilityFetch() {
  const order: string[] = [];
  const answer = (url: string): Promise<Response> => {
    if (url !== "/api/agents") return Promise.resolve(responseOf({ jsonData: { chatId: "sess-race" } }));
    return new Promise<Response>((resolve) => setTimeout(() => resolve(responseOf(CODEX_ONLY)), AVAILABILITY_DELAY_MS));
  };
  const fn = vi.fn((url: string) => {
    order.push(url);
    return answer(url);
  });
  vi.stubGlobal("fetch", fn);
  return { fn, order };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("a chat spawned before availability is known", () => {
  it("spawns the agent this machine HAS, not the remembered one it does not", async () => {
    vi.resetModules();
    const { order } = slowAvailabilityFetch();
    localStorage.setItem("mt-launch-agent", "claude");

    const { startCollectionChat } = await import("../../../src/composables/useChatLauncher");
    const { registerSpawnedChatHandler, resetSpawnedChatQueue } = await import("../../../src/composables/useSpawnedChat");
    resetSpawnedChatQueue();
    const placed: { agent: string }[] = [];
    registerSpawnedChatHandler((req) => (placed.push(req), true));

    await startCollectionChat("do the thing", { hidden: true });

    // The ORDER is the property: availability is settled before the spawn goes out, which is what
    // makes the agent on it correct rather than lucky.
    expect(order[0]).toBe("/api/agents");
    expect(order).toContain("/api/plugin/spawnBackgroundChat");
    const { launchAgent } = await import("../../../src/composables/useChatLauncher");
    expect(launchAgent.value).toBe("codex");
  });
});
