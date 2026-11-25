// Editing `app.json` — the one file in a shared app that both a person and this server write.
//
// Everything here exists because of that shared ownership. The file holds the roster and the
// public settings; the author edits it by hand and commits it; and two of MulmoTerminal's own
// steps have to change one key in it (the generated `aid`, and the URL slug that was actually
// reserved). So a write here is never "produce the file" — it is "change one key of the file
// somebody else is keeping", which is why it reads, mutates, and replaces rather than rendering.
//
// Three properties are load-bearing, and each was a review finding before it was a rule:
//
//   - **atomic.** `writeFile` truncates first, so a failure part-way leaves a half-written
//     declaration — and nothing here could put back the roster it destroyed. Write beside it and
//     rename; a reader sees the old file or the new one.
//   - **the author's file, not ours.** The mode is preserved (a manifest kept at 0600 must not
//     come back 0644), a symlink is followed to the file it points at rather than replaced, and
//     every key the author wrote is carried through untouched.
//   - **one writer at a time.** Read-mutate-write is three steps; two callers interleaving them
//     both see the old file and one write is lost. Serialized on the RESOLVED path, because two
//     spellings of one root are one file.
import { chmod, readFile, realpath, rename, stat, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { APP_MANIFEST_FILE } from "@mulmoclaude/core/collection/server";
import { isRecord } from "../../../common/isRecord.js";
import { serializeBy } from "./serialize.js";
import { fileStamp } from "../../files/fileStamp.js";

export type ManifestFailure = { ok: false; problems: string[] };

/** What a caller does with the declaration it was handed: a replacement object, or `null` for
 *  "nothing to change" — which writes nothing at all rather than rewriting identical bytes. */
export type ManifestMutation = (manifest: Record<string, unknown>) => Record<string, unknown> | null;

export type ManifestUpdate = { ok: true; manifest: Record<string, unknown>; written: boolean } | ManifestFailure;

/** The key two callers must AGREE on to be serialized against each other: one file, one key.
 *
 *  Exported because a whole shared-app OPERATION serializes on the same repository — one publish
 *  landing inside a publish is the same class of interleaving as two writes to `app.json`, and
 *  keying them differently would leave each holding a lock the other does not.
 *
 *  The caller's spelling will not do. A root arrives as the session's cwd, which is taken
 *  verbatim — so one cell opened at a symlink and another at the path it points to name the same
 *  `app.json` in two ways, and two spellings are two chains: exactly the interleaving the
 *  serializer exists to prevent, with the lock quietly not held.
 *
 *  When `realpath` fails — the root does not exist — `resolve` is enough: the read is about to
 *  fail anyway, and a key that cannot be canonicalised must still not collide with another
 *  root's. */
export async function manifestKey(root: string): Promise<string> {
  try {
    return path.join(await realpath(root), APP_MANIFEST_FILE);
  } catch {
    return path.join(path.resolve(root), APP_MANIFEST_FILE);
  }
}

/** Read `<root>/app.json`, hand it to `mutate`, and replace it with the result.
 *
 *  It does NOT create `app.json`. A missing one means this directory is not a shared app at all,
 *  and writing a bare object would turn a mistyped path into an app declaration. */
export function updateManifest(root: string, mutate: ManifestMutation): Promise<ManifestUpdate> {
  return manifestKey(root).then((key) => serializeBy(`manifest:${key}`, () => updateOnce(root, mutate)));
}

async function updateOnce(root: string, mutate: ManifestMutation): Promise<ManifestUpdate> {
  const manifestPath = path.join(root, APP_MANIFEST_FILE);
  let raw: string;
  // Stamped from the RESOLVED file, beside the read, so the comparison before the rename is about
  // the same inode `replaceManifest` is going to replace rather than about a symlink.
  let read: string | null;
  try {
    raw = await readFile(manifestPath, "utf-8");
    read = await stampAt(manifestPath);
  } catch (err) {
    return {
      ok: false,
      problems: [
        `cannot read ${manifestPath}: ${String(err)}`,
        "A shared app is a repository with an app.json at its root. Write one first — this step only fills in what it can.",
      ],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { ok: false, problems: [`${manifestPath} is not valid JSON: ${String(err)}`] };
  }
  if (!isRecord(parsed)) {
    return { ok: false, problems: [`${manifestPath} must contain a JSON object.`] };
  }

  const updated = mutate(parsed);
  if (updated === null) return { ok: true, manifest: parsed, written: false };

  const failure = await replaceManifest(manifestPath, updated, read);
  return failure ?? { ok: true, manifest: updated, written: true };
}

/** What the file was when this update READ it. Re-checked against the file as it stands the
 *  instant before the rename: `updateManifest` serializes callers inside THIS process and nothing
 *  more, and `app.json` is a committed file — a checkout, a rebase or an editor can replace it
 *  while a mutation is deciding what to write, and the rename would then land on bytes nobody
 *  validated. For `fork`, whose whole refusal is "this is not your app", those bytes could be an
 *  app that IS yours.
 *
 *  This NARROWS the window; it does not close it. POSIX has no compare-and-rename, so what remains
 *  is the gap between the last `stat` and the `rename` — microseconds, against the seconds an
 *  awaited network call leaves open. Said plainly rather than described as a lock, because the
 *  next person to need a guarantee here needs to know which one they are getting.
 *
 *  The stamp is of the file a path RESOLVES to, or null when it cannot be taken — a stamp that could
 *  not be read is not a mismatch, and must not turn every write into a refusal. */
async function stampAt(manifestPath: string): Promise<string | null> {
  try {
    return fileStamp(await stat(await realpath(manifestPath), { bigint: true }));
  } catch {
    return null;
  }
}

/** Replace the file, or say why not. Returns null when it landed. */
async function replaceManifest(manifestPath: string, manifest: Record<string, unknown>, read: string | null): Promise<ManifestFailure | null> {
  // Two spaces and a trailing newline: this file is committed and edited by hand, so it is
  // written the way the author would have.
  const body = `${JSON.stringify(manifest, null, 2)}\n`;
  // Beside the RESOLVED file, not beside the name we were given. `readFile` follows a symlink;
  // `rename` replaces one. A manifest linked to a shared declaration would otherwise be read
  // through the link and then have the link overwritten by a detached copy — the target never
  // gets the change, and the next reader of the target is looking at a different app.
  //
  // Same directory on purpose: a rename across filesystems is a copy, and the temp directory is
  // routinely on another one.
  const target = await realpath(manifestPath).catch(() => manifestPath);
  const scratch = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.tmp`);
  try {
    await writeFile(scratch, body, "utf-8");
    // ONE stat, used for both questions, and taken as late as possible: the mode to carry over,
    // and whether this is still the file the mutation was decided against.
    const now = await stat(target, { bigint: true });
    if (read !== null && read !== fileStamp(now)) {
      await unlink(scratch).catch(() => {});
      return {
        ok: false,
        problems: [
          `${manifestPath} changed on disk while this was being written — something outside this server replaced it.`,
          "Nothing was written: the file that is there now was not the one this change was checked against, and overwriting it would discard whatever wrote it.",
          "Look at app.json, and run the operation again.",
        ],
      };
    }
    // The replacement is a NEW file, so it carries this process's umask rather than the mode the
    // author gave `app.json`. Carrying the declaration through unchanged has to include that.
    await chmod(scratch, Number(now.mode));
    await rename(scratch, target);
    return null;
  } catch (err) {
    // Best effort: the scratch file is only litter, and the failure being reported is the one
    // worth reporting.
    await unlink(scratch).catch(() => {});
    return {
      ok: false,
      problems: [`cannot write ${manifestPath}: ${String(err)}`, "Nothing else was changed — the declaration is as it was."],
    };
  }
}

/** Write `app.json` for a repository that does not have one.
 *
 *  Separate from `updateManifest` because the two must not be one call: updating REFUSES to create
 *  (a mistyped path would become an app declaration), and creating must refuse to overwrite (an
 *  existing declaration holds the roster, and re-writing it would revoke everybody silently).
 *
 *  `wx` is what makes the refusal atomic rather than a check followed by a write — two sessions
 *  asked to start the same app cannot both see it missing. It is written directly rather than
 *  through the rename dance for the same reason: there is no file to protect, and `wx` on the real
 *  path IS the protection. */
export async function createManifest(root: string, manifest: Record<string, unknown>): Promise<ManifestUpdate> {
  const manifestPath = path.join(root, APP_MANIFEST_FILE);
  return serializeBy(`manifest:${await manifestKey(root)}`, async () => {
    try {
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf-8", flag: "wx" });
      return { ok: true, manifest, written: true };
    } catch (err) {
      if (isRecord(err) && err.code === "EEXIST") {
        return { ok: false, problems: [`${manifestPath} already exists — this repository already declares an app.`] };
      }
      return { ok: false, problems: [`cannot write ${manifestPath}: ${String(err)}`] };
    }
  });
}

/** The `aid` a new declaration gets. Generated here, by code, for the reason D2b gives: `apps/{aid}`
 *  is a shelf every user of the deployment shares, a memorable id there is first-come-first-served,
 *  and a model asked to invent an identifier writes a memorable one. */
export const newAid = (): string => randomUUID();
