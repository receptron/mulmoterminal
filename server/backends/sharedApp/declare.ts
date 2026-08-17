// Writing the declaration, instead of asking the agent to compose it.
//
// `app.json` is a small file, and every one of its failures found in testing came from the same
// place: the agent had to write it from memory, before anything could check it. It guessed the
// owner's address (the tool knows it), it wrote a `public` block that publish refused for three
// separate reasons, and when a publish failed it edited the file by hand — deleting the `aid` and
// creating a second, orphaned app.
//
// So the things a person actually asks for become operations: start an app, take over a clone of
// somebody else's, check it, invite somebody. What stays out is anything that would make the file
// OURS — it is a committed declaration that people read and edit in a pull request, and it must
// survive being written by hand. Each of these changes only the keys it is about, and `fork` — the
// one that rewrites most of the file — is still writing what the author asked for by name.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { APP_MANIFEST_FILE, firestoreHandle } from "@mulmoclaude/core/collection/server";
import { holdNewName } from "./establish.js";
import { APPS_COLLECTION, parseAuthoredApp, type AuthoredApp } from "@receptron/sharedapp";
import { isRecord } from "../../../common/isRecord.js";
import { declarationProblems, sharedCollections, type SharedAppFailure } from "./context.js";
import { createManifest, newAid, updateManifest } from "./manifestWrite.js";
import { viewFilesReport } from "./publicView.js";
import { strandedApp } from "./recovery.js";
import { scanRecords, type RecordScan } from "./records.js";

/** The roster key that means "every collection". A member's roles map is keyed by cid, with this
 *  as the fallback the rules drop to (`role()` reads `cid` first, then this). */
const APP_WIDE = "*";

/** The roles the rules understand, in the order a person picks from.
 *
 *  The last two are row-scoped in opposite directions: `participant` reads
 *  only the rows it submitted, `assignee` reads every row and writes only the
 *  ones assigned to it (`collections[cid].assigneeField` says which). */
export const APP_ROLE_NAMES = ["owner", "editor", "viewer", "participant", "assignee"] as const;
export type AppRoleName = (typeof APP_ROLE_NAMES)[number];

export interface DeclareSuccess {
  ok: true;
  aid: string;
  /** The signed-in address the declaration now names as owner. */
  owner: string;
  slug?: string | undefined;
}

export type DeclareResult = DeclareSuccess | SharedAppFailure;

/** Start an app in this repository: `app.json` with the SIGNED-IN address as its owner.
 *
 *  The address is the whole reason this is an operation rather than a paragraph of instructions.
 *  It has to match what the rules see (`request.auth.token.email`), the agent cannot read it, and
 *  asking the user invites the one answer that fails at publish — the address they think they are
 *  using. */
export async function initSharedApp(root: string, name: string | undefined, slug: string | undefined): Promise<DeclareResult> {
  // The file first, because "you already have one" is the more useful answer and it does not
  // depend on being connected. The write below is still `wx`, so the guarantee does not rest on
  // this check — two sessions racing still get one app.
  const existing = await readManifest(root);
  if (existing.ok) {
    return {
      ok: false,
      partial: false,
      problems: [
        `${path.join(root, APP_MANIFEST_FILE)} already exists — this repository already declares an app.`,
        "Overwriting it would replace the roster, which is the app's permission list. Edit the file, or use `invite` for one address.",
      ],
    };
  }
  const handle = firestoreHandle();
  if (!handle) {
    return {
      ok: false,
      partial: false,
      problems: [
        "starting an app needs a signed-in session: connect remote-host first.",
        "The declaration names its owner by EMAIL, and it has to be the address this machine is signed in with — guessing it produces an app nobody can publish.",
      ],
    };
  }
  const aid = newAid();
  // The roster, and nothing else — see `reserveApp`. Held as a value because the slug reservation
  // below records the name it took ON this document, and the two must agree byte for byte.
  const reservation = { owner: handle.uid, members: { [handle.email]: { "*": "owner" } }, memberEmails: [handle.email] };
  // Claimed in Firestore BEFORE it is written to disk, and the app is refused if the claim fails.
  //
  // `apps/{aid}` is a shelf every user of the deployment shares, and its `allow create` asks only
  // that you name yourself owner. The aid used to be minted into `app.json` — a file meant to be
  // committed and read in a pull request — while the document stayed absent until the first
  // publish. Anyone who read the file in that window could create the document as themselves, and
  // then it is theirs: the real owner's write becomes an update they are not allowed to make, and
  // nothing can free the id, because a client may never delete an app document. A UUID stops the
  // aid being GUESSED; it was never going to stop it being read.
  //
  // The reservation carries the roster and nothing else — no `public`, no `collections` — so it
  // grants exactly one thing: this address is the owner. Publish's `set` then lands as an update by
  // the same owner, which is what it always was for an app published twice.
  const reserved = await reserveApp(handle, aid, reservation, "init");
  if (reserved) return reserved;

  const manifest: Record<string, unknown> = {
    ...(name === undefined ? {} : { name }),
    ...(slug === undefined ? {} : { slug }),
    aid,
    members: { [handle.email]: { "*": "owner" } },
  };
  const written = await createManifest(root, manifest);
  if (!written.ok) {
    // PARTIAL, because the reservation is already live. It holds no authorization — the roster and
    // nothing else — and the next `init` mints a fresh aid, so this is an unused shelf entry
    // rather than a lockout. But "nothing happened" would be false, and the aid is named here
    // because it is the only place it is ever said: it never reached a file.
    return {
      ok: false,
      partial: true,
      problems: [
        ...written.problems,
        `The app id was already reserved on the server (apps/${aid}) and is owned by this address, but it never reached app.json.`,
        "Fix the write problem and run `init` again — it mints a new id, and the one above is simply left unused. No URL name was reserved, and nothing else was written.",
        ...strandedApp(aid),
      ],
    };
  }
  // THE NAME IS TAKEN NOW, not at publish.
  //
  // An app EXISTS from the moment it is created — that is what makes its records writable and
  // `preview` worth running (`plans/feat-shared-app-no-staging.md`) — and its address should not
  // change out from under everything written about it in between. The reservation resolves for
  // the app's own ROSTER while `published` is false, so `/m/{slug}` works immediately and nobody
  // outside can even see that the name is taken.
  //
  // The cost is stated rather than hidden: `appSlugs` has `allow delete: if false`, so an
  // abandoned app burns a name. That is why the name is the one the AUTHOR wrote and never one
  // this code invents.
  const held = await holdNewName(handle, aid, root, slug, reservation);
  if (!held.ok) return held;
  return { ok: true, aid, owner: handle.email, slug: held.slug ?? slug };
}

/** Take the aid on the shared shelf, as this session, carrying only the roster.
 *
 *  Shaped to satisfy the create rule and nothing more: `owner` is the uid (the rules pin it there
 *  and require it unchanged forever after), `members` is keyed by the address the token carries,
 *  and `memberEmails` mirrors its keys — `membersConsistent()` compares the two as sets and a
 *  missing `memberEmails` is an evaluation error, which denies. */
async function reserveApp(
  handle: { docs: { set: (c: string, id: string, doc: Record<string, unknown>) => Promise<unknown> }; email: string; uid: string },
  aid: string,
  doc: Record<string, unknown>,
  /** Which operation is asking — because the sentence that says how to RETRY differs, and getting
   *  it wrong is worse than saying nothing. After a refused `init` the repository declares no app
   *  and `init` is the retry; after a refused `fork` it still declares the app it was cloned from,
   *  which `init` would look at and refuse. */
  retry: "init" | "fork",
): Promise<SharedAppFailure | null> {
  try {
    await handle.docs.set(APPS_COLLECTION, aid, doc);
    return null;
  } catch (err) {
    return {
      ok: false,
      partial: false,
      problems: [
        `cannot reserve the app (apps/${aid}): ${err instanceof Error ? err.message : String(err)}`,
        retry === "init"
          ? "Nothing was written — this repository still declares no app, and `init` can simply be run again (it mints a new id each time)."
          : "Nothing was written — app.json still declares the app this repository was cloned from, and `fork` can simply be run again (it mints a new id each time). Do not reach for `init`: it refuses a repository that already declares an app, which this one still does.",
        "If this keeps happening, the session may not be signed in with a VERIFIED address: the rules require one to create an app.",
      ],
    };
  }
}

export interface ForkSuccess extends DeclareSuccess {
  /** The URL name the app this was cloned from holds. Reported because it was deliberately NOT
   *  carried, and the author is the one who has to notice that. */
  previousSlug?: string | undefined;
  /** The top-level blocks carried over verbatim, in the order they were written. */
  carried: string[];
}

export type ForkResult = ForkSuccess | SharedAppFailure;

/** Make a CLONE of somebody else's shared app into your own: a new `aid`, a roster of one, and
 *  the same collections.
 *
 *  The operation exists because `init` cannot do it and neither can a person. `init` refuses a
 *  repository that already declares an app — and a clone always does — so the only route was
 *  "delete app.json, then run init", which puts an IRREVERSIBLE step (the delete) in front of
 *  every step that can fail, and takes `collections` and `public` with it. Every recovery from a
 *  half-done fork went through `git show HEAD:app.json`.
 *
 *  What it carries is the answer to "same app, different owner": `collections` and `public` are
 *  the declaration's half of the collection definitions committed beside it, so a fork that
 *  dropped them would be a different app wearing the same schemas. What it does NOT carry is
 *  anything naming the app this was cloned FROM — `aid`, `members`, `slug`, `owner`. Three of
 *  those would be wrong; the fourth (`slug`) would silently be honoured as a wish and come back
 *  as `their-name-2`, which is not a name anybody chose.
 *
 *  It does not touch `.claude/skills/` at all. The schemas ARE what was cloned. */
/** The declaration this repository was cloned WITH — `fork` has to know whose app it is before it
 *  replaces the roster, and a file it cannot read is not an answer to that. */
async function forkSource(root: string): Promise<{ ok: true; app: AuthoredApp } | SharedAppFailure> {
  const raw = await readManifest(root);
  if (!raw.ok) return raw;
  const parsed = parseAuthoredApp(raw.text);
  if (parsed.ok) return { ok: true, app: parsed.app };
  return {
    ok: false,
    partial: false,
    problems: [
      ...parsed.problems,
      "`fork` has to know whose app this is before it replaces the roster, and that is the declaration it just failed to read.",
      "Repair app.json — or, if this repository was never an app, delete it and run `init`.",
    ],
  };
}

export async function forkSharedApp(root: string, name: string | undefined, slug: string | undefined): Promise<ForkResult> {
  const parsed = await forkSource(root);
  if (!parsed.ok) return parsed;

  const handle = firestoreHandle();
  if (!handle) {
    return {
      ok: false,
      partial: false,
      problems: [
        "forking an app needs a signed-in session: connect remote-host first.",
        "The new declaration names its owner by EMAIL, and it has to be the address this machine is signed in with — guessing it produces an app nobody can publish.",
      ],
    };
  }

  // The one refusal that matters. `fork` is the only operation here that overwrites a roster, and
  // run against your OWN app it would not fork anything — it would mint a second aid and leave the
  // first, with every record in it, behind. Nothing on disk would say that had happened.
  if (parsed.app.members[handle.email]?.[APP_WIDE] === "owner") {
    return {
      ok: false,
      partial: false,
      problems: [
        `app.json already names ${handle.email} — the address this session is signed in with — as this app's owner. There is nothing to fork.`,
        `\`fork\` mints a NEW aid and replaces the roster, so running it here would leave apps/${parsed.app.aid} and every record in it behind, reachable only by whoever else is on that roster.`,
        "To change this app, edit app.json (or use `invite` for one address). To start an unrelated one, run `init` in a repository that declares no app.",
      ],
    };
  }

  // Same order as `init`, for the same reason: the id is taken on the shared shelf BEFORE it
  // reaches a file that gets committed and read in a pull request.
  const aid = newAid();
  const reservation = { owner: handle.uid, members: { [handle.email]: { "*": "owner" } }, memberEmails: [handle.email] };
  const reserved = await reserveApp(handle, aid, reservation, "fork");
  if (reserved) return reserved;

  const taken: ForkNotes = { carried: [], previousSlug: undefined };
  // RE-CHECKED under the write lock, against the manifest `updateManifest` re-reads — not against
  // the copy validated above.
  //
  // Everything before this point ran before an awaited network call, and `app.json` is an ordinary
  // committed file: a checkout, a rebase or a person with an editor can replace it while the
  // reservation is in flight. What would then be overwritten is a declaration nothing checked —
  // and the case that matters is the file becoming an app this address DOES own, which is exactly
  // what the guard above exists to refuse. It would have been refused a moment earlier and
  // silently obeyed a moment later.
  const race: { conflict: string | null } = { conflict: null };
  const written = await updateManifest(root, (manifest) => {
    race.conflict = forkConflict(manifest, parsed.app.aid, handle.email);
    return race.conflict === null ? forked(manifest, { aid, owner: handle.email, name, slug }, taken) : null;
  });
  if (race.conflict !== null) return racedFailure(race.conflict, aid);
  if (!written.ok) {
    // PARTIAL for `init`'s reason, and one more: app.json is still the app this was CLONED from,
    // so the repository did not half-become anything. The reservation is an unused shelf entry.
    return {
      ok: false,
      partial: true,
      problems: [
        ...written.problems,
        `The app id was already reserved on the server (apps/${aid}) and is owned by this address, but it never reached app.json — which still declares the app this repository was cloned from.`,
        "Fix the write problem and run `fork` again — it mints a new id, and the one above is simply left unused. No URL name was reserved, and nothing else was written.",
        ...strandedApp(aid),
      ],
    };
  }
  // The name, taken now for `init`'s reason — and here it matters more: a fork starts from a
  // repository whose `slug` named SOMEBODY ELSE's app, so leaving the new one nameless until
  // publish is the state in which the two are easiest to confuse.
  const held = await holdNewName(handle, aid, root, slug, reservation);
  if (!held.ok) return held;
  return { ok: true, aid, owner: handle.email, slug: held.slug ?? slug, previousSlug: taken.previousSlug, carried: taken.carried };
}

/** The refusal for a manifest that changed under the fork. PARTIAL: nothing reached the disk, but
 *  the reservation did — an unused shelf entry rather than a lockout, and named here because this
 *  is the only place it is ever said. */
function racedFailure(conflict: string, aid: string): SharedAppFailure {
  return {
    ok: false,
    partial: true,
    problems: [
      `app.json changed while the new app id was being reserved: ${conflict}`,
      "Nothing was written to disk — the declaration that is there now is untouched, and it is not the one this fork was checked against.",
      `The app id ${aid} was reserved on the server and is owned by this address; it is simply left unused. Look at app.json, and run \`fork\` again if it is still somebody else's app.`,
      ...strandedApp(aid),
    ],
  };
}

/** Why the manifest under the write lock is not the one this fork was checked against, or null
 *  when it is the same app and still somebody else's.
 *
 *  Two questions, and the second is the one with teeth. The aid answers "is this even the same
 *  app" — a different one means the checks above were about a file that is gone. The roster
 *  answers "is it still not mine", which is the refusal this whole operation is built around:
 *  forking your own app mints a second aid and abandons the first with every record in it, and
 *  nothing on disk would say it happened. */
function forkConflict(manifest: Record<string, unknown>, checkedAid: string, email: string): string | null {
  // PARSED here, not just inspected. `updateManifest` establishes only that the new bytes are a
  // JSON object, so without this the replacement's fields would be carried into the new
  // declaration having been checked by nothing — the strict parse `fork` ran at the top was of the
  // OLD file. A replacement with the same aid and a roster that is still not ours would otherwise
  // sail through both questions below and produce an invalid fork, reported as a success.
  const reparsed = parseAuthoredApp(JSON.stringify(manifest));
  if (!reparsed.ok) return `it no longer parses as a declaration — ${reparsed.problems.join("; ")}`;
  if (reparsed.app.aid !== checkedAid) {
    return `it declared ${JSON.stringify(checkedAid)} a moment ago and now declares ${JSON.stringify(reparsed.app.aid)}.`;
  }
  if (reparsed.app.members[email]?.[APP_WIDE] === "owner") {
    return `it now names ${email} — this session's address — as the app's owner, which \`fork\` refuses: there would be nothing to fork, and the fork would abandon that app.`;
  }
  return null;
}

/** What the rewrite reports back about the declaration it replaced: an out-parameter because
 *  `updateManifest`'s mutation returns the new file and nothing else, and both of these are facts
 *  about the OLD one that only the mutation is holding when it runs. */
interface ForkNotes {
  carried: string[];
  previousSlug: string | undefined;
}

/** The declaration a fork replaces the cloned one with, and the note of what did not survive it.
 *
 *  Built from the manifest as it is on disk RIGHT NOW rather than from the copy `fork` parsed:
 *  `updateManifest` re-reads under the write lock, and everything carried comes across VERBATIM so
 *  that whatever the author wrote that the parse does not model comes across too.
 *
 *  Written as "drop these, keep the rest" rather than "keep these" ON PURPOSE. The keys that must
 *  go are the ones naming the app this was cloned FROM, and that list is closed — it cannot grow
 *  without someone here deciding it should. The keys that must stay are every rule-facing setting
 *  `app.json` can hold, and THAT list grows in core: `participantRead` was already there and an
 *  allowlist of `collections` and `public` silently dropped it, which is a fork quietly changing
 *  who may read what. A new authored key added upstream is carried by default now — and it is safe
 *  to carry sight-unseen because `forkConflict` has just parsed THESE bytes with the strict parser,
 *  so nothing can be in this object that core does not already model. It parses them rather than
 *  trusting the parse `fork` ran at the top: that one was of the file as it stood before the
 *  reservation, which is not necessarily the file being rewritten here. The mistake still available to us is a key that should have
 *  gone, which is visible in the result, rather than one that vanished, which is not. */
function forked(
  manifest: Record<string, unknown>,
  wanted: { aid: string; owner: string; name: string | undefined; slug: string | undefined },
  taken: ForkNotes,
): Record<string, unknown> {
  const chosen = wanted.name ?? (typeof manifest.name === "string" ? manifest.name : undefined);
  taken.previousSlug = typeof manifest.slug === "string" ? manifest.slug : undefined;
  const rest = Object.entries(manifest).filter(([key]) => !CLONED_APPS_OWN.has(key));
  taken.carried = rest.map(([key]) => key);
  return {
    ...(chosen === undefined ? {} : { name: chosen }),
    ...(wanted.slug === undefined ? {} : { slug: wanted.slug }),
    aid: wanted.aid,
    members: { [wanted.owner]: { [APP_WIDE]: "owner" } },
    ...Object.fromEntries(rest),
  };
}

/** The keys of `app.json` that name the app a fork was cloned FROM, and so must not survive one.
 *
 *  `aid`, `members` and `owner` are the cloned app's identity, roster and creator — carried, they
 *  would be simply wrong. `slug` is the subtle one: it is not wrong, it is a WISH, and honoured it
 *  comes back as `their-name-2` — a URL derived from somebody else's app name that nobody chose.
 *  `aidEnv` is the per-worktree aid; nothing reads it yet, and it names the same clone. `name` is
 *  here because it is replaced rather than dropped: the author's, or the cloned one carried
 *  forward deliberately. */
const CLONED_APPS_OWN = new Set(["aid", "slug", "owner", "members", "aidEnv", "name"]);

export interface CheckReport {
  ok: true;
  aid: string | undefined;
  collections: string[];
  /** The signed-in address the check ran as, or null when there is no session. */
  checkedAs: string | null;
  /** The address the declaration names as app-wide owner, when it names one. */
  declaredOwner: string | undefined;
  problems: string[];
  /** What the pages it names will probably get wrong, without stopping a publish. See
   *  `viewWarnings`. */
  warnings: string[];
  /** What publish's record scan found in the LIVE records — or, when it did not run, WHY.
   *
   *  A result rather than a nullable scan, because `check` answers in states where the records
   *  cannot be read at all and "the records fit" is not one of them: silence there is read as
   *  "the records are fine", which is exactly the belief this exists to break. And the two ways of
   *  not running want opposite things from the author — one is "connect", the other is "fix
   *  `app.json`" — so a single null would send half of them to the wrong repair. */
  records: RecordScanResult;
}

/** Either the scan, or the reason there is none.
 *
 *  `unparsed-declaration` is not a degenerate `no-session`: a session may well be open, and what is
 *  missing is the file that says which app and which collections to read. */
export type RecordScanResult = { scanned: true; scan: RecordScan } | { scanned: false; why: "no-session" | "unparsed-declaration" };

/** Everything wrong with the declaration and this repository's collections, WITHOUT writing
 *  anything or touching the app.
 *
 *  The gate that used to run only at deploy. An agent that has just written a declaration cannot
 *  otherwise find out whether it is publishable — and in testing it did not: the invalid `public`
 *  block travelled all the way to a live refusal, and by then the agent was editing files to
 *  recover. */
export async function checkSharedApp(root: string): Promise<CheckReport | SharedAppFailure> {
  const raw = await readManifest(root);
  if (!raw.ok) return raw;
  const parsed = parseAuthoredApp(raw.text);
  // Nothing else can be asked of a file that does not parse: it is the file that names the app and
  // the collections, so there is nothing to discover and nothing to read. Said as its own reason
  // rather than folded into the signed-out one — the repair here is the manifest, not the session,
  // and `checkedAs` is the live address so the report does not also claim nobody is signed in.
  if (!parsed.ok)
    return {
      ok: true,
      aid: undefined,
      collections: [],
      checkedAs: firestoreHandle()?.email ?? null,
      declaredOwner: undefined,
      problems: parsed.problems,
      warnings: [],
      records: { scanned: false, why: "unparsed-declaration" },
    };

  const collections = await sharedCollections(root);
  const handle = firestoreHandle();
  // The SAME gate a publish runs, not a second opinion. `check` exists to answer "would a publish be
  // refused?", and a separate implementation of that question answers it differently — this one
  // used to miss the `owner` uid mismatch and call a declaration publishable that publish then
  // refused.
  const problems = declarationProblems(parsed.app, collections, handle);
  // The PAGES too, read from disk. A `path` naming nothing, a page too large, a page written
  // against the host's bridge: each of those refuses a publish, and answering "publishable" without
  // having opened them is the answer this action exists not to give.
  const pages = await viewFilesReport(root, parsed.app);
  // The RECORDS too, when there is a session to read them with. A declaration can be flawless and
  // publish still refuse — the rows already in the app are the other half of its gate, and they are
  // the half an agent cannot see: `putItems` accepts a row whose typed values are the wrong SHAPE
  // (a `datetime` carrying a timezone suffix, a `number` stored as text), and only a read checks
  // that. Seeded in the hundreds, they were found at publish, one regeneration per batch (#1763).
  //
  // Publish's own scan, for the reason `declarationProblems` above is publish's own gate: two
  // implementations of "would this be refused?" answer it differently, and the answer that matters
  // is the one publish gives.
  const records: RecordScanResult = handle === null ? { scanned: false, why: "no-session" } : { scanned: true, scan: await scanRecords(collections, root) };
  return {
    ok: true,
    aid: parsed.app.aid,
    collections: collections.map((collection) => collection.slug),
    checkedAs: handle?.email ?? null,
    declaredOwner: ownerFromRoster(parsed.app),
    problems: [...problems, ...pages.problems],
    warnings: pages.warnings,
    records,
  };
}

/** The first address the declaration makes an app-wide owner, or undefined when it names none.
 *
 *  Used only to ask the offline question as somebody. A declaration with no app-wide owner is a
 *  real problem, and passing an empty address is how `publishProblems` is asked to say so. */
function ownerFromRoster(app: { members: Record<string, Record<string, string>> }): string | undefined {
  return Object.entries(app.members).find(([, roles]) => roles["*"] === "owner")?.[0];
}

export interface InviteSuccess {
  ok: true;
  email: string;
  role: AppRoleName | null;
  cid: string;
}

/** Add, change or remove one address on the roster.
 *
 *  One key, left where it was — the file belongs to the author, and an operation that rewrote it
 *  would be a worse version of editing it by hand. `role: null` removes. */
export async function inviteToSharedApp(root: string, rawEmail: string, role: AppRoleName | null, cid: string): Promise<InviteSuccess | SharedAppFailure> {
  // `assignee` is not an app-wide role, and it is refused HERE rather than left
  // to the publish for the same reason every other refusal in this file is: the
  // write would otherwise succeed, the tool would report the invitation as done,
  // and the author would open `app.json`, find exactly what they asked for, and
  // have nothing to work back from. Which rows are yours is a per-collection
  // question, so the role needs a collection to be about.
  if (role === "assignee" && cid === APP_WIDE) {
    return {
      ok: false,
      partial: false,
      problems: [
        `"assignee" cannot be given for the whole app: which rows belong to a member is declared per collection (\`collections.<cid>.assigneeField\`).`,
        `Name the collection instead — invite ${rawEmail} as assignee with cid "bookings", once for each collection they are responsible for.`,
      ],
    };
  }
  // Lower-cased, because the roster key is compared to `request.auth.token.email` by a rule that
  // has no `lower()`. Firebase hands the token a lower-cased address, so an entry typed
  // `Foo@Example.com` matches nobody — and once published the failure is silent in the worst way:
  // the roster reads correctly to a human, and the person invited is refused everything with no
  // error naming them. Written correctly here; a hand-edited one is stopped by
  // `rosterCaseProblems` before a publish can carry it.
  const email = rawEmail.toLowerCase();
  let written = email;
  let ambiguous: string[] = [];
  let orphaned = false;
  const updated = await updateManifest(root, (manifest) => {
    // A hand edit can leave TWO keys for one person, differing only in case. Whichever this
    // operation picked would be a guess, and the guess is invisible: the other entry keeps its
    // permissions while the tool reports the change as done. So it is refused and named.
    const matches = rosterMatches(manifest, email);
    if (matches.length > 1) {
      ambiguous = matches;
      return null;
    }
    // Which key this operation is ABOUT is decided case-insensitively, before the normalization
    // above can matter. Lower-casing and then looking the key up would make `invite` act on a
    // different entry than the one on the roster: removing `Foo@Example.com` would find nothing,
    // leave it in place, and still report success, and changing its role would add a SECOND entry
    // beside it — two keys for one person, one of which still holds the old permissions.
    written = matches[0] ?? email;
    const next = nextMembers(manifest, written, role, cid);
    if (next === null) return null;
    // An app with no app-wide owner has no publisher: every publish is refused, INCLUDING the one
    // that would put an owner back. The file can still be edited by hand, but this tool must not
    // be the way somebody locks themselves out — removing or demoting an owner is fine once
    // another one exists.
    if (!hasOwner(next)) {
      orphaned = true;
      return null;
    }
    return next;
  });
  if (ambiguous.length > 1) {
    return {
      ok: false,
      partial: false,
      problems: [
        `app.json has more than one roster entry for that address, differing only in case: ${quoted(ambiguous)}.`,
        "Which one carries this person's permissions is not something this tool may guess — changing one and leaving the other is how somebody keeps access they were told they had lost. " +
          "Merge them by hand into the lower-cased key (the one the rules compare against), then run this again.",
      ],
    };
  }
  if (orphaned) {
    return {
      ok: false,
      partial: false,
      problems: [
        `that would leave the app with no owner: ${written} is the only address holding \`"*": "owner"\`.`,
        "An app with no owner cannot be published at all — not even to put an owner back. Add another owner first, then remove this one.",
      ],
    };
  }
  if (!updated.ok) return { ok: false, partial: false, problems: updated.problems };
  return { ok: true, email: written, role, cid };
}

/** Every roster key that is this address, differing at most in case — none, one, or (from a hand
 *  edit) more than one.
 *
 *  The one that exists keeps its spelling rather than being migrated, even a spelling
 *  `rosterCaseProblems` complains about.
 *
 *  An existing entry keeps its spelling rather than being migrated, even a spelling
 *  `rosterCaseProblems` complains about. Two reasons, and the second is the one that bites: the
 *  file belongs to the author and this tool only ever changes the key it is asked about, and an
 *  upper-case key can be CORRECT — it is what the rules compare against when the provider hands
 *  over that address, which is exactly the case `rosterCaseProblems` exempts. Silently lower-casing
 *  it while changing somebody's role would revoke everything that person has. The publish-time check
 *  is where a wrong spelling is reported, and a hand edit is how it gets fixed. */
/** The keys as they will be shown back to the author: quoted, in the order the file has them. */
function quoted(keys: readonly string[]): string {
  return keys.map((key) => JSON.stringify(key)).join(", ");
}

function rosterMatches(manifest: Record<string, unknown>, email: string): string[] {
  const members = isRecord(manifest.members) ? manifest.members : {};
  return Object.keys(members).filter((key) => key.toLowerCase() === email);
}

/** The declaration with one roster entry changed, or null when it already says that.
 *
 *  Built by filtering rather than by deleting keys: the roster is the permission list, and an
 *  entry that half-survives a removal is the failure mode the rules cannot save us from —
 *  `membersConsistent()` would reject the publish, which is the good case, but only after the
 *  operator believed somebody had been removed. */
function nextMembers(manifest: Record<string, unknown>, email: string, role: AppRoleName | null, cid: string): Record<string, unknown> | null {
  const members = isRecord(manifest.members) ? manifest.members : {};
  const current = isRecord(members[email]) ? members[email] : {};
  const kept = Object.entries(current).filter(([key]) => key !== cid);
  const roles = Object.fromEntries(role === null ? kept : [...kept, [cid, role]]);
  const others = Object.entries(members).filter(([key]) => key !== email);
  const nextRoster = Object.fromEntries(Object.keys(roles).length === 0 ? others : [...others, [email, roles]]);
  if (JSON.stringify(nextRoster) === JSON.stringify(members)) return null;
  return { ...manifest, members: nextRoster };
}

/** Does this declaration still name somebody who may publish it? */
function hasOwner(manifest: Record<string, unknown>): boolean {
  const members = isRecord(manifest.members) ? manifest.members : {};
  return Object.values(members).some((roles) => isRecord(roles) && roles["*"] === "owner");
}

async function readManifest(root: string): Promise<{ ok: true; text: string } | SharedAppFailure> {
  const manifestPath = path.join(root, APP_MANIFEST_FILE);
  try {
    return { ok: true, text: await readFile(manifestPath, "utf-8") };
  } catch (err) {
    return {
      ok: false,
      partial: false,
      problems: [`cannot read ${manifestPath}: ${String(err)}`, "This repository does not declare an app yet — start one with `init`."],
    };
  }
}
