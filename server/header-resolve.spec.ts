import { describe, it, expect } from "vitest";
import { substitute, evalWhen, resolveHeader } from "./header-resolve.js";
import type { HeaderConfig, HeaderContext } from "./header-config.js";

const ctx = (over: Partial<HeaderContext> = {}): HeaderContext => ({
  dir: "/Users/x/myrepo",
  dirName: "myrepo",
  branch: "feat/foo",
  repo: "receptron/mulmoterminal",
  model: "claude-opus-4-8",
  agent: "claude",
  session: "sess-1",
  remoteUrl: "git@github.com:receptron/mulmoterminal.git",
  dirty: 3,
  ahead: 2,
  behind: 0,
  task: "foo",
  isGitRepo: true,
  ...over,
});

describe("substitute", () => {
  it("replaces known vars, renders null as empty, numbers as strings", () => {
    expect(substitute("↑${ahead} ↓${behind} on ${branch}", ctx())).toBe("↑2 ↓0 on feat/foo");
    expect(substitute("[${branch}]", ctx({ branch: null }))).toBe("[]");
  });
  it("leaves an unknown ${var} literal so a typo is visible", () => {
    expect(substitute("${nope}", ctx())).toBe("${nope}");
  });
});

describe("evalWhen", () => {
  it("treats an empty/absent condition as always visible", () => {
    expect(evalWhen(undefined, ctx())).toBe(true);
    expect(evalWhen("  ", ctx())).toBe(true);
  });
  it("evaluates isGitRepo / !isGitRepo", () => {
    expect(evalWhen("isGitRepo", ctx())).toBe(true);
    expect(evalWhen("isGitRepo", ctx({ isGitRepo: false }))).toBe(false);
    expect(evalWhen("!isGitRepo", ctx({ isGitRepo: false }))).toBe(true);
  });
  it("evaluates == / != against context values", () => {
    expect(evalWhen("agent == claude", ctx())).toBe(true);
    expect(evalWhen("agent == codex", ctx())).toBe(false);
    expect(evalWhen("agent != codex", ctx())).toBe(true);
    expect(evalWhen("repo == receptron/mulmoterminal", ctx())).toBe(true);
  });
  it("&& binds tighter than || ; unknown atoms are false", () => {
    expect(evalWhen("isGitRepo && agent==claude", ctx())).toBe(true);
    expect(evalWhen("isGitRepo && agent==codex", ctx())).toBe(false);
    expect(evalWhen("agent==codex || repo==receptron/mulmoterminal", ctx())).toBe(true);
    expect(evalWhen("mystery", ctx())).toBe(false);
  });
  it("fails closed for an unknown key on both == and != (a typo hides, never exposes)", () => {
    expect(evalWhen("agnet == claude", ctx())).toBe(false);
    expect(evalWhen("agnet != codex", ctx())).toBe(false);
  });
});

describe("resolveHeader", () => {
  it("passes chips:null through unchanged (unconfigured = client default)", () => {
    expect(resolveHeader({ buttons: [], chips: null }, ctx()).chips).toBeNull();
  });

  it("filters buttons by `when`, drops shell buttons (not wired yet), and substitutes payloads", () => {
    const config: HeaderConfig = {
      buttons: [
        { id: "pr", emoji: "🔀", label: "PR", run: "shell", cmd: "gh pr create --head ${branch}", when: "isGitRepo" },
        { id: "cx", label: "Codex-only", run: "input", text: "hi", when: "agent == codex" },
        { id: "gh", label: "GH", run: "open", open: { url: "https://github.com/${repo}" } },
      ],
      chips: null,
    };
    const out = resolveHeader(config, ctx());
    // "pr" is dropped (run:"shell" not dispatchable yet); "cx" hidden for a claude session; only "gh" remains.
    expect(out.buttons.map((b) => b.id)).toEqual(["gh"]);
    expect(out.buttons[0].open).toEqual({ url: "https://github.com/receptron/mulmoterminal" });
  });

  it("resolves built-in and custom chips, dropping a custom chip whose when is false", () => {
    const config: HeaderConfig = {
      buttons: [],
      chips: ["dir", "bogus", { label: "↑↓", text: "↑${ahead}", when: "isGitRepo" }, { label: "no", text: "x", when: "isGitRepo" }],
    };
    const out = resolveHeader(config, ctx({ isGitRepo: false }));
    // 'bogus' was dropped at sanitize time in real use; here resolveChip also drops unknown builtin strings,
    // and both custom chips are hidden because isGitRepo is false.
    expect(out.chips).toEqual([{ kind: "builtin", id: "dir" }]);
  });

  it("keeps custom chips and substitutes their text when visible", () => {
    const out = resolveHeader({ buttons: [], chips: [{ label: "↑↓", text: "↑${ahead} ↓${behind}" }] }, ctx());
    expect(out.chips).toEqual([{ kind: "custom", label: "↑↓", text: "↑2 ↓0" }]);
  });
});
