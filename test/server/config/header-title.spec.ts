import { describe, it, expect, vi } from "vitest.js";
import {
  shouldRegenerateTitle,
  shouldFreshenViewedTitle,
  buildTitlePrompt,
  parseTitleOutput,
  renderTurns,
  titleWindow,
  generateHeaderTitle,
  TITLE_REGEN_EVERY_TURNS,
  VIEW_TITLE_REGEN_TURNS,
  MAX_TITLE_CHARS,
} from "../../../server/config/header-title.js";
import type { RunClaude } from "../../../server/config/session/command-summary.js";
import type { ConversationTurn } from "../../../server/config/session/transcript.js";

const line = (o: unknown) => JSON.stringify(o);
const ok = (stdout: string): RunClaude => vi.fn(async () => ({ stdout, stderr: "", code: 0 }));

describe("shouldRegenerateTitle", () => {
  const base = { hasTitle: true, promptIsTrivial: false, turnsSinceTitle: 1, maxTurns: TITLE_REGEN_EVERY_TURNS };

  it("regenerates when there is no title yet", () => {
    expect(shouldRegenerateTitle({ ...base, hasTitle: false })).toBe(true);
  });

  it("regenerates when the newest prompt is a trivial ack (stale-inducing)", () => {
    expect(shouldRegenerateTitle({ ...base, promptIsTrivial: true })).toBe(true);
  });

  it("regenerates once maxTurns turns have passed", () => {
    expect(shouldRegenerateTitle({ ...base, turnsSinceTitle: TITLE_REGEN_EVERY_TURNS })).toBe(true);
  });

  it("does NOT regenerate for a fresh meaningful prompt within the window", () => {
    expect(shouldRegenerateTitle(base)).toBe(false);
  });
});

describe("shouldFreshenViewedTitle", () => {
  const base = { lastTitledUserTurns: null as number | null, currentUserTurns: 4, regenEveryTurns: VIEW_TITLE_REGEN_TURNS };

  it("titles an untitled session (null baseline) on first view", () => {
    expect(shouldFreshenViewedTitle(base)).toBe(true);
  });

  it("does NOT title a session with no user turns yet", () => {
    expect(shouldFreshenViewedTitle({ ...base, currentUserTurns: 0 })).toBe(false);
  });

  it("does NOT re-title at the same turn count as the last titling (guards /clear resurrection from a frozen transcript)", () => {
    expect(shouldFreshenViewedTitle({ ...base, lastTitledUserTurns: 4, currentUserTurns: 4 })).toBe(false);
  });

  it("re-titles once the transcript advances regenEveryTurns past the last titling", () => {
    expect(shouldFreshenViewedTitle({ ...base, lastTitledUserTurns: 4, currentUserTurns: 4 + VIEW_TITLE_REGEN_TURNS })).toBe(true);
  });

  it("does NOT re-title within regenEveryTurns of the last titling", () => {
    expect(shouldFreshenViewedTitle({ ...base, lastTitledUserTurns: 4, currentUserTurns: 4 + VIEW_TITLE_REGEN_TURNS - 1 })).toBe(false);
  });
});

describe("buildTitlePrompt", () => {
  it("asks for a short title in the user's language, title-only", () => {
    const p = buildTitlePrompt();
    expect(p).toContain("concise title");
    expect(p).toContain("Match the User's language");
    expect(p).toContain("ONLY the title");
  });
});

describe("parseTitleOutput", () => {
  it("takes the first non-empty line and strips surrounding quotes", () => {
    expect(parseTitleOutput('  "Fix the parser"  \n')).toBe("Fix the parser");
    expect(parseTitleOutput("\n\n「パーサー修正」")).toBe("パーサー修正");
  });

  it("caps the length", () => {
    const long = "x".repeat(MAX_TITLE_CHARS + 20);
    const out = parseTitleOutput(long);
    expect(out).toHaveLength(MAX_TITLE_CHARS + 1); // MAX chars + the ellipsis
    expect(out.endsWith("…")).toBe(true);
  });

  it("returns an empty string for blank output", () => {
    expect(parseTitleOutput("   \n  ")).toBe("");
  });
});

describe("renderTurns", () => {
  it("labels each turn by role", () => {
    const turns: ConversationTurn[] = [
      { role: "user", text: "hi" },
      { role: "assistant", text: "hello" },
    ];
    expect(renderTurns(turns)).toBe("User: hi\nAssistant: hello");
  });
});

describe("titleWindow", () => {
  const u = (text: string): ConversationTurn => ({ role: "user", text });
  const a = (text: string): ConversationTurn => ({ role: "assistant", text });

  it("is empty when there is no user turn (a long assistant-only stretch)", () => {
    expect(titleWindow([a("thinking"), a("running a tool"), a("more")])).toEqual([]);
  });

  it("anchors on the last few user turns plus the latest assistant turn", () => {
    // Six user turns interleaved; window keeps the last 5 users + the final assistant.
    const turns = [u("1"), a("x"), u("2"), u("3"), u("4"), u("5"), u("6"), a("latest")];
    const win = titleWindow(turns);
    expect(win.map((t) => t.text)).toEqual(["2", "3", "4", "5", "6", "latest"]);
  });

  it("keeps user intent even after a trailing assistant-only tool stretch", () => {
    const turns = [u("fix the parser"), a("t1"), a("t2"), a("t3")];
    expect(titleWindow(turns)).toEqual([u("fix the parser"), a("t3")]);
  });

  it("returns just the user turns when there is no assistant turn yet", () => {
    expect(titleWindow([u("only user")])).toEqual([u("only user")]);
  });
});

describe("generateHeaderTitle", () => {
  const raw = [
    line({ type: "user", message: { content: "fix the parser" } }),
    line({ type: "assistant", message: { content: [{ type: "text", text: "on it" }] } }),
  ].join("\n");

  it("returns the parsed title and passes the model to the CLI", async () => {
    const runClaude = ok("Parser fix\n");
    const title = await generateHeaderTitle(raw, { runClaude, model: "haiku" });
    expect(title).toBe("Parser fix");
    expect(runClaude).toHaveBeenCalledWith(expect.objectContaining({ model: "haiku" }));
  });

  it("returns null when the transcript has no user turn", async () => {
    const runClaude = ok("should not run");
    const title = await generateHeaderTitle(line({ type: "assistant", message: { content: [{ type: "text", text: "x" }] } }), { runClaude });
    expect(title).toBeNull();
    expect(runClaude).not.toHaveBeenCalled();
  });

  it("returns null (never throws) when the CLI fails", async () => {
    const runClaude: RunClaude = vi.fn(async () => {
      throw new Error("spawn failed");
    });
    expect(await generateHeaderTitle(raw, { runClaude })).toBeNull();
  });

  it("returns null when the CLI produces only whitespace", async () => {
    expect(await generateHeaderTitle(raw, { runClaude: ok("   \n") })).toBeNull();
  });
});
