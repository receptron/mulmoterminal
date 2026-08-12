// "Would this collection survive a clone?"
//
// A collection created in a git-managed project, pushed and pulled on another machine, must just
// work — nothing it needs may live outside the project directory. Most of that already holds by
// construction: `resolveDataDir` refuses absolute paths, `..` segments and symlinks escaping the
// root, so a schema literally cannot point at a machine-specific location, and the on-disk layout
// (`.claude/skills/<slug>/` + `data/collections/<slug>/items/`) travels whole.
//
// What leaks is enumerable, and every leak is statically detectable — which is the whole reason
// this file is cheap enough to be worth having. See plans/feat-collections-project-root.md §11.
//
// The point is the FAILURE MODE, not tidiness: each of these breaks on the OTHER machine, days
// later, in a way that reads as something else. A git-ignored data directory opens as an empty
// collection, not as "not committed". A user-scope skill silently resolves to whatever that
// machine happens to have. Nothing warns, because from here everything works.
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { storageKindFor, type CollectionStorageKind } from "@mulmoclaude/core/collection";
import { loadCollection } from "@mulmoclaude/core/collection/server";
import type { Express, Request, Response } from "express";
import { errorStatus, resolveProjectRoot, type ProjectScope } from "../infra/project-root.js";
import { isRecord } from "../../common/isRecord.js";
// The wire shape is shared: the Collections pane renders this report and colours by severity, so
// a second copy of the union here is how the two would drift while both keep compiling.
import type { SelfContainmentFinding, SelfContainmentReport } from "../../common/collectionPortability.js";

const run = promisify(execFile);

/** Everything the verdict depends on, separated from how it is discovered — so the rules can be
 *  exercised without a git repo and a workspace on disk, and so each rule reads as one line. */
export interface SelfContainmentFacts {
  source: "user" | "project" | "feed";
  /** Widened from core rather than re-listed: core 3.10.0 added `firestore`, and a local
   *  copy of the union is how this file would stop compiling on the NEXT kind instead of
   *  reporting it. */
  storageKind: CollectionStorageKind;
  hasPrimaryKey: boolean;
  inGitRepo: boolean;
  /** Whether git ignores anything the RECORDS need in order to travel — the external
   *  `dataSource` file, the `storage` backend file, or (for the default file store) the data
   *  directory OR the record files inside it. See `recordPathsOf`.
   *
   *  Null when it could not be established — not a repo, or git is not on PATH. Null is NOT
   *  "fine": it is "unknown", and the check says nothing rather than clearing it. */
  dataDirIgnored: boolean | null;
}

/** The rules, in the order someone should act on them. Pure. */
export function selfContainmentFindings(facts: SelfContainmentFacts): SelfContainmentFinding[] {
  const findings: SelfContainmentFinding[] = [];

  if (facts.source === "user") {
    findings.push({
      code: "user-scope",
      severity: "blocker",
      message:
        "This collection is defined in ~/.claude/skills, which is on this machine and not in the project. A clone gets whatever that machine happens to have there, or nothing. Move the skill into the project's .claude/skills to share it.",
    });
  }

  // A SHARED collection has no records on disk to be ignored: they live in the app's Firestore,
  // and `dataDir` is then only the conventional per-slug directory nothing was ever written to.
  // Asking git about it answers about the wrong place, so a workspace that ignores `data/` would
  // call every shared collection unclonable and every record lost — the one verdict this file
  // exists to keep trustworthy, spent on a collection whose records are exactly what DOES travel.
  if (facts.dataDirIgnored === true && facts.storageKind !== "firestore") {
    // A FEED's records are a CACHE, and that changes the verdict rather than the fact. They are
    // re-fetched from the source the clone can reach too, so "the records do not travel" costs a
    // refresh, not the data — while for a collection the records ARE the data and nothing brings
    // them back.
    //
    // This is not a hypothetical distinction: the managed workspace ignores `feeds/` on purpose,
    // so the first run of this check over a real workspace reported three feed collections as
    // unclonable. A blocker nobody can act on is how a check stops being read.
    const feed = facts.source === "feed";
    findings.push({
      code: "data-ignored",
      severity: feed ? "warning" : "blocker",
      message: feed
        ? "The records are excluded by .gitignore, so a clone starts with none. For a feed that costs a refresh rather than the data — they are re-fetched from the source — but the first open shows an empty list."
        : "The data directory is excluded by .gitignore, so the schema is committed and every record is not. A clone opens the collection and sees zero rows, which reads as an empty collection rather than as missing data.",
    });
  }

  if (facts.storageKind === "sqlite" && facts.inGitRepo) {
    findings.push({
      code: "sqlite-store",
      severity: "blocker",
      message:
        "Records are stored in one SQLite file. Git cannot merge a binary file, so two machines editing this collection offline produce a conflict nobody can resolve — where the default one-file-per-record storage merges cleanly.",
    });
  }

  if (facts.storageKind === "firestore") {
    // Not a defect: a shared collection's records are SUPPOSED to live in the app's
    // Firestore, which is exactly what lets two people work on the same data. But it
    // answers the question this report asks — "what does a clone get?" — differently
    // from every other kind, and silence would read as "the records travel".
    findings.push({
      code: "shared-store",
      severity: "info",
      message:
        "This is a shared collection: the schema is committed and the records live in the app's Firestore. A clone brings the definition and reaches the same records once its user is on the app's roster — nobody gets a private copy, which is the point.",
    });
  }

  if (facts.storageKind === "csv") {
    findings.push({
      code: "csv-runtime",
      severity: "warning",
      message: "Records are rows of a CSV, queried through DuckDB. The file itself travels with the project, but the clone needs that runtime too.",
    });
  }

  if (!facts.hasPrimaryKey && facts.inGitRepo) {
    findings.push({
      code: "no-primary-key",
      severity: "warning",
      message:
        "No primaryKey is declared, so record ids are 4 random bytes. Two machines creating records offline can mint the same id; declaring a primaryKey derives the id from the record instead, which turns a silent collision into an obvious git conflict.",
    });
  }

  if (!facts.inGitRepo) {
    findings.push({
      code: "not-a-repo",
      severity: "info",
      message: "This project is not a git repository, so there is nothing to clone yet. The checks that depend on git were not run.",
    });
  }

  return findings;
}

/** A blocker is what stops the clone working; warnings and info do not. */
export function isPortable(findings: readonly SelfContainmentFinding[]): boolean {
  return !findings.some((finding) => finding.severity === "blocker");
}

/** Whether `root` is inside a git work tree. False for "not a repo" AND for "git is not
 *  installed" — from this check's point of view the two are the same answer: the git-dependent
 *  rules cannot run. */
async function inGitRepo(root: string): Promise<boolean> {
  try {
    const { stdout } = await run("git", ["rev-parse", "--is-inside-work-tree"], { cwd: root, timeout: 5_000 });
    return stdout.trim() === "true";
  } catch {
    return false;
  }
}

/** Whether git would ignore ANY of `targets`. Asks GIT rather than parsing `.gitignore`
 *  ourselves: the rule that matters may come from a parent directory, from `.git/info/exclude`,
 *  or from the user's global ignore file, and a hand-rolled parser would clear a collection that
 *  is in fact ignored. Works on paths that do not exist yet, which the data dir often does not.
 *
 *  ANY, not all: one ignored record file is already a record that does not travel.
 *
 *  `--no-index` REPORTS THE RULE, not the current tracking state. Without it, a path that is
 *  already tracked reads as "not ignored" even with a matching rule — true for the files already
 *  committed, and misleading about every record written from now on, which is the failure this
 *  check exists to catch.
 *
 *  `check-ignore` exits 0 when at least one path matched, 1 when none did, and >1 for an error —
 *  and execFile rejects on any non-zero, so the exit code is read off the error rather than the
 *  resolution. */
async function anyGitIgnored(root: string, targets: readonly string[]): Promise<boolean | null> {
  if (targets.length === 0) return false;
  try {
    // No `-q`: git refuses it for more than one pathname ("--quiet is only valid with a single
    // pathname"), which is a code-128 rejection and would read here as UNKNOWN for every
    // multi-path collection. The matched paths go to stdout and are ignored; the exit code is
    // the answer.
    await run("git", ["check-ignore", "--no-index", "--", ...targets], { cwd: root, timeout: 5_000 });
    return true;
  } catch (err) {
    if (isRecord(err) && err.code === 1) return false;
    // Anything else (git missing, a broken repo) is UNKNOWN, not "not ignored".
    return null;
  }
}

/** A name that stands in for a record when the collection has none on disk yet. Any `.json` under
 *  the data dir would do; a fixed one keeps the question reproducible. */
const RECORD_PROBE = "__portability_probe__.json";

/** The paths to ask about DIRECTLY: the container the records live in or under, plus one probe
 *  path standing in for a record that does not exist yet.
 *
 *  A `dataSource` collection's rows live in the external file and a `storage` collection's in its
 *  backend file — `dataDir` is then only the conventional per-slug directory, and asking about it
 *  answers about a folder the records were never in. A `*.csv` or `*.db` line would go
 *  unreported.
 *
 *  For the default file store the probe is what catches a pattern rule (`*.json`, `items/*`)
 *  BEFORE any record exists — which is exactly when it matters, since nothing is committed yet
 *  and there is no missing file to notice. Existing records are covered separately and
 *  exhaustively by `hasIgnoredContent`. */
function directIgnoreTargets(collection: { dataDir: string; dataSourceFile?: string; storageFile?: string }): string[] {
  if (collection.dataSourceFile) return [path.resolve(collection.dataSourceFile)];
  if (collection.storageFile) return [path.resolve(collection.storageFile)];
  const dataDir = path.resolve(collection.dataDir);
  return [dataDir, path.join(dataDir, RECORD_PROBE)];
}

/** Whether git ignores ANYTHING that exists under `dataDir` — asked of git over ALL of them
 *  rather than a sample, because "some records travel" is not the guarantee being checked.
 *
 *  `ls-files --others --ignored` rather than a per-file `check-ignore`: one call, no argv limit,
 *  and no cap to leak past. A collection with thousands of records is ordinary, and sampling the
 *  first few would clear a specifically-ignored record simply for sorting late.
 *
 *  It reports UNTRACKED files only, and that is the right half: a record already committed
 *  travels whatever a rule says about it. What this catches is everything that would not. */
async function hasIgnoredContent(root: string, dataDir: string): Promise<boolean | null> {
  try {
    const { stdout } = await run("git", ["ls-files", "--others", "--ignored", "--exclude-standard", "--", dataDir], {
      cwd: root,
      timeout: 5_000,
      maxBuffer: 1_000_000,
    });
    return stdout.trim().length > 0;
  } catch (err) {
    // Output that overflowed the buffer IS the answer — a great many ignored files — not a
    // failure to ask. Anything else stays unknown.
    if (isRecord(err) && typeof err.stdout === "string" && err.stdout.trim().length > 0) return true;
    return null;
  }
}

/** Combine partial answers: an ignored path anywhere decides it, an unknown leaves it unknown,
 *  and only "nothing ignored, nothing unknown" clears the collection. Written out because the
 *  three-valued `||` is exactly the thing a later edit collapses into a two-valued one. */
function anyIgnored(...answers: readonly (boolean | null)[]): boolean | null {
  if (answers.includes(true)) return true;
  if (answers.includes(null)) return null;
  return false;
}

/** Gather the facts for one collection. Exported so a caller can run the rules over facts it
 *  already holds. */
export async function selfContainmentFactsFor(slug: string, scope: ProjectScope): Promise<SelfContainmentFacts | null> {
  const collection = await loadCollection(slug, scope);
  if (!collection) return null;
  const git = await inGitRepo(scope.workspaceRoot);
  return {
    source: collection.source,
    storageKind: storageKindFor(collection.schema),
    hasPrimaryKey: typeof collection.schema.primaryKey === "string" && collection.schema.primaryKey.length > 0,
    inGitRepo: git,
    // Only meaningful inside a repo; outside one, `check-ignore` answers about a repo that is
    // not the one this collection would be cloned from.
    dataDirIgnored: git ? await ignoreVerdict(scope.workspaceRoot, collection) : null,
  };
}

/** The route handler, HERE rather than in collections.ts: that file is already at its line
 *  budget, and a handler this thin next to the rules it reports keeps both readable.
 *
 *  A GET rather than something computed at creation time — the answer changes without the
 *  collection changing (a `.gitignore` line lands, `git init` runs, the skill is moved into the
 *  project), so it has to be asked when someone wants to know.
 *
 *  MulmoTerminal's own route: MulmoClaude has no counterpart to match, being single-root. */
async function respondSelfContainment(req: Request<{ slug: string }>, res: Response): Promise<void> {
  const report = await checkCollectionSelfContainment(req.params.slug, resolveProjectRoot(req));
  if (!report) {
    res.status(404).json({ error: `collection '${req.params.slug}' not found` });
    return;
  }
  res.json(report);
}

/** Mounts its own route, beside the other collection mounts in app-routes.ts, rather than being
 *  registered from collections.ts — that file sits at its line budget, and a feature that owns
 *  one route has no reason to spend a line there. A spec that exercises this route has to mount
 *  it too (collectionsProjectScope.spec.ts). */
export function mountSelfContainmentRoutes(app: Express): void {
  app.get("/api/collections/:slug/self-containment", (req, res) => {
    // The same guard the collection routes use: a request naming a project this server cannot
    // serve is a CLIENT error, and answering 500 would read as "the server broke" for a typo.
    void (async () => {
      try {
        await respondSelfContainment(req, res);
      } catch (err) {
        res.status(errorStatus(err)).json({ error: err instanceof Error ? err.message : String(err) });
      }
    })();
  });
}

/** Would anything the records need be left behind: the container, a pattern that would catch a
 *  record not yet written, or any record already on disk. */
async function ignoreVerdict(root: string, collection: { dataDir: string; dataSourceFile?: string; storageFile?: string }): Promise<boolean | null> {
  const direct = await anyGitIgnored(root, directIgnoreTargets(collection));
  // The content sweep only applies to the file store — the other two keep their records in the
  // single file already asked about above.
  if (collection.dataSourceFile || collection.storageFile) return direct;
  return anyIgnored(direct, await hasIgnoredContent(root, path.resolve(collection.dataDir)));
}

/** The full check for one collection, or null when the slug names none. */
export async function checkCollectionSelfContainment(slug: string, scope: ProjectScope): Promise<SelfContainmentReport | null> {
  const facts = await selfContainmentFactsFor(slug, scope);
  if (!facts) return null;
  const findings = selfContainmentFindings(facts);
  return { slug, portable: isPortable(findings), findings };
}
