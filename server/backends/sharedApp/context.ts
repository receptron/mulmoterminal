// What every shared-app operation needs before it can decide anything: a signed-in session, the
// declaration in `app.json`, and this repository's shared collections.
//
// It lives in MulmoTerminal rather than in `@mulmoclaude/core` because the OPERATIONS are
// MulmoTerminal's (design D5). What core keeps is the pure half — parsing the declaration,
// deciding what is wrong with it, projecting documents — and every one of those is a function
// that answers "what is correct?" without knowing which operation asked. What is here is the
// other half: which order to write in, and what a half-finished write leaves behind.
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { APP_MANIFEST_FILE, discoverCollections, firestoreHandle, type LoadedCollection } from "@mulmoclaude/core/collection/server";
import { APPS_COLLECTION, parseAuthoredApp, publishProblems, type AuthoredApp } from "@receptron/sharedapp";
import type { PublishStamp } from "@receptron/sharedapp";
import type { CollectionSchema } from "@mulmoclaude/core/collection";
import { isRecord } from "../../../common/isRecord.js";
import { publicInputProblems } from "./publicForm.js";
import { scopedFieldProblems } from "./scopedFields.js";

const execFileAsync = promisify(execFile);

/** The live session, as the operations use it. Named rather than inlined because both halves —
 *  the uid the app document's `owner` is pinned to, and the email the roster is keyed by — are
 *  required, and a session holding one is not a usable one. */
export type SharedAppHandle = NonNullable<ReturnType<typeof firestoreHandle>>;

/** Who and when, resolved once per operation. `dirty` is carried because a commit that does not
 *  describe what was written is worse than no commit — it looks auditable. */
export interface GitStamp {
  commit?: string | undefined;
  dirty?: boolean | undefined;
}

export interface SharedAppOptions {
  /** Proceed although live records fail the schema being written. Never a default: it says "let
   *  everybody the app is for have this anyway", which is a sentence the user has to have said
   *  (design D10). */
  confirm?: boolean | undefined;
  /** Wall clock, injectable so a test can assert an exact document. */
  now?: (() => number) | undefined;
  /** Resolve the commit being written from. Injectable for the same reason, and because a
   *  repository without git is a normal state rather than a failure. */
  resolveCommit?: ((root: string) => Promise<GitStamp>) | undefined;
}

/** Every refusal is a list of lines the author can act on, and `partial` answers the one question
 *  prose cannot be trusted with: did anything reach Firestore before this failed?
 *
 *  Almost every refusal happens before the first write, so a caller that has to infer it will
 *  infer "nothing was written" — which is exactly wrong in the one case that matters. */
export interface SharedAppFailure {
  ok: false;
  problems: string[];
  partial: boolean;
}

/** `git rev-parse HEAD` plus a dirty check, or nothing. A missing git, a repository with no
 *  commits and a non-repository are the same answer here: the stamp is attribution, not a
 *  requirement. */
export async function gitStamp(root: string): Promise<GitStamp> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", root, "rev-parse", "HEAD"]);
    const commit = stdout.trim();
    const { stdout: status } = await execFileAsync("git", ["-C", root, "status", "--porcelain"]);
    return { commit: commit.length > 0 ? commit : undefined, dirty: status.trim().length > 0 };
  } catch {
    return {};
  }
}

/** The shared collections of THIS REPOSITORY, by cid.
 *
 *  `userSkillsDir: null` is a boundary, not a test convenience. A globally installed skill under
 *  `~/.claude/skills` carrying `storage.type: "firestore"` would otherwise pick up whichever
 *  repository's `aid` it happened to be discovered from — and, because a view is HTML, publishing
 *  one is the machine's own skills reaching every member's browser. An app is a REPOSITORY (D1):
 *  its collections are the ones committed beside its `app.json`.
 *
 *  MulmoTerminal binds the engine in explicit-root mode, so the root is passed rather than
 *  defaulted — a forgotten root here would not be a crash but the wrong project. */
export async function sharedCollections(root: string): Promise<LoadedCollection[]> {
  const all = await discoverCollections({ workspaceRoot: root, userSkillsDir: null });
  return all.filter((collection) => collection.appId !== undefined);
}

/** The schemas as the projections want them: sorted, so two runs over the same repository produce
 *  the same documents and a diff of them means something. */
export function schemasOf(collections: readonly LoadedCollection[]): { cid: string; schema: CollectionSchema }[] {
  return collections.map((collection) => ({ cid: collection.slug, schema: collection.schema })).sort(byCid);
}

/** Code-unit order, not `localeCompare`: this is the order Firestore lists document ids in, and
 *  a projection sorted one way against a listing sorted another is a diff that reads as a change. */
function byCid(left: { cid: string }, right: { cid: string }): number {
  if (left.cid === right.cid) return 0;
  return left.cid < right.cid ? -1 : 1;
}

export async function readAuthored(root: string): Promise<{ ok: true; app: AuthoredApp } | { ok: false; problems: string[] }> {
  let raw: string;
  try {
    raw = await readFile(path.join(root, APP_MANIFEST_FILE), "utf-8");
  } catch (err) {
    return { ok: false, problems: [`cannot read ${path.join(root, APP_MANIFEST_FILE)}: ${String(err)}`] };
  }
  return parseAuthoredApp(raw);
}

/** The first address the declaration makes an app-wide owner, or undefined when it names none. */
function ownerFromRoster(app: AuthoredApp): string | undefined {
  return Object.entries(app.members).find(([, roles]) => roles["*"] === "owner")?.[0];
}

/** Everything wrong with the declaration itself, publisher included.
 *
 *  Shared by the gate that runs before a publish and by `check`, which exists to answer "would a
 *  publish be refused?" — two implementations of that question is two answers, and the one `check`
 *  gave was the optimistic one (it missed the `owner` uid mismatch, and said publishable about a
 *  declaration the next publish refused). */
export function declarationProblems(app: AuthoredApp, collections: readonly LoadedCollection[], handle: { email: string; uid: string } | null): string[] {
  const problems = publishProblems(
    app,
    collections.map((collection) => ({ cid: collection.slug, primaryKey: collection.schema.primaryKey })),
    // Signed out, the caller asks as the owner the declaration NAMES — see `checkSharedApp`. An
    // empty address is not neutral here: `publishProblems` asks whether the publisher is an
    // app-wide owner, so it would report a missing owner for every sound declaration.
    handle?.email ?? ownerFromRoster(app) ?? "",
  );
  const schemas = schemasOf(collections);
  problems.push(...publicInputProblems(app, schemas));
  problems.push(...scopedFieldProblems(app, schemas));
  problems.push(...rosterCaseProblems(app, handle?.email));
  if (handle !== null && app.owner !== undefined && app.owner !== handle.uid) {
    // Not fatal on its own — the rules pin `owner` to the EXISTING document on update — but a
    // declaration naming somebody else's uid is either the sample's `<uid>` placeholder or a
    // misunderstanding of what the key is.
    problems.push(
      `app.json declares owner "${app.owner}", which is not your uid (${handle.uid}). ` +
        "`owner` is stamped by the operation that creates the app and carried forward unchanged afterwards — remove it from app.json rather than maintaining it by hand.",
    );
  }
  return problems;
}

/** Roster keys the rules will never match, because of their case.
 *
 *  `email() in a.members` is an exact string comparison and rules have no `lower()`. Firebase puts
 *  a lower-cased address in the token, so `Foo@Example.com` on the roster grants nothing — and the
 *  publish succeeds, the file reads correctly to a human, and the person invited is refused
 *  everything with no error anywhere that names them. Said here rather than repaired, because the
 *  roster is a committed file people edit by hand and rewriting somebody's key is not ours to do.
 *
 *  The signed-in address is exempt whatever its case: it IS what the rules compare against, so a
 *  provider that hands over capitals is right and this check would be wrong. */
function rosterCaseProblems(app: AuthoredApp, signedInAs: string | undefined): string[] {
  return Object.keys(app.members)
    .filter((address) => address !== address.toLowerCase() && address !== signedInAs)
    .map(
      (address) =>
        `app.json puts "${address}" on the roster, and the rules compare an address exactly — they match a signed-in ` +
        `"${address.toLowerCase()}" against nothing. Write it in lower case.`,
    );
}

export interface SharedAppContext {
  ok: true;
  authored: AuthoredApp;
  collections: LoadedCollection[];
  handle: SharedAppHandle;
}

/** Load and vet everything the three operations share, in one place so they cannot disagree about
 *  what a valid declaration is — the gate that runs before publish has to be the same one that runs
 *  before publish, or `confirm` on the cheap operation becomes a way past the expensive one. */
export async function sharedAppContext(root: string): Promise<SharedAppContext | SharedAppFailure> {
  const handle = firestoreHandle();
  if (!handle) {
    return {
      ok: false,
      partial: false,
      problems: [
        "this needs a signed-in Firestore session: connect remote-host first. Shared-app writes go out as the app's owner, which is an authenticated write, " +
          "and the roster is keyed by your VERIFIED address — an unverified one is not a weaker identity to the rules, it is no identity at all.",
      ],
    };
  }
  const authored = await readAuthored(root);
  if (!authored.ok) return { ...authored, partial: false };

  const collections = await sharedCollections(root);
  const problems = declarationProblems(authored.app, collections, handle);
  if (problems.length > 0) return { ok: false, partial: false, problems };
  return { ok: true, authored: authored.app, collections, handle };
}

/** The app document as it stands, or the refusal — shared by every operation that reads it
 *  for the same two reasons and must report a failed read the same way.
 *
 *  The read decides what the rules care about: whether `owner` is stamped or carried forward, and
 *  which of the other operation's fields survive the replacement. A rejection — permission,
 *  network, quota — has to become the documented result rather than escape as a raw exception,
 *  because a raw one reaches the agent as a tool crash and gets retried rather than reported. It
 *  happens before any write, which is the part the caller most needs told.
 *
 *  It also normalizes "was there an app document?" ONCE, for the projection and the report both.
 *  Two spellings of that question disagree the moment `get` resolves to something that is neither
 *  a record nor null: the projection stamps a fresh `owner` while the reply says "Updated".
 *
 *  `reassurance` stays the operation's own — the two differ in WHY reading again is safe, and one
 *  sentence covering both would have to be vague enough to reassure about neither. */
export async function readCurrentApp(
  handle: SharedAppHandle,
  aid: string,
  what: string,
  reassurance: string,
): Promise<{ ok: true; app: Record<string, unknown> | null } | SharedAppFailure> {
  try {
    const existing = await handle.docs.get(APPS_COLLECTION, aid);
    return { ok: true, app: isRecord(existing) ? existing : null };
  } catch (err) {
    // A REFUSAL is not an answer about the document — it is the absence of one.
    //
    // The read rule resolves the roster out of the document itself, so a document that does not
    // exist makes the expression fail and the read is DENIED: the same answer as somebody else's
    // app. Reported as "no document" so the caller can go on to the only thing that distinguishes
    // them, which is trying to CREATE it; everything else (network, quota) is still a failure.
    if (isRefusal(err)) return { ok: true, app: null };
    return {
      ok: false,
      partial: false,
      problems: [
        `${what} failed while reading the current app document (apps/${aid}): ${err instanceof Error ? err.message : String(err)}`,
        `Nothing was written. ${reassurance}`,
      ],
    };
  }
}

/** A rules REFUSAL, as opposed to a failure to ask.
 *
 *  ONLY `permission-denied`. The SDK reports both refusals and faults as thrown errors and the
 *  `code` is what separates them — but `failed-precondition` is not the rules saying no: it is a
 *  missing index, a stale transaction, a client the backend wants restarted. Reading it as a
 *  refusal is dangerous in both places this predicate is used, and in the same direction:
 *
 *  - the app document would look ABSENT, so a publish would rebuild it from the declaration alone
 *    and drop the `public` block and the held slug — silently unpublishing a live app and
 *    stranding its URL name;
 *  - a slug would look like SOMEBODY ELSE'S, so a numbered alternative would be taken while the
 *    app's own name went on resolving.
 *
 *  An unanswered question must stay unanswered: everything else — `unavailable`,
 *  `deadline-exceeded`, `resource-exhausted`, `failed-precondition`, an offline client — stops the
 *  operation instead. */
export function isRefusal(err: unknown): boolean {
  return isRecord(err) && err.code === "permission-denied";
}

/** Who, when, and from which commit — resolved the same way by both operations.
 *
 *  Sharing the builder is what keeps the two from drifting into stamping different clocks, or
 *  dropping `dirty` on one side: a commit that does not describe what was written is worse than
 *  no commit, because it looks auditable. (The KEY is `publishedAt` whichever operation stamps
 *  it; the publish projection re-reads it as `publishedAt`.) */
export async function stampFor(handle: SharedAppHandle, root: string, opts: SharedAppOptions): Promise<{ stamp: PublishStamp; dirty: boolean }> {
  const source = await (opts.resolveCommit ?? gitStamp)(root);
  return {
    stamp: { uid: handle.uid, email: handle.email, publishedAt: (opts.now ?? Date.now)(), commit: source.commit, dirty: source.dirty },
    dirty: source.dirty === true,
  };
}
