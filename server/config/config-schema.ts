// Single source of truth for MulmoTerminal's config DSL (the per-dir `.mulmoterminal.json`
// and the global `~/.mulmoterminal/config.json`). Schemas here drive three things: the
// TypeScript types (`z.infer`), runtime validation, and the JSON Schema shipped with the
// config skill (`dirConfigJsonSchema`). Keeping shape/type/JSON-Schema in one place stops the
// drift that hand-written sanitizers + a separately-authored schema doc would suffer.
//
// Two behaviours deliberately live OUTSIDE these schemas:
//   1. Lenient array normalization (dedup/cap/payload-matching for buttons/chips) stays as the
//      imperative loaders in header-config.ts — a zod transform replicating it reads worse, not
//      better, and the goal is ease of handling.
//   2. The `sound` path confinement (a filesystem realpath check) stays in dir-config.ts — it
//      touches the disk, which does not belong in a pure schema.
import path from "node:path";
import { z } from "zod";
// Shared with the client dir-config parser so the two can't drift — see common/themeColors.ts.
import { THEME_COLOR_KEYS } from "../../common/themeColors.js";
import { THEME_IDS } from "../../common/themeIds.js";
import { CUSTOM_THEME_ID_RE, THEME_VAR_KEYS, isBuiltinThemeId } from "../../common/themeVars.js";
import { isUsableModelId } from "../../common/modelIds.js";
import { normalizeFontSize, TERMINAL_FONT_SIZE_MAX, TERMINAL_FONT_SIZE_MIN } from "../../common/terminalFontSize.js";
import { normalizeFontFamily, TERMINAL_FONT_FAMILY_MAX_CHARS, TERMINAL_FONT_FAMILY_SAFE_RE } from "../../common/terminalFontFamily.js";
import { normalizeOrderPriority } from "../../common/orderPriority.js";
import { SESSION_AGENTS } from "../../common/sessionAgent.js";
import { NOTIFY_KINDS } from "../../common/notifyKinds.js";
import type { QuickCommand } from "../../common/quickCommands.js";

// ---- shared constants ---------------------------------------------------------------------

export const VIEW_TARGETS = ["diff", "prs", "wiki", "collections", "accounting"] as const;
export const RUN_TYPES = ["shell", "input", "open"] as const;
export const BUILTIN_CHIPS = ["dir", "git", "work", "ctx", "usage", "status", "diff", "tools"] as const;

export const NAME_MAX_CHARS = 40;
// Runtime caps (sanitizeButtons / sanitizeChips truncate past these), mirrored by the JSON Schema
// so the skill can't emit a config whose tail is silently dropped at load time.
export const MAX_BUTTONS = 32;
export const MAX_CHIPS = 16;
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
// xterm accepts #rgb / #rgba / #rrggbb / #rrggbbaa for palette colors.
const PALETTE_COLOR_RE = /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

// ---- primitives ---------------------------------------------------------------------------

// NOT `z.enum(THEME_IDS)` any more (#996): a directory may pin a theme the user defined in
// `themes`, whose id this schema cannot know. The shape is still checked, so a value can be an
// attribute and a filename; whether it RESOLVES is decided at paint time, where a missing theme
// is reported instead of silently falling back (useTheme.ts).
export const themeIdSchema = z.string().regex(CUSTOM_THEME_ID_RE);
export const viewTargetSchema = z.enum(VIEW_TARGETS);
export const runTypeSchema = z.enum(RUN_TYPES);
export const builtinChipSchema = z.enum(BUILTIN_CHIPS);

export type ThemeId = z.infer<typeof themeIdSchema>;
export type ViewTarget = z.infer<typeof viewTargetSchema>;
export type RunType = z.infer<typeof runTypeSchema>;
export type BuiltinChip = z.infer<typeof builtinChipSchema>;

// A #rrggbb color, trimmed and lowercased. Strict (throws on mismatch) — the lenient per-field
// wrappers below add the "invalid → null" behaviour the loaders want.
const hexColor = z
  .string()
  .trim()
  .regex(HEX_COLOR_RE)
  .transform((s) => s.toLowerCase());
const paletteColor = z
  .string()
  .trim()
  .regex(PALETTE_COLOR_RE)
  .transform((s) => s.toLowerCase());

// ---- DSL item schemas (the writable shapes) -----------------------------------------------

const openTargetShape = {
  url: z.string().optional(),
  reveal: z.string().optional(),
  files: z.string().optional(),
  view: viewTargetSchema.optional(),
  // A directory: open a NEW terminal cell there, running the OS default shell ($SHELL).
  terminal: z.string().optional(),
  // Open the current branch's PR in the browser. The button is hidden when no open PR exists.
  pr: z.boolean().optional(),
  // No target string: open the OS file dialog and insert the chosen path(s) into the session.
  pickFile: z.boolean().optional(),
};
export const openTargetSchema = z.object(openTargetShape);
export type OpenTarget = z.infer<typeof openTargetSchema>;

export const headerButtonSchema = z.object({
  id: z.string(),
  emoji: z.string().optional(),
  icon: z.string().optional(),
  label: z.string(),
  run: runTypeSchema,
  cmd: z.string().optional(),
  text: z.string().optional(),
  open: openTargetSchema.optional(),
  when: z.string().optional(),
  order: z.number().optional(),
});
export type HeaderButton = z.infer<typeof headerButtonSchema>;

export const customChipSchema = z.object({ label: z.string(), text: z.string(), when: z.string().optional() });
export const headerChipSchema = z.union([z.string(), customChipSchema]);
export type HeaderChip = z.infer<typeof headerChipSchema>;

// ---- global config item schemas -----------------------------------------------------------

// A directory the launch form offers as a working-directory suggestion (most-recent first).
export const cwdPresetSchema = z.object({ label: z.string(), path: z.string() });
export type CwdPreset = z.infer<typeof cwdPresetSchema>;

// A named program a grid cell can launch instead of Claude (a plain shell, codex, any
// interactive command). `command` runs on the user's own machine as a persistent PTY.
export const launcherSchema = z.object({ label: z.string(), command: z.string() });
export type Launcher = z.infer<typeof launcherSchema>;

// Validation for common/quickCommands.ts's QuickCommand, which the settings UI edits and so
// cannot live here. `satisfies` is what keeps the two from drifting: widen the schema without
// widening the interface and this stops compiling.
export const quickCommandSchema = z.object({
  label: z.string(),
  text: z.string(),
  agents: z.array(z.enum(SESSION_AGENTS)).optional(),
}) satisfies z.ZodType<QuickCommand>;

// A colour scheme the user defined (#996), offered in Settings next to the four built-ins.
//
// The values land in CSS custom properties, so `paletteColor` is doing security work here, not
// just tidiness: a value that escaped the hex shape would be injected into a style declaration.
//
// `extends` is optional. With it, `colors` is a diff over that built-in; without it, the client
// requires the full THEME_VAR_KEYS set before painting (resolveThemeVars) — a half-applied theme
// would otherwise inherit the rest from whatever was on the element before.
export const customThemeSchema = z
  .object({
    id: z
      .string()
      .regex(CUSTOM_THEME_ID_RE)
      .refine((id) => !isBuiltinThemeId(id), {
        message: "id shadows a built-in theme",
      }),
    label: z.string().trim().min(1).max(NAME_MAX_CHARS),
    extends: z.enum(THEME_IDS).optional(),
    colors: z.partialRecord(z.enum(THEME_VAR_KEYS), paletteColor),
  })
  // Enforced HERE, not only where it is painted (Codex review on #996): an incomplete theme with
  // no base cannot be resolved, so keeping it puts an entry in the picker that silently falls
  // back to the default when chosen — and reports "not defined" about a theme that plainly is.
  // Dropping it at the boundary keeps the offer and the outcome the same thing.
  .refine((theme) => theme.extends !== undefined || THEME_VAR_KEYS.every((key) => theme.colors[key]), {
    message: "a theme with no `extends` must set every colour",
  });
export type CustomTheme = z.infer<typeof customThemeSchema>;

// A user-added HTTP MCP server for the single-view session. `id` becomes the server name in
// --mcp-config (and the `mcp__<id>__*` tool prefix), `url` its streamable-HTTP endpoint.
export const userMcpServerSchema = z.object({ id: z.string(), url: z.string() });
export type UserMcpServer = z.infer<typeof userMcpServerSchema>;

// ---- lenient per-dir field parsers (missing / malformed → null, never throw) --------------
// `.parse` on these is safe because the terminal `.catch(null)` swallows every failure.

export const dirColorField = hexColor.nullable().catch(null);
export const dirThemeField = themeIdSchema.nullable().catch(null);
// Clamped, not range-checked: normalizeFontSize keeps an out-of-range number at the nearest
// usable size instead of discarding it, so `fontSize: 99` reads as "as big as allowed" rather
// than silently falling back to the global size. writableDirConfigSchema below is the strict
// one, so an out-of-range value is still reported where it can be fixed — at authoring time.
// Not clamped like the font size: every integer is a usable rank, so there is nothing to pull
// back into range. Anything else (a fraction, a string, absent) becomes null, which the grid
// reads as "unset" and sorts last. Shares normalizeOrderPriority with the client's own parser
// so the two boundaries can't disagree about what a rank is.
export const dirOrderPriorityField = z
  .unknown()
  .transform((value) => normalizeOrderPriority(value))
  .nullable()
  .catch(null);

export const dirFontSizeField = z
  .unknown()
  .transform((value) => normalizeFontSize(value))
  .nullable()
  .catch(null);
// Rejected as a whole rather than clamped, unlike the size above: a stack is one intent, so
// keeping the half of it that parsed would render in a font the author never named.
export const dirFontFamilyField = z
  .unknown()
  .transform((value) => normalizeFontFamily(value))
  .nullable()
  .catch(null);
export const dirNameField = z
  .string()
  .trim()
  .min(1)
  .transform((s) => s.slice(0, NAME_MAX_CHARS))
  .nullable()
  .catch(null);

// Keep only known ITheme keys whose value is a valid palette color; null when nothing valid
// remains, so an empty/garbage block behaves like "unset".
export const dirColorsField = z
  .record(z.string(), z.unknown())
  .transform((obj) => {
    const out: Record<string, string> = {};
    for (const key of THEME_COLOR_KEYS) {
      const parsed = paletteColor.safeParse(obj[key]);
      if (parsed.success) out[key] = parsed.data;
    }
    return Object.keys(out).length ? out : null;
  })
  .nullable()
  .catch(null);

// A provider/model id the launch path will actually accept. Enforced here too, so the
// picker can never offer an id that the ws query drops on the way to the spawn — a
// dropped provider whose model survives would start the session on Anthropic instead.
const modelIdSchema = z.string().trim().refine(isUsableModelId);

// An Anthropic-compatible backend a directory can point its sessions at (#579). The key
// itself is never stored here — `tokenEnv` names the env var the SERVER reads it from,
// because this config is served over HTTP to the browser and the phone.
export const providerSchema = z.object({
  id: modelIdSchema,
  label: z.string().min(1),
  // No trailing /v1: Claude Code appends /v1/messages itself.
  baseUrl: z.string().min(1),
  tokenEnv: z.string().min(1),
  maxOutputTokens: z.number().int().positive().optional(),
  // Extra model ids to offer in the launch picker, on top of the built-in presets
  // (common/modelPresets.ts). Listed here rather than measured, so the picker shows them
  // without the pass-rate the presets carry. A malformed entry is dropped on its own —
  // one typo must not take the provider's other models with it.
  models: z
    .array(z.unknown())
    .transform((entries) => entries.filter((entry): entry is string => typeof entry === "string" && isUsableModelId(entry.trim())).map((entry) => entry.trim()))
    .catch([])
    .default([]),
});
export type Provider = z.infer<typeof providerSchema>;

// Whether this directory's sessions carry the built-in closing-summary instructions (#1062).
// A tri-state, unlike the global boolean it overrides: null means the key is absent, which is
// what makes "follow the global setting" distinguishable from an explicit `false` here.
export const dirAppendSystemPromptField = z.boolean().nullable().catch(null);

// Which provider/model a directory's sessions run on. Both lenient: a typo must not stop
// the directory's other settings from loading — resolveProvider reports the real problem
// at spawn time, where the user sees it.
export const dirProviderField = z.string().trim().min(1).nullable().catch(null);
export const dirModelField = z.string().trim().min(1).nullable().catch(null);

// A per-dir allowlist for the header Skill menu: which skill slugs to show, in this
// order. Trimmed, deduped, capped. null when unset/garbage/empty — which means
// "no filter, show every discovered skill" (absent config == show all).
export const MAX_SKILL_FILTER = 100;
export const dirSkillsField = z
  .array(z.string())
  .transform((arr) => {
    const cleaned = [...new Set(arr.map((s) => s.trim()).filter(Boolean))].slice(0, MAX_SKILL_FILTER);
    return cleaned.length ? cleaned : null;
  })
  .nullable()
  .catch(null);

// Extra directories a session may read/edit — Claude Code's `--add-dir` (#908), the
// terminal-side answer to opening several folders in one VS Code workspace. Relative
// entries resolve against the directory holding the config, which is what a reader of
// `"../shared-lib"` means; a managed worktree runs from elsewhere and must not silently
// point somewhere else. A path that does not exist is dropped HERE rather than passed on:
// the flag would otherwise look applied while the agent sees nothing.
export const MAX_ADD_DIRS = 16;
export function resolveAddDirs(input: unknown, base: string, exists: (p: string) => boolean): string[] | null {
  if (!Array.isArray(input)) return null;
  const resolved = input
    .filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "")
    .map((entry) => path.resolve(base, entry.trim()))
    // The workspace itself is already the session's cwd — listing it again would add a
    // duplicate container mount and grant nothing.
    // `exists` touches the disk, so it can throw (EACCES, or the path vanishing between the
    // check and the stat). This runs inside loadDirConfig's outer try, where a throw costs
    // the WHOLE directory config — colors, sound, skills — over one unreadable entry. A
    // failure here means "drop this entry", never "drop everything".
    .filter((dir) => {
      if (dir === path.resolve(base)) return false;
      try {
        return exists(dir);
      } catch {
        return false;
      }
    });
  const unique = [...new Set(resolved)].slice(0, MAX_ADD_DIRS);
  return unique.length ? unique : null;
}

// ---- JSON Schema for the config skill -----------------------------------------------------
// The WRITABLE per-dir shape (what a user types into `.mulmoterminal.json`), described strictly
// so the skill can validate its output and drive structured generation. Distinct from the
// lenient loader above, which tolerates junk; this documents the correct shape.
//
// Buttons/chips are STRICTER here than the flat item schemas used for types: the JSON Schema must
// match what the runtime loader actually accepts, or the skill could emit a "valid" config that
// sanitization silently drops (a no-op the user reads as success).

// The runtime keeps only trimmed, non-empty strings (`str()` in header-config.ts), so a
// whitespace-only value is dropped at load time. Reject it here too, or the skill can emit a
// schema-valid button that silently vanishes.
const nonEmptyText = z.string().min(1).regex(/\S/);

const writableOpenTargetShape = {
  url: nonEmptyText.optional(),
  reveal: nonEmptyText.optional(),
  files: nonEmptyText.optional(),
  view: viewTargetSchema.optional(),
  terminal: nonEmptyText.optional(),
  pr: z.literal(true).optional(),
  pickFile: z.literal(true).optional(),
};

// `open` requires at least one target (url/reveal/files/view/terminal/pr/pickFile), mirroring sanitizeOpen.
const writableOpenTargetSchema = z.union([
  z.object({ ...writableOpenTargetShape, url: nonEmptyText }),
  z.object({ ...writableOpenTargetShape, reveal: nonEmptyText }),
  z.object({ ...writableOpenTargetShape, files: nonEmptyText }),
  z.object({ ...writableOpenTargetShape, view: viewTargetSchema }),
  z.object({ ...writableOpenTargetShape, terminal: nonEmptyText }),
  z.object({ ...writableOpenTargetShape, pr: z.literal(true) }),
  z.object({ ...writableOpenTargetShape, pickFile: z.literal(true) }),
]);

const commonButtonFields = {
  id: nonEmptyText,
  label: nonEmptyText,
  emoji: nonEmptyText.optional(),
  icon: nonEmptyText.optional(),
  when: nonEmptyText.optional(),
  order: z.number().optional(),
};

// Run-discriminated: each run type requires the payload the runtime needs (shell→cmd, input→text,
// open→open), so the schema matches live acceptance instead of accepting no-op buttons.
const writableHeaderButtonSchema = z.discriminatedUnion("run", [
  z.object({ ...commonButtonFields, run: z.literal("shell"), cmd: nonEmptyText }),
  z.object({ ...commonButtonFields, run: z.literal("input"), text: nonEmptyText }),
  z.object({ ...commonButtonFields, run: z.literal("open"), open: writableOpenTargetSchema }),
]);

// A builtin chip id (the runtime drops any other string), or a custom chip whose label/text the
// runtime likewise requires to be non-empty.
const writableCustomChipSchema = z.object({ label: nonEmptyText, text: nonEmptyText, when: nonEmptyText.optional() });
const writableHeaderChipSchema = z.union([builtinChipSchema, writableCustomChipSchema]);

const writableDirConfigSchema = z.object({
  name: nonEmptyText.max(NAME_MAX_CHARS).optional(),
  badgeColor: z.string().regex(HEX_COLOR_RE).optional(),
  headerColor: z.string().regex(HEX_COLOR_RE).optional(),
  headerTextColor: z.string().regex(HEX_COLOR_RE).optional(),
  cellColor: z.string().regex(HEX_COLOR_RE).optional(),
  cellBorderColor: z.string().regex(HEX_COLOR_RE).optional(),
  dotColor: z.string().regex(HEX_COLOR_RE).optional(),
  buttonColor: z.string().regex(HEX_COLOR_RE).optional(),
  theme: themeIdSchema.optional(),
  // partialRecord, NOT record: zod v4's z.record over an enum key is EXHAUSTIVE — its JSON
  // Schema marks every one of the ~23 palette keys `required`, so the shipped
  // dir-config.schema.json rejects the common `colors: { background: … }` (the skill sets
  // one color) with 22 missing-key errors. partialRecord keeps the same runtime key + value
  // validation but leaves the keys optional in the generated schema.
  colors: z.partialRecord(z.enum(THEME_COLOR_KEYS), z.string().regex(PALETTE_COLOR_RE)).optional(),
  // xterm font size in px for this directory's terminals. Omit to follow the Settings value.
  fontSize: z.number().int().min(TERMINAL_FONT_SIZE_MIN).max(TERMINAL_FONT_SIZE_MAX).optional(),
  // CSS font-family stack for this directory's terminals. Omit to follow the global config.
  // The pattern is the portable subset of the real rule — z.toJSONSchema drops a `.refine`, so
  // an exact check here would vanish from the shipped schema; normalizeFontFamily is the rule.
  fontFamily: z.string().min(1).max(TERMINAL_FONT_FAMILY_MAX_CHARS).regex(TERMINAL_FONT_FAMILY_SAFE_RE).optional(),
  // Rank in the grid's "priority" sort mode, ascending. Omit to sort after everything that sets it.
  orderPriority: z.number().int().optional(),
  sound: nonEmptyText.optional(),
  // Per-notification-kind sound, overriding `sound` for that kind. Each value is either
  // `preset:<id>` or a path relative to this directory, same as `sound`. partialRecord for
  // the same reason `colors` uses it: z.record over an enum marks every key required in the
  // generated JSON Schema, which would reject the usual one-or-two-kind object.
  sounds: z.partialRecord(z.enum(NOTIFY_KINDS), nonEmptyText).optional(),
  buttons: z.array(writableHeaderButtonSchema).max(MAX_BUTTONS).optional(),
  chips: z.array(writableHeaderChipSchema).max(MAX_CHIPS).optional(),
  // Header Skill-menu allowlist: show only these skill slugs, in this order. Omit to show all.
  skills: z.array(nonEmptyText).max(MAX_SKILL_FILTER).optional(),
  // Which backend this directory's sessions run on (#579). `provider` names an entry in the
  // global config's `providers`; `model` alone picks a different model on Anthropic itself.
  provider: nonEmptyText.optional(),
  model: nonEmptyText.optional(),
  // Extra directories this dir's sessions may read/edit — Claude Code's `--add-dir` (#908).
  // Relative entries resolve against this file's own directory. Claude only; codex has no
  // equivalent flag and ignores the key.
  addDirs: z.array(nonEmptyText).max(MAX_ADD_DIRS).optional(),
  // Whether this directory's sessions carry the built-in closing-summary instructions (#1062).
  // Omit to follow `appendSystemPrompt` in the global config, which defaults to on.
  appendSystemPrompt: z.boolean().optional(),
});

export function dirConfigJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(writableDirConfigSchema);
}
