import { describe, it, expect, vi, afterEach } from "vitest";
import { defaultRelayDeps, sendSinceRelay, slotLabel, toHandoffTarget } from "../../../src/composables/useHandoff";
import { relayPartners } from "../../../src/composables/relayPartners";
import { findPartner } from "../../../src/composables/useRelayActions";
import type { SlotInfo } from "../../../src/composables/readableSlot";

// #3506. A remote terminal is handed turns like a local one, read on its host; it is named by its host,
// and a send or bring pairs only terminals on the same machine.
const remote: SlotInfo = { key: "cell-3", sessionId: "s3", cwd: "/home/me/p", agent: "claude", host: "lx" };
const local: SlotInfo = { key: "cell-2", sessionId: "s2", cwd: "/home/me/p", agent: "codex" };

describe("a remote terminal as a handoff target", () => {
  it("is named by its host, its directory not shortened by this machine's home", () => {
    expect(slotLabel(remote, "/home/me")).toBe("#3 · lx · claude · /home/me/p");
    expect(slotLabel(local, "/home/me")).toBe("#2 · codex · ~/p");
  });
  it("is read on its host", () => {
    expect(toHandoffTarget(remote, null).source).toEqual({ sessionId: "s3", cwd: "/home/me/p", agent: "claude", host: "lx" });
    expect(toHandoffTarget(local, null).source).toEqual({ sessionId: "s2", cwd: "/home/me/p", agent: "codex" });
  });
});

describe("relayPartners across machines", () => {
  const self: SlotInfo = { key: "cell-1", sessionId: "s1", cwd: "/home/me/p", agent: "claude" };
  it("pairs only terminals on the same machine, the same path elsewhere being another directory", () => {
    const slots = [self, local, remote];
    expect(relayPartners(slots, "cell-1", "/home/me/p", []).map((slot) => slot.key)).toEqual(["cell-2"]);
    expect(relayPartners(slots, "cell-1", "/home/me/p", [], "lx").map((slot) => slot.key)).toEqual(["cell-3"]);
    expect(relayPartners(slots, "cell-1", "/home/me/p", [], "gpu")).toEqual([]);
  });
  it("places a remote cell's partners in a worktree only on its own machine", () => {
    const elsewhere: SlotInfo = { ...remote, key: "cell-4", cwd: "/repo-wt/x" };
    expect(relayPartners([elsewhere], "cell-1", "/repo", ["/repo", "/repo-wt"], "lx").map((slot) => slot.key)).toEqual(["cell-4"]);
    expect(relayPartners([elsewhere], "cell-1", "/repo", ["/repo", "/repo-wt"])).toEqual([]);
  });
});

describe("findPartner for a remote cell", () => {
  it("asks this server for no worktree list, which names this machine's repo", async () => {
    const worktreePaths = vi.fn(async () => ["/home/me/p", "/home/me/wt"]);
    const slots = () => [remote, { ...remote, key: "cell-5", cwd: "/home/me/wt/x" }, local];
    const pick = await findPartner("cell-9", "/home/me/p", null, { slots, worktreePaths }, "lx");
    expect(worktreePaths).not.toHaveBeenCalled();
    expect(pick).toMatchObject({ kind: "one", partner: { key: "cell-3", source: { host: "lx" } } });
  });
  it("asks it for a local cell whose repo has a terminal elsewhere (control)", async () => {
    const worktreePaths = vi.fn(async () => ["/home/me/p", "/home/me/wt"]);
    const slots = () => [local, { ...local, key: "cell-5", cwd: "/home/me/wt/x" }];
    const pick = await findPartner("cell-9", "/home/me/p", null, { slots, worktreePaths });
    expect(worktreePaths).toHaveBeenCalledWith("/home/me/p");
    expect(pick).toEqual({ kind: "choose" });
  });
});

// The relay is read, and where it ended is recorded, on the source's own server: the remote's for a
// remote cell, under the partner's machine.
describe("a remote cell's relay", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("is read and marked on its host, under the partner's machine", async () => {
    const asked: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        asked.push(String(input));
        return new Response(JSON.stringify({ status: "ok", text: "relayed", mark: "m1" }), { status: 200, headers: { "content-type": "application/json" } });
      }),
    );
    const self = { sessionId: "s3", cwd: "/srv/p", agent: "claude" as const, host: "lx" };
    const error = await sendSinceRelay(self, toHandoffTarget(local, null), { ...defaultRelayDeps, paste: () => true });
    expect(error).toBeNull();
    expect(asked.map((url) => url.split("?")[0])).toEqual(["/remote/lx/api/transcript/relay", "/remote/lx/api/transcript/relay-mark"]);
    expect(asked.map((url) => new URL(url, "https://x").searchParams.get("dest"))).toEqual(["\0/home/me/p", "\0/home/me/p"]);
  });
});
