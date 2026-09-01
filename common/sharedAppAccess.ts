// WHO CAN SEE WHAT, per collection of a shared app — read off the two documents the Firestore
// rules actually read, and nothing else.
//
// The question this answers is the author's, and it is asked about strangers: "the person who has
// not signed in, and the person who signed in but was never invited — what of mine can they
// reach?" That is not answerable from `app.json` by reading it, because the answer is spread over
// `public.enabled`, `public.read`, `public.submit[cid].auth`, `participantRead`, `peerVisibility`
// and the roster, and any two of them can disagree.
//
// So this is a TRANSCRIPTION of the rules, not a second opinion about them. Every branch below
// names the predicate in `../../mulmoserver/firestore.rules` it mirrors, and the inputs are the
// projected documents (`apps/{aid}` and its `public` block) rather than the authored manifest —
// the same pair `app(aid)` hands every rule. A summary computed from the manifest would be a
// third reading of the declaration, and the one that is wrong is always the one nobody deploys.
//
// It is a REPORT. Nothing here authorizes anything: the rules do, on the server, and an app whose
// rules say otherwise is right and this is wrong. That is the point of stating it — a difference
// between this panel and production is a bug worth finding, and it can only be found if the panel
// commits to an answer.
import { byCodeUnit } from "./byCodeUnit.js";
import { isRecord } from "./isRecord.js";
import { publicFaceOf, type PublicFace } from "./sharedAppPublicFace.js";

/** The four people an author is deciding about. Two of them are the ones this panel exists for.
 *
 *  `visitor` is the person on the public page with no Google account. Firebase gives them an
 *  ANONYMOUS session there, so `authed()` is true for them and `verified()` is not — which is what
 *  makes them different from `stranger` rather than simply weaker, and why a `uidField` binding
 *  reaches them while an `emailField` one cannot.
 *
 *  `stranger` is any Google account in the world that was never invited. The aid and the cid are
 *  both readable from `config/public`, so "they would have to know the ids" is not a barrier and
 *  is deliberately not modelled as one.
 *
 *  `participant` holds the literal `participant` role on the roster; `writer` holds `owner` or
 *  `editor` on this collection. `viewer` and `assignee` are neither — they read like a writer and
 *  write like nobody, which the census beside the table reports rather than the table. */
export type AccessSubject = "visitor" | "stranger" | "participant" | "writer";

export const ACCESS_SUBJECTS: readonly AccessSubject[] = ["visitor", "stranger", "participant", "writer"];

/** How much of the collection this subject may READ. `own` is `ownRow` — the rows the subject
 *  themselves submitted, reached through the declared identity binding and no other. */
export type ReadAccess = "none" | "own" | "all";

export interface SubjectAccess {
  read: ReadAccess;
  /** May bring a NEW record into this collection. */
  create: boolean;
  /** May change or withdraw the records that are theirs (`selfUpdate` / `selfTransitions` /
   *  `selfDelete`), which is a different permission from `editAll` and never implies it. */
  editOwn: boolean;
  /** May change or delete ANY record here. */
  editAll: boolean;
  /** `mirrorRepair` — this collection is the PUBLIC PROJECTION of records nobody outside may read
   *  (`mirrorOf`), and the rules let ANYONE write its `state` field back to the truth. Not even
   *  `authed()`: a stale grid repairing itself is the whole point of the rule.
   *
   *  A flag of its own rather than folded into `editAll`, because it is neither nothing nor a
   *  general write — one field, to one value, that cannot be a lie. Its own flag is what stops the
   *  table saying "Nothing" about a collection every visitor may write to. */
  repairMirror: boolean;
}

/** How many roster addresses hold each kind of role ON THIS COLLECTION.
 *
 *  Beside the table because the table's `participant` and `writer` columns describe a permission
 *  that may belong to nobody: an app can declare `audience: "participant"` and have no
 *  participants, and the column would then read as an exposure that does not exist. */
export interface RoleCensus {
  writers: number;
  /** `viewer` and `assignee` — they read everything here and the table does not have a column for
   *  them, so they are counted where they cannot be missed. */
  readers: number;
  participants: number;
}

export interface CollectionAccess {
  cid: string;
  /** Does this collection take submissions at all — `subOpen` in the rules. A collection with no
   *  `public.submit` entry has no self-service path in or out for anybody, whatever the switch
   *  says, and that is worth saying plainly rather than leaving as four empty cells. */
  takesSubmissions: boolean;
  /** The auth stage `public.submit[cid].auth` declares, or `none`. */
  authStage: "none" | "anonymous" | "verifiedEmail";
  census: RoleCensus;
  /** Conditions this summary cannot answer, in the author's words — a submission window, a
   *  session gate, a staged reveal. Each one can only NARROW what the table says. */
  caveats: string[];
  access: Record<AccessSubject, SubjectAccess>;
}

export interface SharedAppAccess {
  publicFace: PublicFace;
  collections: CollectionAccess[];
  /** Roster addresses the rules will never match, because they are not lower case — see
   *  `unmatchable`. App-wide rather than per collection, because the roster is.
   *
   *  Reported rather than silently dropped from the census: an author whose `Owner / editor` count
   *  reads `(0)` is owed the reason, and this one is invisible in a file that reads correctly to a
   *  human. */
  unmatchableRoster: string[];
}

const asRecord = (value: unknown): Record<string, unknown> | undefined => (isRecord(value) ? value : undefined);
const asStrings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []);
const flagOn = (block: Record<string, unknown>, key: string): boolean => block[key] === true;

/** The role this address resolves to for this cid — `role(a, cid)` in the rules, including its
 *  `'*'` fallback and its `null` for a member scoped elsewhere. */
function roleFor(roles: Record<string, unknown>, cid: string): string | null {
  const scoped = roles[cid];
  if (typeof scoped === "string") return scoped;
  const fallback = roles["*"];
  return typeof fallback === "string" ? fallback : null;
}

/** Roster keys the rules can never match, because of their case.
 *
 *  `email() in a.members` is an exact string comparison and rules have no `lower()`; Firebase puts
 *  a lower-cased address in the token. So `Foo@Example.com` on the roster grants that person
 *  nothing at all — the same defect `rosterCaseProblems` reports at publish time, and this route
 *  deliberately answers even for a declaration a publish would refuse. */
const unmatchable = (address: string): boolean => address !== address.toLowerCase();

function censusOf(members: Record<string, unknown>, cid: string): RoleCensus {
  const census: RoleCensus = { writers: 0, readers: 0, participants: 0 };
  for (const [address, roles] of Object.entries(members)) {
    // NOT COUNTED, rather than counted with a warning beside them: the count is what the row says
    // about who holds this permission, and a key the rules cannot match holds none of it. Counting
    // it printed `Owner / editor (1)` over an app whose owner is locked out of their own roster.
    if (unmatchable(address)) continue;
    if (!isRecord(roles)) continue;
    const role = roleFor(roles, cid);
    if (role === "owner" || role === "editor") census.writers += 1;
    else if (role === "viewer" || role === "assignee") census.readers += 1;
    else if (role === "participant") census.participants += 1;
  }
  return census;
}

/** What the subject brings to `request.auth`. `listed` is `listedIn(a)`; `role` is what `role(a,
 *  cid)` would answer for them. */
interface Principal {
  verified: boolean;
  listed: boolean;
  role: "participant" | "writer" | null;
}

const PRINCIPALS: Record<AccessSubject, Principal> = {
  // Anonymous session: authed, never verified. See the note on `AccessSubject`.
  visitor: { verified: false, listed: false, role: null },
  stranger: { verified: true, listed: false, role: null },
  participant: { verified: true, listed: true, role: "participant" },
  writer: { verified: true, listed: true, role: "writer" },
};

/** The two principals `caveatsOf` asks about — the same pair the panel colours. */
const OUTSIDER_PRINCIPALS: readonly Principal[] = [PRINCIPALS.visitor, PRINCIPALS.stranger];

/** One collection's declaration, read once so the four subjects cannot be answered from four
 *  different readings of it. */
interface Declared {
  /** `col(a, cid)` — the collection's rule configuration on the app document. */
  c: Record<string, unknown>;
  /** `sub(a, cid)`, and `undefined` where `subOpen` is false. */
  s: Record<string, unknown> | undefined;
  publicOn: boolean;
  publicRead: boolean;
  partRead: boolean;
  /** The clock `inWindow` is judged against — threaded in rather than read here so the summary
   *  stays a pure function of its inputs and a spec can pin a closed window without waiting. */
  now: number;
}

/** `ownRow` — can THIS subject be bound to a row here at all?
 *
 *  The bindings are the rules': the two `auth.uid` id strategies and `uidField` need only
 *  `authed()`, so the anonymous visitor reaches them; `emailField` compares `email()` and so needs
 *  `verified()`. Every one of them requires `subOpen` first, which is why a collection with no
 *  submit declaration gives nobody an own row however they signed in. */
function ownRowReachable(declared: Declared, who: Principal): boolean {
  const { s } = declared;
  if (s === undefined) return false;
  const uidBound = s.idFrom === "auth.uid" || s.idFrom === "auth.uid+field" || typeof s.uidField === "string";
  const emailBound = typeof s.emailField === "string";
  return uidBound || (who.verified && emailBound);
}

/** `authOk(s)` for this subject. */
function authOk(stage: CollectionAccess["authStage"], who: Principal): boolean {
  if (stage === "verifiedEmail") return who.verified;
  // Both `none` and `anonymous` are satisfied by the anonymous session every public page holds.
  return true;
}

/** `inWindow(s, aid)`, evaluated against a clock.
 *
 *  Evaluated rather than merely mentioned, because a CLOSED window is how the sample apps seal a
 *  board: `apps/roles` declares `window.until` in the year 2000 on all three of its collections, so
 *  a summary that only said "there is a window" reported an open door on an app nobody can post to.
 *  The rules compare `request.time`, so this is the same answer they give — at the moment it is
 *  asked, which is what makes the panel worth re-opening rather than a fact about the file.
 *
 *  `perRecord` is the half that cannot be answered from here: `fromField` / `untilField` put the
 *  bound on ANOTHER record. It is reported as its own state so the caveat can say so instead of
 *  the table quietly picking one of the two answers. */
function windowState(submit: Record<string, unknown>, now: number): "none" | "open" | "closed" | "early" | "perRecord" {
  const window = asRecord(submit.window);
  if (window === undefined) return "none";
  if (typeof window.fromMs === "number" && now < window.fromMs) return "early";
  if (typeof window.untilMs === "number" && now >= window.untilMs) return "closed";
  if (window.fromField !== undefined || window.untilField !== undefined) return "perRecord";
  return "open";
}

/** Only the two states that are DECIDED and shut. `none` is a collection with no window at all,
 *  and `perRecord` is a bound this summary cannot read — refusing on either would report a closed
 *  door on most of the apps there are. */
function windowOpen(submit: Record<string, unknown>, now: number): boolean {
  const state = windowState(submit, now);
  return state !== "closed" && state !== "early";
}

/** `submitCreate` minus the parts that depend on the record and the clock.
 *
 *  The first conjunct is the one #1926 was about and the one this whole panel is for: a
 *  `public.submit` declaration is not a statement that the app is open, so the gate is the SWITCH
 *  or the ROSTER, never the declaration's existence. */
function canCreate(declared: Declared, stage: CollectionAccess["authStage"], who: Principal, ignoreWindow = false): boolean {
  const { s } = declared;
  if (s === undefined) return false;
  if (!(declared.publicOn || who.listed)) return false;
  // Only the two states that are DECIDED and shut. `none` is a collection with no window at all,
  // and `perRecord` is a bound this summary cannot read — refusing on either would report a closed
  // door on most of the apps there are.
  if (!ignoreWindow && !windowOpen(s, declared.now)) return false;
  if (!Array.isArray(s.createFields)) return false;
  if (!authOk(stage, who)) return false;
  // `audience: "participant"` is matched against the ROLE, so it shuts out viewers and editors as
  // firmly as it shuts out strangers.
  return s.audience !== "participant" || who.role === "participant";
}

/** `selfWriteOk` and `selfDelete`, kept APART — the rules gate them differently and the difference
 *  shows up exactly when a window closes.
 *
 *  Both are keyed by the CURRENT STATUS, so a collection with no `statusField` can say neither and
 *  the rules fail closed on it. That prerequisite is the declaration's, not a state machine's: a
 *  single-status collection satisfies it.
 *
 *  The update half sits inside `updateWith`, which carries `inWindow`; the delete half is reached
 *  through `deleteWith`, which does not. So after a window closes a submitter may still WITHDRAW
 *  their row and may no longer EDIT it. */
function selfUpdateDeclared(declared: Declared): boolean {
  const { c, s } = declared;
  if (s === undefined || typeof c.statusField !== "string" || flagOn(s, "finalize")) return false;
  if (!windowOpen(s, declared.now)) return false;
  const updates = asRecord(s.selfUpdate) ?? {};
  const transitions = asRecord(s.selfTransitions) ?? {};
  return Object.keys(updates).length > 0 || Object.keys(transitions).length > 0;
}

function selfDeleteDeclared(declared: Declared): boolean {
  const { c, s } = declared;
  if (s === undefined || typeof c.statusField !== "string") return false;
  return asStrings(s.selfDelete).length > 0;
}

/** Whether this subject can hold a row here AT ALL — the binding reaching them is necessary and
 *  not sufficient.
 *
 *  `emailField` reaches every verified account in the world, so `ownRowReachable` alone would
 *  report "own rows" for a stranger who has no way to make one, in the one panel whose job is to
 *  say that strangers reach nothing. So the row has to have been creatable: by them, or — for
 *  someone on the roster — by the desk on their behalf.
 *
 *  THE WINDOW IS DELIBERATELY IGNORED HERE. `ownRow` in the rules asks for a submit binding and the
 *  caller's identity and nothing else, so a visitor who submitted while the window was open goes on
 *  reading that row after it closes. Asking `canCreate` in full would erase their row from this
 *  table at the exact moment the panel is most likely to be consulted.
 *
 *  What it still closes over is a stranger who submitted while the SWITCH was on and the app was
 *  closed afterwards. Nothing in the working tree records that it happened; `caveatsOf` says so in
 *  words instead. */
function holdsRow(declared: Declared, stage: CollectionAccess["authStage"], who: Principal): boolean {
  return ownRowReachable(declared, who) && (who.listed || canCreate(declared, stage, who, true));
}

/** `readWith`, in its own order: a role first, then the public switch, then the two roster-wide
 *  openings, and `ownRow` last as the narrowest answer that is still an answer. */
function readAccessFor(declared: Declared, who: Principal, isWriter: boolean, own: boolean): ReadAccess {
  if (isWriter || declared.publicRead) return "all";
  // `revealGated` sits with the other two roster-wide openings, and it is CONDITIONAL: the row
  // opens once its parent says so. There is no "some rows" state and this table would rather
  // overstate an insider's reach than report `Nothing` about a row the rules hand them — the
  // caveat below carries the condition. Roster-only, so no outsider row moves.
  const rosterWide = declared.partRead || declared.c.peerVisibility === "public" || flagOn(declared.c, "revealGated");
  if (who.listed && rosterWide) return "all";
  return own ? "own" : "none";
}

function accessFor(declared: Declared, stage: CollectionAccess["authStage"], who: Principal): SubjectAccess {
  const { c } = declared;
  const immutable = flagOn(c, "immutable");
  const isWriter = who.role === "writer";
  const own = holdsRow(declared, stage, who);

  const read = readAccessFor(declared, who, isWriter, own);

  // `createWith`: a writer creates unless the collection is `submitOnly`, and either way the
  // public submission path is open to them on the same terms as everybody else.
  const create = (isWriter && !flagOn(c, "submitOnly")) || canCreate(declared, stage, who);

  return {
    read,
    create,
    editOwn: own && !immutable && (selfUpdateDeclared(declared) || selfDeleteDeclared(declared)),
    editAll: isWriter && !immutable,
    // Everybody's, and unconditionally: `mirrorRepair` is the FIRST branch of `updateWith` and asks
    // nothing about the caller.
    repairMirror: typeof c.mirrorOf === "string",
  };
}

/** The window's own sentence, in the four states `windowState` distinguishes. Split out of
 *  `caveatsOf` because it is the only branch there with more than one outcome. */
function windowCaveats(declared: Declared): string[] {
  if (declared.s === undefined) return [];
  const state = windowState(declared.s, declared.now);
  if (state === "closed") {
    return ["The submission window has CLOSED. Nobody reaches this collection through the public path now, whatever the rows above say about who could."];
  }
  if (state === "early") return ["The submission window has not opened yet."];
  if (state === "open") return ["Submissions are only taken inside a declared window, and it is open right now."];
  if (state === "perRecord") return ["Each record carries its own window bound, on another record — this summary cannot say whether any one of them is open."];
  return [];
}

/** What the table cannot answer, said in the author's own declaration's terms.
 *
 *  Every one of these NARROWS the table — none of them opens anything — so a reader who ignores
 *  the list is left with a summary that is too generous rather than too tight, which is the safe
 *  direction for the one question this panel is asked. */
function caveatsOf(declared: Declared, stage: CollectionAccess["authStage"]): string[] {
  const { c, s } = declared;
  const caveats: string[] = [];
  // The gap `ownRow` deliberately does not model — see its note. Reported only where it is
  // possible: a binding that reaches an outsider, and a door that is now shut to them.
  //
  // "Closed to them" has to mean closed BY THE SWITCH, which is the only thing that moves. A
  // collection scoped `audience: "participant"` refuses an outsider whatever `public.enabled`
  // says, so it never had the open period this sentence describes — and printing the caveat
  // there put a warning on `apps/ai-blogs`, whose strangers have never been able to submit.
  const strandable = OUTSIDER_PRINCIPALS.some(
    (who) => ownRowReachable(declared, who) && !canCreate(declared, stage, who) && canCreate({ ...declared, publicOn: true }, stage, who, true),
  );
  if (strandable) {
    // ONLY what is actually declared. `selfDelete` is what makes a withdrawal possible, and a
    // caveat promising one where the declaration names none is the panel inventing a permission.
    const andWithdraw = selfDeleteDeclared(declared) ? ", and may still withdraw it" : "";
    caveats.push(
      `Anyone who submitted while this collection was open still reads their own row${andWithdraw} — the rules bind a row to its submitter without asking the switch or the window.`,
    );
  }
  caveats.push(...windowCaveats(declared));
  // `gateOn` — the projected key, and the one the rules read. `gate` is not produced by anything.
  if (s !== undefined && s.gateOn !== undefined)
    caveats.push("A session gate has to be open, on the question the host is currently showing, before a submission is taken.");
  if (s !== undefined && s.idFrom === "field")
    caveats.push("The record id is a field, so the first submission for a value takes it and later ones are refused.");
  // THE THREE THAT BIND A WRITER, and the reason they are here rather than in the table: each one
  // is decided per RECORD, by the status that record is in or by another record entirely, and the
  // `Owner / editor` row is one cell for the whole collection. Without them the row reads
  // "Anything" about a collection where the owner cannot delete a closed topic.
  if ("transitions" in c && typeof c.statusField === "string") {
    caveats.push("A record's status may only move along the declared `transitions` — for everyone, the owner included.");
  }
  if (asStrings(c.sealed).length > 0) {
    // DELETE only: a sealed record can still have its fields corrected. It is `deleteWith` that
    // asks `sealedNow`, and saying "cannot be changed" here would be the panel being stricter than
    // the rules, which is its own kind of wrong.
    caveats.push("A record in a sealed state cannot be DELETED by anyone, the owner included — though its fields can still be corrected.");
  }
  if (isRecord(c.refIn)) {
    caveats.push(
      "A new record is refused unless the record it points at is in the state `refIn` requires, and that reference is frozen afterwards — the owner is bound too.",
    );
  }
  if (flagOn(c, "revealGated")) {
    // The condition the `All rows` above cannot carry: it is per record, and only after the parent
    // says so.
    caveats.push("Everyone on the roster reads a row ONCE ITS PARENT REVEALS IT, and not before — the roster rows above are the state after the reveal.");
  }
  if (typeof c.assigneeField === "string") caveats.push("An assignee reads everything here and writes only the rows assigned to them.");
  if (typeof c.mirrorOf === "string") caveats.push("Anyone may repair this collection's `state` field to match the record it mirrors.");
  // The SUBMISSION side of the same pair (`mirrorClaimed` / `mirrorReleased`), which binds every
  // create and every delete here — the writer branches included. Without it a create that looks
  // allowed in the table is refused for a reason nothing on this panel names.
  if (typeof s?.mirror === "string") {
    caveats.push(`A record here cannot be created or deleted on its own: the same write has to move the slot it claims in \`${s.mirror}\`.`);
  }
  return caveats;
}

/** The summary, from the two documents `app(aid)` resolves to.
 *
 *  `cids` is the collections the app PUBLISHES, passed in rather than inferred from the keys
 *  below: a collection that declares no rule configuration, no public read and no submit is
 *  exactly the one whose absence from this table would be read as "it is not published". */
export function sharedAppAccessOf(
  app: Record<string, unknown>,
  publicBlock: Record<string, unknown> | undefined,
  cids: readonly string[],
  now: number = Date.now(),
): SharedAppAccess {
  const publicOn = publicBlock?.enabled === true;
  const readList = asStrings(publicBlock?.read);
  const submit = asRecord(publicBlock?.submit) ?? {};
  const configured = asRecord(app.collections) ?? {};
  const participantRead = asStrings(app.participantRead);
  const members = asRecord(app.members) ?? {};

  const all = [...new Set([...cids, ...Object.keys(configured), ...Object.keys(submit), ...readList, ...participantRead])].sort(byCodeUnit);

  return {
    publicFace: publicFaceOf(publicBlock),
    unmatchableRoster: Object.keys(members).filter(unmatchable).sort(byCodeUnit),
    collections: all.map((cid): CollectionAccess => {
      const s = asRecord(submit[cid]);
      const declared: Declared = {
        c: asRecord(configured[cid]) ?? {},
        s,
        publicOn,
        publicRead: publicOn && readList.includes(cid),
        partRead: participantRead.includes(cid),
        now,
      };
      const stage = s?.auth === "anonymous" || s?.auth === "verifiedEmail" ? s.auth : "none";
      return {
        cid,
        takesSubmissions: s !== undefined,
        authStage: stage,
        census: censusOf(members, cid),
        caveats: caveatsOf(declared, stage),
        access: {
          visitor: accessFor(declared, stage, PRINCIPALS.visitor),
          stranger: accessFor(declared, stage, PRINCIPALS.stranger),
          participant: accessFor(declared, stage, PRINCIPALS.participant),
          writer: accessFor(declared, stage, PRINCIPALS.writer),
        },
      };
    }),
  };
}

/** The wire shape of `GET /api/shared-app/access`, in the three states the pane distinguishes:
 *  not a shared app at all, a manifest that could not be read, and the summary. */
export type SharedAppAccessResponse =
  { declared: false } | { declared: true; ok: false; problems: string[] } | { declared: true; ok: true; access: SharedAppAccess };
