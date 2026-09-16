// The skills MulmoTerminal ships, named once for both sides.
//
// Shared rather than mirrored because BOTH sides decide from these: the server COPIES these
// directories into the user's skills roots at boot, and the client LAUNCHES one by name from the
// Settings section that owns it. A name that lives in two places is a name that can drift, and it
// did — the grid view and the single view each spelled the appearance skill out, a rename updated
// one of them, and the same button then launched a different skill depending on which view you
// pressed it from. Each half was self-consistent, so nothing failed (Codex review on #1103).
// `BundledSkillName` is what keeps the Settings buttons honest now: a slug naming no shipped skill
// is a type error rather than an agent replying that it can't find one.

/** Every skill directory under `server/skills/`, in the order the installer walks them. A spec
 *  pins this list against what is actually on disk: adding a directory is not what ships it, and
 *  one nobody lists is copied nowhere with no error at any point. */
export const BUNDLED_SKILL_NAMES = [
  "bot",
  "mulmoterminal-config",
  "mulmoterminal-dirs",
  "mulmoterminal-theme",
  "mulmoterminal-header",
  "mulmoterminal-keys",
  "mulmoterminal-model",
  "mulmoterminal-notify",
  "mulmoterminal-bug-report",
  "mulmoterminal-decisions",
  "mulmoterminal-shared-app",
] as const;

export type BundledSkillName = (typeof BUNDLED_SKILL_NAMES)[number];

/** The skill that owns `<project>/.mulmoterminal.json` — the one the generated JSON Schema ships
 *  beside, so the schema sits with the skill that actually writes that file. */
export const DIR_CONFIG_SKILL = "mulmoterminal-dirs";
