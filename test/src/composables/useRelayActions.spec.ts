import { describe, it, expect, vi } from "vitest";
import { findPartner, isSendAction, pickOf, RELAY_ACTIONS, type PartnerDeps } from "../../../src/composables/useRelayActions";
import type { SlotInfo } from "../../../src/composables/readableSlot";
import type { HandoffTarget } from "../../../src/composables/useHandoff";

const slot = (key: string, cwd: string | null): SlotInfo => ({ key, sessionId: `sess-${key}`, agent: "codex", cwd });
const target = (key: string): HandoffTarget => ({ key, label: key, source: { sessionId: `sess-${key}`, cwd: "/r", agent: "codex" } });

const partnerDeps = (slots: SlotInfo[], paths: string[] = []): PartnerDeps & { worktreePaths: ReturnType<typeof vi.fn> } => ({
  slots: () => slots,
  worktreePaths: vi.fn(async () => paths),
});

describe("pickOf", () => {
  it("none, one, or a choice", () => {
    expect(pickOf([])).toEqual({ kind: "none" });
    expect(pickOf([target("cell-2")])).toEqual({ kind: "one", partner: target("cell-2") });
    expect(pickOf([target("cell-2"), target("cell-3")])).toEqual({ kind: "choose" });
  });
});

describe("isSendAction", () => {
  it("is true for the two sends only", () => {
    expect(RELAY_ACTIONS.filter(isSendAction)).toEqual(["terminal-send-turn", "terminal-send-since"]);
  });
});

describe("findPartner", () => {
  it("does not ask for the repo's worktrees when every other terminal is in this directory", async () => {
    const deps = partnerDeps([slot("cell-1", "/r"), slot("cell-2", "/r")]);
    const pick = await findPartner("cell-1", "/r", null, deps);
    expect(pick.kind === "one" && pick.partner.key).toBe("cell-2");
    expect(deps.worktreePaths).not.toHaveBeenCalled();
  });

  it("asks for them when a terminal sits elsewhere, and pairs it when it is a worktree of the repo", async () => {
    const deps = partnerDeps([slot("cell-1", "/r"), slot("cell-2", "/r-wt/feat")], ["/r", "/r-wt/feat"]);
    const pick = await findPartner("cell-1", "/r", null, deps);
    expect(deps.worktreePaths).toHaveBeenCalledWith("/r");
    expect(pick.kind === "one" && pick.partner.key).toBe("cell-2");
  });

  it("offers a choice when several qualify, and nothing when only unrelated ones are open", async () => {
    expect(await findPartner("cell-1", "/r", null, partnerDeps([slot("cell-1", "/r"), slot("cell-2", "/r"), slot("cell-3", "/r")]))).toEqual({
      kind: "choose",
    });
    expect(await findPartner("cell-1", "/r", null, partnerDeps([slot("cell-1", "/r"), slot("cell-2", "/x")], ["/r"]))).toEqual({ kind: "none" });
  });

  it("finds nothing for a cell with no directory, without asking git", async () => {
    const deps = partnerDeps([slot("cell-1", null), slot("cell-2", "/r")]);
    expect(await findPartner("cell-1", null, null, deps)).toEqual({ kind: "none" });
    expect(deps.worktreePaths).not.toHaveBeenCalled();
  });
});
