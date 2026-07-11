import { describe, it, expect } from "vitest";
import { substitute, substituteShell, evalWhen, resolveHeader, resolveButtonCommand } from "./header-resolve.js";
import type { HeaderConfig, HeaderContext } from "./header-config.js";

// POSIX single-quote escaping, matching the server's shellQuoteFor(non-win32).
const posixQuote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;

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

  it("filters buttons by `when`, keeps shell buttons but never leaks their cmd, and substitutes payloads", () => {
    const config: HeaderConfig = {
      buttons: [
        { id: "pr", emoji: "🔀", label: "PR", run: "shell", cmd: "gh pr create --head ${branch}", when: "isGitRepo" },
        { id: "cx", label: "Codex-only", run: "input", text: "hi", when: "agent == codex" },
        { id: "gh", label: "GH", run: "open", open: { url: "https://github.com/${repo}" } },
      ],
      chips: null,
    };
    const out = resolveHeader(config, ctx());
    // "cx" is hidden for a claude session; "pr" (shell) and "gh" (open) remain.
    expect(out.buttons.map((b) => b.id)).toEqual(["pr", "gh"]);
    expect(out.buttons[0].run).toBe("shell");
    expect(out.buttons[0]).not.toHaveProperty("cmd"); // the command is re-resolved server-side, never sent to the client
    expect(out.buttons[1].open).toEqual({ url: "https://github.com/receptron/mulmoterminal" });
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

describe("substituteShell", () => {
  it("shell-quotes each substituted value so metacharacters can't inject", () => {
    const out = substituteShell("gh pr create --head ${branch}", ctx({ branch: "a; rm -rf / #$(whoami)`x`" }), posixQuote);
    expect(out).toBe("gh pr create --head 'a; rm -rf / #$(whoami)`x`'");
  });
  it("escapes an embedded single quote and leaves an unknown ${var} literal", () => {
    expect(substituteShell("echo ${branch}", ctx({ branch: "o'clock" }), posixQuote)).toBe("echo 'o'\\''clock'");
    expect(substituteShell("echo ${nope}", ctx(), posixQuote)).toBe("echo ${nope}");
  });
});

describe("resolveButtonCommand", () => {
  const cfg = (): HeaderConfig => ({
    buttons: [
      { id: "pr", label: "PR", run: "shell", cmd: "gh pr create --head ${branch}", when: "isGitRepo" },
      { id: "hidden", label: "Hidden", run: "shell", cmd: "echo hi", when: "agent == codex" },
      { id: "open", label: "Open", run: "open", open: { url: "https://x" } },
    ],
    chips: null,
  });

  it('resolves any run:"shell" button by id with escaped ${vars} (when is a display filter, not an exec gate)', () => {
    expect(resolveButtonCommand(cfg(), ctx({ branch: "feat/x" }), "pr", posixQuote)).toBe("gh pr create --head 'feat/x'");
    // "hidden" resolves even though its when (agent==codex) is false for this claude ctx: exec isn't gated on when.
    expect(resolveButtonCommand(cfg(), ctx(), "hidden", posixQuote)).toBe("echo hi");
  });
  it("returns null for an unknown id or a non-shell button", () => {
    expect(resolveButtonCommand(cfg(), ctx(), "nope", posixQuote)).toBeNull();
    expect(resolveButtonCommand(cfg(), ctx(), "open", posixQuote)).toBeNull();
  });
});

describe("resolveHeader defaults + pickFile", () => {
  it("falls back to DEFAULT_BUTTONS when buttons is null (unconfigured), substituting ${dir}", () => {
    const out = resolveHeader({ buttons: null, chips: null }, ctx());
    expect(out.buttons.map((b) => b.id)).toEqual(["pick-file", "files"]);
    expect(out.buttons.find((b) => b.id === "pick-file")?.open).toEqual({ pickFile: true });
    expect(out.buttons.find((b) => b.id === "files")?.open).toEqual({ files: "/Users/x/myrepo" });
  });

  it("an explicit empty list replaces the defaults with nothing", () => {
    expect(resolveHeader({ buttons: [], chips: null }, ctx()).buttons).toEqual([]);
  });

  it("passes a pickFile open target through unchanged", () => {
    const config: HeaderConfig = { buttons: [{ id: "p", label: "P", run: "open", open: { pickFile: true } }], chips: null };
    expect(resolveHeader(config, ctx()).buttons[0].open).toEqual({ pickFile: true });
  });
});
