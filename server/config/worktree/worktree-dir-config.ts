// What a new git worktree inherits from the project it was cut from (#1317).
//
// `git worktree add` produces a directory whose cell looks like an unrelated project: no colours,
// no name, no model, and last in the priority sort. This derives the worktree's own config from
// the parent's and writes it there.
//
// Written to `.mulmoterminal.local.json`, not to the shared file (#1436). That file is gitignored,
// so the worktree's `git status` stays clean — which matters more than tidiness, since `isDirty`
// reads that same status and `removeWorktree` would refuse to clean up a worktree whose only
// change we wrote ourselves. It also layers OVER a shared config the repository committed, which
// is what lets a project ship its own colours and still give each worktree its own shade.
//
// The input is a LOADED DirConfig, not the raw file. Every field of that has already been
// through the loader's zod validation, so what comes out here is valid by construction and
// needs no second pass — where re-parsing the raw JSON would have to restate the rules.
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DIR_LOCAL_CONFIG_FILE, loadDirConfig, type DirConfig } from "../dir/dir-config.js";
import { dirIconRef } from "../dir/dir-icon.js";
import { dirBackgroundRef } from "../dir/dir-background.js";
import { rotateHue } from "../dir/hue-rotate.js";
import { HEADER_STATUS_KEYS, type HeaderStatusColors } from "../../../common/headerStatusColors.js";

// How far around the hue wheel each successive worktree sits from the one before it. Small
// enough that the whole family still reads as one project, wide enough to tell two cells apart
// at thumbnail size.
const HUE_STEP_DEGREES = 12;

// Adopted unchanged: what the project IS rather than which tree this is. `colors` (the xterm
// palette) is deliberately here and not tinted — rotating the terminal's own palette would move
// the ANSI colours a program's output names, which is a readability change, not a label.
//
// `worktreeEnv` is a DECLARATION of what each tree needs its own of (#1367), not a value, so it
// copies verbatim and the worktree is then reserved its own port and slug. A worktree that did
// not carry it would be the one tree of the project whose dev server still fought for 3000.
//
// `headerStatusTint` is here rather than tinted below because it is a MODE, not a colour — there
// is no hue in "none" to rotate. `review` says how the PROJECT is reviewed, whichever tree a PR
// comes from.
const INHERITED_KEYS = ["name", "theme", "colors", "fontSize", "fontFamily", "provider", "model", "worktreeEnv", "headerStatusTint", "review"] as const;

// The cell's chrome — everything a glance at the grid distinguishes one cell by. These get the
// tint, so a worktree is recognisable both AS this project and as not the project's main tree.
const TINTED_COLOR_KEYS = ["badgeColor", "headerColor", "headerTextColor", "cellColor", "cellBorderColor", "dotColor", "buttonColor"] as const;

// Deliberately absent: `sound` / `sounds` point at a file inside the parent directory that the
// worktree has no copy of, and `addDirs` resolves relative to the config's OWN directory — copied
// verbatim it would silently grant a different set of directories. `buttons` / `commands` / `chips` / `skills` /
// `decks` are the header's own contents, which a worktree composes for itself; a worktree still
// gets the workspace's stories directory in its Mulmo menu, so that one is not left empty.
// `mobileFiles` decides what leaves this machine for the phone, so a worktree shares nothing
// until its own file says so.

/** Each status entry's colours rotated, written in the object form the config accepts. Entries the
 *  project did not set stay unset, so the worktree's file says what the project's said. */
function tintedStatusColors(parent: HeaderStatusColors | null, degrees: number): Record<string, Record<string, string>> | null {
  if (!parent) return null;
  const out: Record<string, Record<string, string>> = {};
  HEADER_STATUS_KEYS.forEach((status) => {
    const entry = parent[status];
    if (!entry) return;
    const tinted: Record<string, string> = {};
    if (entry.background) tinted.background = rotateHue(entry.background, degrees);
    if (entry.text) tinted.text = rotateHue(entry.text, degrees);
    if (Object.keys(tinted).length) out[status] = tinted;
  });
  return Object.keys(out).length ? out : null;
}

/** The worktree's rank in the grid's priority sort: one past its parent's, so it sits directly
 *  after the project it came from. Only when the parent declares one — inventing a rank for a
 *  project that set none would pull it ahead of every project that did. */
function worktreeRank(parentRank: number | null): number | null {
  if (parentRank === null) return null;
  const rank = parentRank + 1;
  return Number.isSafeInteger(rank) ? rank : null;
}

/** The local-override contents for the `index`-th worktree of a project (1-based, so the first
 *  worktree is already one step off the parent's hue). Keys the parent doesn't set are left out
 *  rather than written as null, so the file reads like one a person would have typed.
 *
 *  Still the FULL derived config rather than only the tinted colours: a repository that commits
 *  its shared file has the identity keys underneath already, and one that gitignores it has
 *  nothing there at all. Writing everything works in both, and re-stating a value that is already
 *  the same value costs nothing. */
export function inheritedWorktreeConfig(parent: DirConfig, index: number): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  INHERITED_KEYS.forEach((key) => {
    const value = parent[key];
    if (value !== null) config[key] = value;
  });
  TINTED_COLOR_KEYS.forEach((key) => {
    const value = parent[key];
    if (value !== null) config[key] = rotateHue(value, index * HUE_STEP_DEGREES);
  });
  // The same tint, one level down. A project that recolours its running header has to keep that
  // colour in its worktrees — the header a glance lands on is the same header — and it has to move
  // with the rest of the chrome, or a worktree's `working` state would be the one thing about the
  // cell that still reads as the parent's.
  const statusColors = tintedStatusColors(parent.headerStatusColors, index * HUE_STEP_DEGREES);
  if (statusColors) config.headerStatusColors = statusColors;
  // Written back AS THE PARENT WROTE IT, not as the loader resolved it: a file icon resolves to
  // an absolute path, and this key only accepts relative ones — so the derived config would be
  // rejected by the same rule that produced it. The relative path resolves again inside the
  // worktree, where a committed logo is at the same place; one that isn't committed simply
  // resolves to nothing there, which is the right answer rather than a broken image.
  const icon = dirIconRef(parent.icon);
  if (icon !== null) config.icon = icon;
  const backgroundImage = dirBackgroundRef(parent.backgroundImage);
  if (backgroundImage !== null) config.backgroundImage = backgroundImage;
  // `false` travels too, and has to: a project that turned its icon OFF would otherwise have
  // worktrees that go looking for its favicon and find one (#1428).
  const rank = worktreeRank(parent.orderPriority);
  if (rank !== null) config.orderPriority = rank;
  return config;
}

/** Write the derived config into `worktreeDir`, as `name` — the local override by default, or the
 *  shared file for a repository set up before #1436, which gitignores that one instead. Returns
 *  whether a file was written.
 *
 *  Writes nothing when the parent configures nothing this carries — an empty `{}` on disk is a
 *  file the settings preview would report as present and doing nothing. Never overwrites: a
 *  worktree that already has one either committed it to the repo or was set up by hand, and
 *  either way that file is the answer, not ours. */
export function writeInheritedDirConfig(parentDir: string, worktreeDir: string, index: number, name: string = DIR_LOCAL_CONFIG_FILE): boolean {
  const config = inheritedWorktreeConfig(loadDirConfig(parentDir), index);
  if (Object.keys(config).length === 0) return false;
  const file = path.join(worktreeDir, name);
  if (existsSync(file)) return false;
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return true;
}
