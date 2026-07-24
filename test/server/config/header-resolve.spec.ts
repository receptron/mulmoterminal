import { describe, it, expect } from "vitest";
import {
  substitute,
  substituteShell,
  evalWhen,
  resolveHeader,
  resolveButtonCommand,
  headerHasPrButton,
  shellQuoteFor,
} from "../../../server/config/header-resolve.js";
import type { HeaderConfig, HeaderContext } from "../../../server/config/header-config.js";

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
  prUrl: null,
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
    // ctx() is a git repo with no open PR: files/terminal/gh resolve, pr is dropped (no PR url).
    const out = resolveHeader({ buttons: null, chips: null }, ctx());
    expect(out.buttons.map((b) => b.id)).toEqual(["pick-file", "reveal", "files", "terminal", "gh"]);
    expect(out.buttons.find((b) => b.id === "pick-file")?.open).toEqual({ pickFile: true });
    expect(out.buttons.find((b) => b.id === "reveal")?.open).toEqual({ reveal: "/Users/x/myrepo" });
    expect(out.buttons.find((b) => b.id === "files")?.open).toEqual({ files: "/Users/x/myrepo" });
    expect(out.buttons.find((b) => b.id === "terminal")?.open).toEqual({ terminal: "/Users/x/myrepo" });
    expect(out.buttons.find((b) => b.id === "gh")?.open).toEqual({ url: "https://github.com/receptron/mulmoterminal" });
  });

  it("drops the default pr button outside a git repo and shows it (as its PR url) when a PR exists", () => {
    // Non-git (no remote, so repo is null too): pr and gh drop, leaving the always-on buttons.
    const nonGit = resolveHeader({ buttons: null, chips: null }, ctx({ isGitRepo: false, repo: null }));
    expect(nonGit.buttons.map((b) => b.id)).toEqual(["pick-file", "reveal", "files", "terminal"]);
    // Git repo WITH an open PR: the pr button resolves to the branch's PR url.
    const withPr = resolveHeader({ buttons: null, chips: null }, ctx({ prUrl: "https://github.com/receptron/mulmoterminal/pull/9" }));
    expect(withPr.buttons.find((b) => b.id === "pr")?.open).toEqual({ url: "https://github.com/receptron/mulmoterminal/pull/9" });
  });

  it("drops the default gh button in a git repo whose remote isn't GitHub (repo null), avoiding a broken github.com/ link", () => {
    // A real git repo but a non-GitHub (or remoteless) origin → ctx.repo is null; gh must NOT render.
    const nonGithub = resolveHeader({ buttons: null, chips: null }, ctx({ repo: null }));
    expect(nonGithub.buttons.map((b) => b.id)).toEqual(["pick-file", "reveal", "files", "terminal"]);
    expect(nonGithub.buttons.some((b) => b.open?.url === "https://github.com/")).toBe(false);
  });

  it("an explicit empty list replaces the defaults with nothing", () => {
    expect(resolveHeader({ buttons: [], chips: null }, ctx()).buttons).toEqual([]);
  });

  it("passes a pickFile open target through unchanged", () => {
    const config: HeaderConfig = { buttons: [{ id: "p", label: "P", run: "open", open: { pickFile: true } }], chips: null };
    expect(resolveHeader(config, ctx()).buttons[0].open).toEqual({ pickFile: true });
  });

  it("substitutes ${dir} in a terminal open target", () => {
    const config: HeaderConfig = { buttons: [{ id: "t", label: "T", run: "open", open: { terminal: "${dir}" } }], chips: null };
    expect(resolveHeader(config, ctx()).buttons[0].open).toEqual({ terminal: "/Users/x/myrepo" });
  });

  it("resolves a pr button to the branch's PR url when there's an open PR", () => {
    const config: HeaderConfig = { buttons: [{ id: "pr", label: "PR", run: "open", open: { pr: true } }], chips: null };
    const out = resolveHeader(config, ctx({ prUrl: "https://github.com/receptron/mulmoterminal/pull/9" }));
    expect(out.buttons).toHaveLength(1);
    expect(out.buttons[0].open).toEqual({ url: "https://github.com/receptron/mulmoterminal/pull/9" });
  });

  it("drops a pr button when there's no open PR (prUrl null)", () => {
    const config: HeaderConfig = { buttons: [{ id: "pr", label: "PR", run: "open", open: { pr: true } }], chips: null };
    expect(resolveHeader(config, ctx({ prUrl: null })).buttons).toEqual([]);
  });
});

describe("headerHasPrButton", () => {
  it("is true only when the effective buttons include an open.pr button", () => {
    expect(headerHasPrButton({ buttons: [{ id: "pr", label: "PR", run: "open", open: { pr: true } }], chips: null })).toBe(true);
    expect(headerHasPrButton({ buttons: [{ id: "u", label: "U", run: "open", open: { url: "https://x" } }], chips: null })).toBe(false);
    expect(headerHasPrButton({ buttons: [], chips: null })).toBe(false);
  });
  it("checks DEFAULT_BUTTONS when unconfigured (they include a pr button)", () => {
    expect(headerHasPrButton({ buttons: null, chips: null })).toBe(true);
  });
});

// A header button's command is a string the shell parses, and ${branch}/${repo}/${task}
// come from the repo and the user's config. Quoting is the only thing standing between a
// branch named `; rm -rf ~` and that command running.
describe("shellQuoteFor", () => {
  const posix = shellQuoteFor("darwin");
  const win = shellQuoteFor("win32");

  it("wraps a plain value in single quotes on posix", () => {
    expect(posix("main")).toBe("'main'");
  });

  it("neutralizes shell metacharacters by quoting them", () => {
    for (const evil of ["; rm -rf ~", "$(id)", "`id`", "a && b", "a | b", "a > f", "$HOME", "a\nb"]) {
      const quoted = posix(evil);
      expect(quoted.startsWith("'")).toBe(true);
      expect(quoted.endsWith("'")).toBe(true);
      // Nothing between the quotes may be a bare quote that ends the string early.
      expect(quoted.slice(1, -1)).not.toContain("'");
    }
  });

  it("escapes an embedded single quote by closing, escaping, reopening", () => {
    // The classic break-out: a value containing ' would otherwise end the quoted string.
    expect(posix("it's")).toBe("'it'\\''s'");
  });

  it("keeps a break-out attempt inside the quotes on posix", () => {
    expect(posix("'; rm -rf ~; echo '")).toBe("''\\''; rm -rf ~; echo '\\'''");
  });

  it("doubles single quotes on powershell", () => {
    expect(win("it's")).toBe("'it''s'");
    expect(win("'; rm -rf ~")).toBe("'''; rm -rf ~'");
  });

  it("quotes an empty value rather than producing a bare gap", () => {
    expect(posix("")).toBe("''");
    expect(win("")).toBe("''");
  });
});
