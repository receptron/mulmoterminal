// Resolve a merged HeaderConfig against a session's live context: drop items whose `when` is false,
// and substitute ${vars} in commands / text / open targets / custom chip text. Pure — the caller
// gathers the HeaderContext (cwd, git status, model, agent, …) from server state.

import type {
  BuiltinChip,
  HeaderButton,
  HeaderChip,
  HeaderConfig,
  HeaderContext,
  OpenTarget,
  ResolvedButton,
  ResolvedChip,
  ResolvedHeader,
} from "./header-config.js";
import { BUILTIN_CHIPS } from "./header-config.js";

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
  const equal = actual !== undefined && actual === value;
  return op === "==" ? equal : !equal;
}

// `&&` binds tighter than `||`; no parentheses in v1. Empty/absent condition → always visible.
export function evalWhen(expr: string | undefined, ctx: HeaderContext): boolean {
  if (!expr || !expr.trim()) return true;
  return expr.split("||").some((group) => group.split("&&").every((atom) => evalAtom(atom, ctx)));
}

function resolveOpen(open: OpenTarget, ctx: HeaderContext): OpenTarget {
  const out: OpenTarget = {};
  if (open.url) out.url = substitute(open.url, ctx);
  if (open.reveal) out.reveal = substitute(open.reveal, ctx);
  if (open.files) out.files = substitute(open.files, ctx);
  if (open.view) out.view = open.view;
  return out;
}

function resolveButton(button: HeaderButton, ctx: HeaderContext): ResolvedButton {
  const resolved: ResolvedButton = { id: button.id, label: button.label, run: button.run };
  if (button.emoji) resolved.emoji = button.emoji;
  if (button.icon) resolved.icon = button.icon;
  if (button.cmd) resolved.cmd = substitute(button.cmd, ctx);
  if (button.text) resolved.text = substitute(button.text, ctx);
  if (button.open) resolved.open = resolveOpen(button.open, ctx);
  return resolved;
}

function resolveChip(chip: HeaderChip, ctx: HeaderContext): ResolvedChip | null {
  if (typeof chip === "string") return isBuiltinChip(chip) ? { kind: "builtin", id: chip } : null;
  return evalWhen(chip.when, ctx) ? { kind: "custom", label: chip.label, text: substitute(chip.text, ctx) } : null;
}

export function resolveHeader(config: HeaderConfig, ctx: HeaderContext): ResolvedHeader {
  const buttons = config.buttons.filter((b) => evalWhen(b.when, ctx)).map((b) => resolveButton(b, ctx));
  const chips = config.chips === null ? null : config.chips.map((c) => resolveChip(c, ctx)).filter((c): c is ResolvedChip => c !== null);
  return { buttons, chips };
}
