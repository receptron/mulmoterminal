// The user-configurable terminal header: action buttons + display chips. Read from the global
// AppConfig (~/.mulmoterminal/config.json) and the per-dir DirConfig (<cwd>/.mulmoterminal.json),
// merged, then RESOLVED per session (evaluate `when`, substitute ${vars}) before the client renders.
//
// The button/chip SHAPES + types come from config-schema.ts (zod). This file owns the lenient
// LOADERS (trim, drop-empty, payload-match, dedup, cap) and the per-session resolution types —
// normalization policy that reads better imperatively than as a zod transform.
//
// Hard rule: absent config == today's header. `sanitizeChips` returns null when unconfigured, and the
// resolver passes that through so the client keeps its hardcoded default chips; empty `buttons` means
// only the built-in buttons show.

import {
  RUN_TYPES,
  VIEW_TARGETS,
  BUILTIN_CHIPS,
  MAX_BUTTONS,
  MAX_CHIPS,
  type RunType,
  type ViewTarget,
  type OpenTarget,
  type HeaderButton,
  type HeaderChip,
  type BuiltinChip,
} from "./config-schema.js";

export interface HeaderConfig {
  buttons: HeaderButton[] | null; // null = unconfigured (falls back to DEFAULT_BUTTONS); [] = explicitly none
  chips: HeaderChip[] | null; // null = unconfigured (client uses its default)
}

// The header's action buttons when the user hasn't configured `buttons` — a useful starter set,
// each an ordinary config button so the user can drop/reorder/replace them. Configuring `buttons` at
// ANY level REPLACES this whole set (it is NOT merged on top), so a user who wants fewer just lists
// their own shorter set. `pr`/`gh` are gated to git repos (`when: isGitRepo`) and `pr` is dropped when
// the branch has no open PR, so they self-hide where they don't apply.
export const DEFAULT_BUTTONS: HeaderButton[] = [
  { id: "pick-file", icon: "attach_file", label: "Insert a file path", run: "open", open: { pickFile: true } },
  { id: "reveal", emoji: "📂", label: "Reveal in the file manager", run: "open", open: { reveal: "${dir}" } },
  { id: "files", icon: "folder_open", label: "Browse files in the app", run: "open", open: { files: "${dir}" } },
  { id: "terminal", emoji: "🖥", label: "New terminal here", run: "open", open: { terminal: "${dir}" } },
  { id: "pr", emoji: "🔗", label: "Open this branch's PR", run: "open", when: "isGitRepo", open: { pr: true } },
  // `repo != ` gates on a resolvable GitHub owner/repo (ctx.repo is null for non-GitHub or remoteless
  // repos), so this never renders a broken `https://github.com/` link.
  { id: "gh", emoji: "🌐", label: "Open on GitHub", run: "open", when: "repo != ", open: { url: "https://github.com/${repo}" } },
];

// The live context a header is resolved against — all trusted server-side session state.
export interface HeaderContext {
  dir: string;
  dirName: string;
  branch: string | null;
  repo: string | null;
  model: string | null;
  agent: "claude" | "codex";
  session: string | null;
  remoteUrl: string | null;
  dirty: number;
  ahead: number;
  behind: number;
  task: string | null;
  isGitRepo: boolean;
  // The current branch's open PR URL, or null. Resolved only when a `pr` button is present; an
  // `open.pr` button resolves to this URL, or is dropped when it's null.
  prUrl: string | null;
}

export type ResolvedChip = { kind: "builtin"; id: BuiltinChip } | { kind: "custom"; label: string; text: string };
export interface ResolvedButton {
  id: string;
  emoji?: string;
  icon?: string;
  label: string;
  run: RunType;
  // No `cmd`: a shell button's command is never sent to the client — it's re-resolved server-side by id
  // at exec time (see resolveButtonCommand), so the browser never holds a raw command.
  text?: string;
  open?: OpenTarget;
}
export interface ResolvedHeader {
  buttons: ResolvedButton[];
  chips: ResolvedChip[] | null;
}

const RUN_TYPE_SET = new Set<string>(RUN_TYPES);
const VIEW_SET = new Set<string>(VIEW_TARGETS);
const BUILTIN_SET = new Set<string>(BUILTIN_CHIPS);

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const isRunType = (s: string): s is RunType => RUN_TYPE_SET.has(s);
const isViewTarget = (s: string): s is ViewTarget => VIEW_SET.has(s);

function sanitizeOpen(input: unknown): OpenTarget | undefined {
  if (!isRecord(input)) return undefined;
  const url = str(input.url);
  const reveal = str(input.reveal);
  const files = str(input.files);
  const view = str(input.view);
  const target: OpenTarget = {};
  if (url) target.url = url;
  if (reveal) target.reveal = reveal;
  if (files) target.files = files;
  if (view && isViewTarget(view)) target.view = view;
  const terminal = str(input.terminal);
  if (terminal) target.terminal = terminal;
  if (input.pr === true) target.pr = true;
  if (input.pickFile === true) target.pickFile = true;
  return Object.keys(target).length ? target : undefined;
}

// A button needs an id, a label, and a payload matching its run type; anything short of that is dropped.
function sanitizeButton(input: unknown): HeaderButton | null {
  if (!isRecord(input)) return null;
  const id = str(input.id);
  const label = str(input.label);
  const run = str(input.run);
  if (!id || !label || !run || !isRunType(run)) return null;
  const button: HeaderButton = { id, label, run };
  const emoji = str(input.emoji);
  const icon = str(input.icon);
  const when = str(input.when);
  if (emoji) button.emoji = emoji;
  if (icon) button.icon = icon;
  if (when) button.when = when;
  if (typeof input.order === "number" && Number.isFinite(input.order)) button.order = input.order;
  return withPayload(button, input);
}

function withPayload(button: HeaderButton, input: Record<string, unknown>): HeaderButton | null {
  if (button.run === "shell") return str(input.cmd) ? { ...button, cmd: str(input.cmd) } : null;
  if (button.run === "input") return str(input.text) ? { ...button, text: str(input.text) } : null;
  const open = sanitizeOpen(input.open);
  return open ? { ...button, open } : null;
}

// Returns null when `buttons` is absent/malformed — the signal for "unconfigured, use DEFAULT_BUTTONS".
// An explicit array (even empty) is "configured" and replaces the defaults.
export function sanitizeButtons(input: unknown): HeaderButton[] | null {
  if (!Array.isArray(input)) return null;
  const seen = new Set<string>();
  const out: HeaderButton[] = [];
  for (const raw of input) {
    const button = sanitizeButton(raw);
    if (!button || seen.has(button.id)) continue;
    seen.add(button.id);
    out.push(button);
    if (out.length >= MAX_BUTTONS) break;
  }
  return out;
}

function sanitizeChip(input: unknown): HeaderChip | null {
  if (typeof input === "string") return BUILTIN_SET.has(input.trim()) ? input.trim() : null;
  if (!isRecord(input)) return null;
  const label = str(input.label);
  const text = str(input.text);
  if (!label || !text) return null;
  const when = str(input.when);
  return when ? { label, text, when } : { label, text };
}

// Returns null when `chips` is absent/malformed — the signal for "unconfigured, use the default".
export function sanitizeChips(input: unknown): HeaderChip[] | null {
  if (!Array.isArray(input)) return null;
  const out: HeaderChip[] = [];
  for (const raw of input) {
    const chip = sanitizeChip(raw);
    if (chip === null) continue;
    out.push(chip);
    if (out.length >= MAX_CHIPS) break;
  }
  return out;
}

export function sanitizeHeaderConfig(raw: unknown): HeaderConfig {
  const record = isRecord(raw) ? raw : {};
  return { buttons: sanitizeButtons(record.buttons), chips: sanitizeChips(record.chips) };
}

// Merge global under project: buttons keyed by id (project overrides/adds), then ordered by `order`
// (undefined last), stable within equal order. Chips: project wins outright; null passes through.
// Buttons: null == unconfigured. When BOTH levels are unconfigured the result stays null (→ defaults);
// once EITHER level configures a list, the merge produces a concrete array and the defaults are replaced.
export function mergeHeaderConfig(globalConfig: HeaderConfig, projectConfig: HeaderConfig): HeaderConfig {
  const chips = projectConfig.chips ?? globalConfig.chips;
  if (globalConfig.buttons === null && projectConfig.buttons === null) return { buttons: null, chips };
  const byId = new Map<string, HeaderButton>();
  for (const b of globalConfig.buttons ?? []) byId.set(b.id, b);
  for (const b of projectConfig.buttons ?? []) byId.set(b.id, b);
  const buttons = [...byId.values()]
    .map((b, i) => ({ b, i }))
    .sort(byOrderThenInsertion)
    .map((x) => x.b);
  return { buttons, chips };
}

const orderOf = (b: HeaderButton): number => (typeof b.order === "number" ? b.order : Number.POSITIVE_INFINITY);
function byOrderThenInsertion(a: { b: HeaderButton; i: number }, b: { b: HeaderButton; i: number }): number {
  const delta = orderOf(a.b) - orderOf(b.b);
  return delta !== 0 ? delta : a.i - b.i;
}
