import { describe, it, expect } from "vitest";
import { buildClaudeArgs, type ClaudeArgsInput } from "../../../server/agents/claude-args.js";
import { SESSION_SUMMARY_PROMPT } from "../../../server/agents/session-summary-prompt.js";

const base: ClaudeArgsInput = {
  sessionId: "11111111-1111-1111-1111-111111111111",
  resume: null,
  canResume: false,
  settings: "{hooks}",
  permissionMode: "auto",
  attachGuiMcp: true,
  mcpConfig: "{gui-mcp}",
  allowedTools: "mcp__gui__a,mcp__gui__b",
};

const cfg = (over: Partial<ClaudeArgsInput> = {}): ClaudeArgsInput => ({ ...base, ...over });

describe("buildClaudeArgs", () => {
  it("single view (attachGuiMcp): attaches GUI MCP + --strict-mcp-config + --allowedTools", () => {
    const args = buildClaudeArgs(base);
    expect(args).toEqual([
      "--session-id",
      base.sessionId,
      "--settings",
      "{hooks}",
      "--permission-mode",
      "auto",
      "--append-system-prompt",
      SESSION_SUMMARY_PROMPT,
      "--mcp-config",
      "{gui-mcp}",
      "--strict-mcp-config",
      "--allowedTools",
      "mcp__gui__a,mcp__gui__b",
    ]);
  });

  // A grid cell's GUI tools arrive through the USER's own per-folder MCP config, so it must
  // get neither --mcp-config nor --strict-mcp-config (which would ignore that config) — but it
  // still pre-approves the render group, or every draw stops at a permission prompt.
  it("grid dev terminal (attachGuiMcp=false): no GUI MCP, no --strict-mcp-config, but keeps --allowedTools", () => {
    const args = buildClaudeArgs({ ...base, attachGuiMcp: false });
    expect(args).toEqual([
      "--session-id",
      base.sessionId,
      "--settings",
      "{hooks}",
      "--permission-mode",
      "auto",
      "--append-system-prompt",
      SESSION_SUMMARY_PROMPT,
      "--allowedTools",
      "mcp__gui__a,mcp__gui__b",
    ]);
    expect(args).not.toContain("--mcp-config");
    expect(args).not.toContain("--strict-mcp-config");
  });

  it("omits --allowedTools entirely when there is nothing to pre-approve", () => {
    const args = buildClaudeArgs({ ...base, attachGuiMcp: false, allowedTools: "" });
    expect(args).not.toContain("--allowedTools");
  });

  it("resumes with --resume when canResume, keeping the chosen MCP mode", () => {
    const resume = "22222222-2222-2222-2222-222222222222";
    const args = buildClaudeArgs({ ...base, attachGuiMcp: false, resume, canResume: true });
    expect(args.slice(0, 4)).toEqual(["--resume", resume, "--settings", "{hooks}"]);
    expect(args).not.toContain("--session-id");
    expect(args).not.toContain("--strict-mcp-config");
  });

  it("falls back to --session-id when canResume is false even if a resume id is present", () => {
    const args = buildClaudeArgs({ ...base, resume: "33333333-3333-3333-3333-333333333333", canResume: false });
    expect(args).toContain("--session-id");
    expect(args).not.toContain("--resume");
  });

  // Regression: an auto-run prompt must NOT be a `-- <prompt>` positional. A large seed
  // prompt (e.g. a 20KB collection-action prompt) as a tmux `new-session` command arg
  // overflows tmux's length limit ("command too long", killing the session); it's typed
  // into the input box after spawn instead. So the argv must never carry a bare `--`.
  it("never emits a `--` positional (auto-run text is typed in, not passed as an arg)", () => {
    expect(buildClaudeArgs(base)).not.toContain("--");
    expect(buildClaudeArgs({ ...base, canResume: true, resume: "44444444-4444-4444-4444-444444444444" })).not.toContain("--");
  });
});

// #579: a directory can pin its sessions to a model — an alias or a third-party backend's
// own name. `--model` is the one lever that outranks both the settings `model` key and
// ANTHROPIC_MODEL, so the choice has to land here.
describe("model selection", () => {
  it("passes the chosen model through", () => {
    expect(buildClaudeArgs(cfg({ model: "z-ai/glm-5.2" }))).toContain("--model");
    expect(buildClaudeArgs(cfg({ model: "z-ai/glm-5.2" }))).toContain("z-ai/glm-5.2");
  });

  it("omits the flag entirely when no model is chosen", () => {
    expect(buildClaudeArgs(base)).not.toContain("--model");
    expect(buildClaudeArgs(cfg({ model: null }))).not.toContain("--model");
  });

  it("still passes it on a resumed session", () => {
    const args = buildClaudeArgs(cfg({ model: "opus", resume: "abc", canResume: true }));
    expect(args).toContain("--resume");
    expect(args).toContain("--model");
  });
});

// #942: the closing-summary instruction rides on every session, with no config to turn it off.
// A resumed session is the one that most needs it — it is the session someone came back to.
describe("session summary prompt", () => {
  const promptValue = (args: string[]): string | undefined => args[args.indexOf("--append-system-prompt") + 1];

  it.each([
    ["a fresh session", cfg()],
    ["a resumed session", cfg({ resume: "abc", canResume: true })],
    ["a grid dev terminal (no GUI MCP)", cfg({ attachGuiMcp: false })],
    ["a session pinned to a model", cfg({ model: "opus" })],
  ])("appends it to %s", (_case, input) => {
    const args = buildClaudeArgs(input);
    expect(args.filter((a) => a === "--append-system-prompt")).toHaveLength(1);
    expect(promptValue(args)).toBe(SESSION_SUMMARY_PROMPT);
  });

  // `--add-dir` is variadic, so anything after it is swallowed as a directory. The prompt is a
  // single argument that would silently become one.
  it("sits before --add-dir, never after it", () => {
    const args = buildClaudeArgs(cfg({ addDirs: ["/a", "/b"] }));
    expect(args.indexOf("--append-system-prompt")).toBeLessThan(args.indexOf("--add-dir"));
    expect(promptValue(args)).toBe(SESSION_SUMMARY_PROMPT);
  });
});

// #872 was only ever appended by the ⧉ Open PR button, so PRs opened by the agent — nearly all
// of them — carried nothing saying which clone they came from. The instruction now rides on the
// session, with the name resolved server-side.
describe("clone footer prompt", () => {
  const promptValue = (args: string[]): string | undefined => args[args.indexOf("--append-system-prompt") + 1];

  it("carries the exact line the PR body should end with", () => {
    const value = promptValue(buildClaudeArgs(cfg({ workdirFooter: "work in myrepo3" })));
    expect(value).toContain("work in myrepo3");
    // Still ONE flag: given twice, which of the two wins is up to the CLI.
    expect(buildClaudeArgs(cfg({ workdirFooter: "work in myrepo3" })).filter((a) => a === "--append-system-prompt")).toHaveLength(1);
  });

  it("keeps the closing-summary instruction alongside it", () => {
    const value = promptValue(buildClaudeArgs(cfg({ workdirFooter: "work in myrepo3" })));
    expect(value).toContain(SESSION_SUMMARY_PROMPT);
  });

  it.each([
    ["the footer is switched off / not a repo", null],
    ["nothing was resolved", undefined],
  ])("says nothing about a clone when %s", (_case, footer) => {
    expect(promptValue(buildClaudeArgs(cfg({ workdirFooter: footer })))).toBe(SESSION_SUMMARY_PROMPT);
  });

  // Same argv constraint as the summary prompt: this text reaches a Windows `.cmd` parser.
  it("contains no ASCII double quote", () => {
    expect(promptValue(buildClaudeArgs(cfg({ workdirFooter: "work in myrepo3" })))).not.toContain(String.fromCharCode(34));
  });
});
