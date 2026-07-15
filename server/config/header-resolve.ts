// Resolve a merged HeaderConfig against a session's live context: drop items whose `when` is false,
// and substitute ${vars} in commands / text / open targets / custom chip text. Pure — the caller
// gathers the HeaderContext (cwd, git status, model, agent, …) from server state.

import { BUILTIN_CHIPS, type BuiltinChip, type HeaderButton, type HeaderChip, type OpenTarget } from "./config-schema.js";
import { DEFAULT_BUTTONS, type HeaderConfig, type HeaderContext, type ResolvedButton, type ResolvedChip, type ResolvedHeader } from "./header-config.js";

const VAR_RE = /\$\{(\w+)\}/g;
const BUILTINS = new Set<string>(BUILTIN_CHIPS);
const isBuiltinChip = (s: string): s is BuiltinChip => BUILTINS.has(s);

const varValue = (ctx: HeaderContext, name: string): string | undefined => {
  const table: Record<string, string | number | null> = {
    dir: ctx.dir,
    dirName: ctx.dirName,
    branch: ctx.branch,
    repo: ctx.repo,
    model: ctx.model,
    agent: ctx.agent,
    session: ctx.session,
    remoteUrl: ctx.remoteUrl,
    dirty: ctx.dirty,
    ahead: ctx.ahead,
    behind: ctx.behind,
    task: ctx.task,
  };
  if (!(name in table)) return undefined;
  const value = table[name];
  return value === null ? "" : String(value);
};

// Replace known ${vars}; leave an unknown ${x} literal so a typo is visible rather than silently blank.
export function substitute(text: string, ctx: HeaderContext): string {
  return text.replace(VAR_RE, (whole, name: string) => varValue(ctx, name) ?? whole);
}

const KEY_RE = /^\w+$/;
function comparisonOp(atom: string): "==" | "!=" | null {
  if (atom.includes("!=")) return "!=";
  if (atom.includes("==")) return "==";
  return null;
}
function evalAtom(atom: string, ctx: HeaderContext): boolean {
  const trimmed = atom.trim();
  if (trimmed === "isGitRepo") return ctx.isGitRepo;
  if (trimmed === "!isGitRepo") return !ctx.isGitRepo;
  const op = comparisonOp(trimmed);
  if (!op) return false; // unknown atom → hide (safe default)
  const idx = trimmed.indexOf(op);
  const key = trimmed.slice(0, idx).trim();
  const value = trimmed.slice(idx + op.length).trim();
  if (!KEY_RE.test(key)) return false;
  const actual = varValue(ctx, key);
  if (actual === undefined) return false; // unknown key → fail closed, so a `when` typo hides rather than exposes
  return op === "==" ? actual === value : actual !== value;
}

// `&&` binds tighter than `||`; no parentheses in v1. Empty/absent condition → always visible.
export function evalWhen(expr: string | undefined, ctx: HeaderContext): boolean {
  if (!expr || !expr.trim()) return true;
  return expr.split("||").some((group) => group.split("&&").every((atom) => evalAtom(atom, ctx)));
}

function resolveOpen(open: OpenTarget, ctx: HeaderContext): OpenTarget {
  const out: OpenTarget = {};
  if (open.url) out.url = substitute(open.url, ctx);
  // `reveal`/`files` are intentionally NOT confined to the session cwd (accepted trust boundary): per-project
  // config is the same trust surface as script.json (which already runs arbitrary shell from <cwd>), and
  // revealing a sibling worktree/related repo is a real workflow. Any hardening should be a cross-cutting
  // "trusted directories" gate that also covers script.json, not a header-only path check. See the spec.
  if (open.reveal) out.reveal = substitute(open.reveal, ctx);
  if (open.files) out.files = substitute(open.files, ctx);
  if (open.view) out.view = open.view;
  if (open.terminal) out.terminal = substitute(open.terminal, ctx);
  // `pr` resolves to the current branch's PR URL (a plain url open); buttons with no PR are dropped
  // upstream in resolveHeader, so ctx.prUrl is set whenever we get here.
  if (open.pr && ctx.prUrl) out.url = ctx.prUrl;
  if (open.pickFile) out.pickFile = true;
  return out;
}

function resolveButton(button: HeaderButton, ctx: HeaderContext): ResolvedButton {
  const resolved: ResolvedButton = { id: button.id, label: button.label, run: button.run };
  if (button.emoji) resolved.emoji = button.emoji;
  if (button.icon) resolved.icon = button.icon;
  if (button.text) resolved.text = substitute(button.text, ctx);
  if (button.open) resolved.open = resolveOpen(button.open, ctx);
  return resolved; // shell `cmd` is deliberately not resolved here — see resolveButtonCommand
}

// Like `substitute`, but each ${var} value is passed through `quote` before insertion. Used to build a
// shell command whose context values (branch/repo/task) may contain metacharacters: the command template
// is trusted config, so only the substituted values are escaped.
export function substituteShell(text: string, ctx: HeaderContext, quote: (value: string) => string): string {
  return text.replace(VAR_RE, (whole, name: string) => {
    const value = varValue(ctx, name);
    return value === undefined ? whole : quote(value);
  });
}

// Resolve a shell button's command by id at exec time. Authorization is membership in the user's trusted
// config — the button must exist and be run:"shell". It deliberately does NOT re-check `when`: the exec
// context is built entirely from client input (cwd/agent/model/session), so `when` can't be a server-side
// gate; it's a display-time visibility filter (applied in resolveHeader for /api/header). The security
// boundary is "the command is in the user's config" + the same-origin guard on /ws/run.
export function resolveButtonCommand(config: HeaderConfig, ctx: HeaderContext, buttonId: string, quote: (value: string) => string): string | null {
  const button = (config.buttons ?? DEFAULT_BUTTONS).find((b) => b.id === buttonId && b.run === "shell");
  return button?.cmd ? substituteShell(button.cmd, ctx, quote) : null;
}

function resolveChip(chip: HeaderChip, ctx: HeaderContext): ResolvedChip | null {
  if (typeof chip === "string") return isBuiltinChip(chip) ? { kind: "builtin", id: chip } : null;
  return evalWhen(chip.when, ctx) ? { kind: "custom", label: chip.label, text: substitute(chip.text, ctx) } : null;
}

// Whether the resolved config has any `pr` button — so the caller resolves ctx.prUrl (a gh call) only
// when one is actually present, not on every /api/header fetch.
export function headerHasPrButton(config: HeaderConfig): boolean {
  return (config.buttons ?? DEFAULT_BUTTONS).some((b) => b.open?.pr === true);
}

// A `pr` button is shown only when the branch has an open PR (ctx.prUrl set); otherwise it's dropped.
const isVisible = (b: HeaderButton, ctx: HeaderContext): boolean => evalWhen(b.when, ctx) && !(b.open?.pr && !ctx.prUrl);

export function resolveHeader(config: HeaderConfig, ctx: HeaderContext): ResolvedHeader {
  // null buttons == unconfigured → the built-in defaults; an explicit list (even empty) replaces them.
  const buttons = (config.buttons ?? DEFAULT_BUTTONS).filter((b) => isVisible(b, ctx)).map((b) => resolveButton(b, ctx));
  const chips = config.chips === null ? null : config.chips.map((c) => resolveChip(c, ctx)).filter((c): c is ResolvedChip => c !== null);
  return { buttons, chips };
}
