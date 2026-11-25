// Marking a folder of MulmoTerminal's OWN as trusted for Claude Code, in the login's own config.
//
// Two folders need it. The usage probe's (#3206): the probe sends no keys (#1293), so a trust dialog
// it meets can only time it out, and nobody runs `claude` in its folder (probe-cwd.ts) by hand. And
// the drops root (#3313): every claude cell is handed its session's drop directory with --add-dir,
// and from 2.1.326 Claude Code stops at startup to ask about any added folder that is not trusted.
// Claude Code keeps that answer as `projects[<dir>].hasTrustDialogAccepted` in its config file, and
// outside a git repository it also accepts the answer from any ANCESTOR, which is why trusting the
// drops root covers every session directory made under it.
//
// This is NOT what #1293 removed. That was a blind Enter confirming the dialog in whatever folder the
// probe happened to be in — the user's — so a folder nobody approved got trusted. Both folders here
// are MulmoTerminal's own and hold only what it wrote, so trusting them lets Claude Code read nothing
// it would not read anyway. A caller passing a user's directory would be a bug, not a feature.
//
// The file is Claude Code's, and Claude Code rewrites it while running, so the write is as small as
// it can be made: only when the key is not already true, parsed and re-serialised in one step — the
// same round trip Claude Code's own writes make, so nothing this loses (an escape's spelling, a
// duplicate key) survives its next save either — and landed by rename so a reader never sees half
// a file. The window between the read and the rename is still a window: a Claude Code save landing
// inside it is overwritten, and one landing just after it overwrites ours. That is why the caller
// trusts a WRITE only once a later read finds the key in place — a write that did not stick is
// simply made again. A write that cannot be made — no file yet (a login that has never run claude),
// unreadable, not JSON — does nothing: the probe's gauge keeps its trust-prompt note, and a cell
// meets Claude Code's own prompt, as both did before.
import { randomBytes } from "node:crypto";
import { chmodSync, lstatSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isRecord } from "../../../common/isRecord.js";
import { claudeConfigProjectKey } from "./config-project-key.js";
import { fileStamp } from "../../files/fileStamp.js";

const TRUST_KEY = "hasTrustDialogAccepted";
// Claude Code writes its config two-space indented; matching it keeps the rewrite a one-line diff.
const CONFIG_INDENT = 2;
const PERMISSION_BITS = 0o777;
// Beside the pid, so two servers on one HOME — or one server's two writes — never share a name.
const TEMP_SUFFIX_BYTES = 4;

/** What the config needs: nothing (already trusted), one rewrite, or nothing because it cannot be
 *  read as Claude Code's config at all. */
export type TrustEdit = { outcome: "trusted" } | { outcome: "write"; text: string } | { outcome: "unreadable" };

/** Pure: Claude Code's config with `projects[dir]` marked trusted. Keeps every other byte of meaning
 *  — key order, the entry's other fields, and whether the file ends in a newline — so the rewrite
 *  changes one field and nothing else. An entry that is not an object is not Claude Code's; it is
 *  left alone rather than replaced. */
export function withFolderTrusted(configText: string, dir: string): TrustEdit {
  let config: unknown;
  try {
    config = JSON.parse(configText);
  } catch {
    return { outcome: "unreadable" };
  }
  if (!isRecord(config)) return { outcome: "unreadable" };
  const projects = config.projects === undefined ? {} : config.projects;
  if (!isRecord(projects)) return { outcome: "unreadable" };
  const entry = projects[dir] === undefined ? {} : projects[dir];
  if (!isRecord(entry)) return { outcome: "unreadable" };
  if (entry[TRUST_KEY] === true) return { outcome: "trusted" };
  const trusted = { ...projects, [dir]: { ...entry, [TRUST_KEY]: true } };
  const text = JSON.stringify({ ...config, projects: trusted }, null, CONFIG_INDENT);
  return { outcome: "write", text: configText.endsWith("\n") ? `${text}\n` : text };
}

/** How a call left the file: the key was already there (`trusted`), it was just written (`written`)
 *  — which is only a claim until a later read finds it, see the header — or nothing could be done. */
export type TrustResult = "trusted" | "written" | "failed";

/** Mark `dir` trusted in `configFile`, landed by rename, under the key Claude Code looks it up by. */
export function ensureFolderTrusted(configFile: string, dir: string): TrustResult {
  let edit: TrustEdit;
  let target: string;
  let mode: number;
  try {
    // The file itself, not a symlink to it: a dotfiles setup keeps `~/.claude.json` as a link, and a
    // rename over the link would replace it with a plain file that Claude Code's saves then update
    // while the dotfiles copy stops moving.
    target = realpathSync(configFile);
    mode = statSync(target).mode & PERMISSION_BITS;
    edit = withFolderTrusted(readFileSync(target, "utf8"), claudeConfigProjectKey(dir));
  } catch {
    return "failed";
  }
  if (edit.outcome !== "write") return edit.outcome === "trusted" ? "trusted" : "failed";
  // Beside the file, so the rename is within one filesystem and therefore atomic.
  const suffix = `${process.pid}.${randomBytes(TEMP_SUFFIX_BYTES).toString("hex")}.mulmoterminal-tmp`;
  const tmp = path.join(path.dirname(target), `${path.basename(target)}.${suffix}`);
  try {
    writeFileSync(tmp, edit.text, { mode });
    // chmod after the write: the mode given to the open is filtered by the umask, this is not.
    chmodSync(tmp, mode);
    renameSync(tmp, target);
    return "written";
  } catch {
    discard(tmp);
    return "failed";
  }
}

/** A marker for one folder: it writes the trust into a config file until a READ finds it there, and
 *  from then on reads that file again only once it has changed — the file runs to a megabyte on a
 *  long-lived install. Changed means a different size or mtime, so a save that dropped the entry
 *  (a user's, or a Claude Code save made from a stale copy) is read and the entry written back. A
 *  write alone is not remembered: Claude Code's own save can land on top of it (see the header). */
export function folderTrustMarker(ensure: (configFile: string, dir: string) => TrustResult = ensureFolderTrusted): (configFile: string, dir: string) => void {
  const trustedVersions = new Map<string, string>();
  return (configFile, dir) => {
    const version = fileVersion(configFile);
    if (version !== null && trustedVersions.get(configFile) === version) return;
    if (ensure(configFile, dir) === "trusted" && version !== null) trustedVersions.set(configFile, version);
  };
}

// Which file (device and inode of the link's target, so a retargeted link is a different file) and
// its size and mtime, which every save moves. Null for a file that cannot be stat'd: never remembered.
const fileVersion = (file: string): string | null => {
  try {
    return fileStamp(statSync(file, { bigint: true }));
  } catch {
    return null;
  }
};

/** Whether `dir` is a folder itself and not a link someone pointed elsewhere: trust written
 *  for a link lands on whatever it resolves to, which is exactly the directory nobody approved.
 *  Only the last component is checked — the state directory above it may legitimately be a link. */
export function isFolderItself(dir: string): boolean {
  try {
    return lstatSync(dir).isDirectory();
  } catch {
    return false;
  }
}

// A temp file that cannot be removed is litter, not a reason to throw out of a spawn.
const discard = (file: string): void => {
  try {
    rmSync(file, { force: true });
  } catch {
    return;
  }
};
