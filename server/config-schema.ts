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
import { z } from "zod";

// ---- shared constants ---------------------------------------------------------------------

export const THEME_IDS = ["midnight", "nord", "daylight", "solarized"] as const;
export const VIEW_TARGETS = ["diff", "prs", "wiki", "collections", "accounting"] as const;
export const RUN_TYPES = ["shell", "input", "open"] as const;
export const BUILTIN_CHIPS = ["dir", "git", "ctx", "usage", "status", "diff", "tools"] as const;

// The xterm ITheme keys a `colors` block may override. Anything outside this set is dropped so
// an arbitrary JSON object can't inject unexpected keys into the terminal options.
export const THEME_COLOR_KEYS = [
  "foreground",
  "background",
  "cursor",
  "cursorAccent",
  "selectionBackground",
  "selectionForeground",
  "selectionInactiveBackground",
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "brightBlack",
  "brightRed",
  "brightGreen",
  "brightYellow",
  "brightBlue",
  "brightMagenta",
  "brightCyan",
  "brightWhite",
] as const;

export const NAME_MAX_CHARS = 40;
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
// xterm accepts #rgb / #rgba / #rrggbb / #rrggbbaa for palette colors.
const PALETTE_COLOR_RE = /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

// ---- primitives ---------------------------------------------------------------------------

export const themeIdSchema = z.enum(THEME_IDS);
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

export const openTargetSchema = z.object({
  url: z.string().optional(),
  reveal: z.string().optional(),
  files: z.string().optional(),
  view: viewTargetSchema.optional(),
});
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

// A user-added HTTP MCP server for the single-view session. `id` becomes the server name in
// --mcp-config (and the `mcp__<id>__*` tool prefix), `url` its streamable-HTTP endpoint.
export const userMcpServerSchema = z.object({ id: z.string(), url: z.string() });
export type UserMcpServer = z.infer<typeof userMcpServerSchema>;

// ---- lenient per-dir field parsers (missing / malformed → null, never throw) --------------
// `.parse` on these is safe because the terminal `.catch(null)` swallows every failure.

export const dirColorField = hexColor.nullable().catch(null);
export const dirThemeField = themeIdSchema.nullable().catch(null);
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

// ---- JSON Schema for the config skill -----------------------------------------------------
// The WRITABLE per-dir shape (what a user types into `.mulmoterminal.json`), described strictly
// so the skill can validate its output and drive structured generation. Distinct from the
// lenient loader above, which tolerates junk; this documents the correct shape.
const writableDirConfigSchema = z.object({
  name: z.string().max(NAME_MAX_CHARS).optional(),
  badgeColor: z.string().regex(HEX_COLOR_RE).optional(),
  headerColor: z.string().regex(HEX_COLOR_RE).optional(),
  headerTextColor: z.string().regex(HEX_COLOR_RE).optional(),
  cellColor: z.string().regex(HEX_COLOR_RE).optional(),
  cellBorderColor: z.string().regex(HEX_COLOR_RE).optional(),
  dotColor: z.string().regex(HEX_COLOR_RE).optional(),
  buttonColor: z.string().regex(HEX_COLOR_RE).optional(),
  theme: themeIdSchema.optional(),
  colors: z.record(z.enum(THEME_COLOR_KEYS), z.string().regex(PALETTE_COLOR_RE)).optional(),
  sound: z.string().optional(),
  buttons: z.array(headerButtonSchema).optional(),
  chips: z.array(headerChipSchema).optional(),
});

export function dirConfigJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(writableDirConfigSchema);
}
