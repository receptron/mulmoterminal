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
  // The panel mounts the real CellLaunchForm, which reads the directory's worktrees and sessions on
  // open; empty answers are the ordinary case and keep this about the RACE.
  const answer = (url: string): Promise<Response> => {
    if (url === "/api/agents") return new Promise<Response>((resolve) => setTimeout(() => resolve(responseOf(CODEX_ONLY)), AVAILABILITY_DELAY_MS));
    if (url.includes("/api/worktrees")) return Promise.resolve(responseOf({ isGit: false, base: null, worktrees: [] }));
    if (url.includes("/api/sessions")) return Promise.resolve(responseOf({ cwd: "/repo", sessions: [] }));
    return Promise.resolve(responseOf({ jsonData: { chatId: "sess-race" } }));
  };
  const fn = vi.fn((url: string) => {
    order.push(String(url));
    return answer(String(url));
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

// Codex round 2 named this gap in the TESTS axis rather than as a finding, and it was right: with
// only the spec above, removing the await from LaunchPanel's start path left everything green. An
// unbreak-verified fix is exactly what this loop exists to catch, so the second path gets its own.
describe("a panel start before availability is known", () => {
  it("emits the agent this machine HAS, not the initial pick it does not", async () => {
    vi.resetModules();
    slowAvailabilityFetch();

    const { mount } = await import("@vue/test-utils");
    const LaunchPanel = (await import("../../../src/components/LaunchPanel.vue")).default;
    const CellLaunchForm = (await import("../../../src/components/CellLaunchForm.vue")).default;

    const w = mount(LaunchPanel, {
      props: { initialDir: "/home/me/proj", defaultCwd: "/home/me/workspace", presets: [], launchers: [], customAgents: [] },
      attachTo: document.body,
    });
    // Started IMMEDIATELY, while `/api/agents` is still in flight — the interleaving Codex
    // described: the fetch is out, the grid is interactive, and the user clicks.
    w.findComponent(CellLaunchForm).vm.$emit("start", "/home/me/other");
    await new Promise((resolve) => setTimeout(resolve, AVAILABILITY_DELAY_MS * 6));

    const emitted = w.emitted("start");
    expect(emitted, "the start must still be emitted, only later").toBeTruthy();
    expect(emitted?.[0]?.[0]).toMatchObject({ dir: "/home/me/other", pick: "codex" });
  });
});

// Codex round 8 gave the touched flag; this pins the ordering it depends on. A DEFAULT Vue watcher
// runs on the next microtask, so a user who changes back to claude while the answer is in flight
// could have the flag still false against a value that equals the default — the exact case the flag
// exists for. `flush: "sync"` is what closes it.
describe("a user who changes their mind twice while the answer is in flight", () => {
  it("keeps the agent they chose, even when it equals the default", async () => {
    vi.resetModules();
    slowAvailabilityFetch();
    localStorage.setItem("mt-launch-agent", "claude");

    const { launchAgent } = await import("../../../src/composables/useChatLauncher");
    // Away and back, with no awaits between: this is what a default (microtask) watcher misses.
    launchAgent.value = "codex";
    launchAgent.value = "claude";

    await new Promise((resolve) => setTimeout(resolve, AVAILABILITY_DELAY_MS * 6));
    expect(launchAgent.value, "their claude is a choice, not the default").toBe("claude");
  });
});
