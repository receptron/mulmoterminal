// @vitest-environment node
// The two durable answers the Web Push gate reads, and why they are read together.
//
// A scheduled session survives a server restart in tmux, so its turn finishing moments after boot
// is the ORDINARY case here. Read separately during that window, `background` can hydrate before
// `userScheduled` — and (background: true, userScheduled: false) is exactly "a background session
// that is not the user's task", so the push is suppressed for the one run that most needs it
// (Codex, PR #1196).
import { describe, it, expect, vi, beforeEach } from "vitest";

const ID = "11111111-1111-1111-1111-111111111111";

// Hydration reads through this. The user-scheduled log is answered LATE on purpose: that is the
// ordering the bug needs, and an immediate answer would let a non-awaiting implementation pass.
let slowLog = "";
vi.mock("node:fs", () => {
  const promises = {
    readFile: vi.fn(async (file: unknown) => {
      const name = String(file).split("/").pop() ?? "";
      if (name === "background-sessions.json") return ID;
      if (name === "user-scheduled-sessions.json") {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return slowLog;
      }
      return "";
    }),
    appendFile: vi.fn(async () => undefined),
    mkdir: vi.fn(async () => undefined),
    writeFile: vi.fn(async () => undefined),
  };
  return { promises, default: { promises } };
});

beforeEach(() => vi.clearAllMocks());

describe("pushClassification", () => {
  it("waits for the SLOWER log before answering", async () => {
    // Asked immediately, as a turn finishing right after boot would. Without the await this reads
    // the half-hydrated state and reports the session as a background worker that nobody
    // scheduled — which is the combination that silences it.
    slowLog = ID;
    vi.resetModules();
    const { pushClassification } = await import("../../../server/session/registry.js");

    expect(await pushClassification(ID)).toEqual({ background: true, userScheduled: true });
  });

  it("still reports a background session that really was not scheduled", async () => {
    // The rule it protects has to keep working: a collection's refresh stays silenced.
    slowLog = "";
    vi.resetModules();
    const { pushClassification } = await import("../../../server/session/registry.js");

    expect(await pushClassification(ID)).toEqual({ background: true, userScheduled: false });
  });

  it("says neither for an ordinary session", async () => {
    slowLog = "";
    vi.resetModules();
    const { pushClassification } = await import("../../../server/session/registry.js");

    expect(await pushClassification("22222222-2222-2222-2222-222222222222")).toEqual({ background: false, userScheduled: false });
  });
});
