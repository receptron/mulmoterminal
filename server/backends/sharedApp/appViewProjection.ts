// The declaration, as each audience is handed it: the `{tier}/config` document
// deploy writes and publish promotes.
//
// THIS LIVES IN THE HOST ON PURPOSE. It was in `@mulmoclaude/core` until
// mulmoterminal `plans/refactor-shared-app-wire-contract.md`, and the move is
// about who has to release: the document has exactly one writer (this file) and
// one reader (mulmoserver's entrance), and neither of them is that package —
// MulmoClaude neither writes nor reads a shared collection at all. Adding a
// field to `{tier}/config` was therefore a core change, a human npm publish, a
// bump here, and only then the work. Now it is this file.
//
// What stayed in core is not a leftover, it is the cut line: `normalizeViews`
// and `participantScope` are what the PUBLISH GATE refuses a declaration
// through, and `projectApp` / `projectDeploy` / `projectPublish` are what
// mulmoserver `test/rules/rules_publish.ts` feeds to the Firestore rules
// emulator — the only test in either repository that proves a projection and
// `firestore.rules` agree. Do not bring those here; they would arrive with
// nothing checking them.
//
// `projectSubmit` is imported rather than re-implemented for the mirror-image
// reason: the same `public.submit` declaration is projected twice, into
// `config/public` (which the rules read) and into each tier's config (which a
// page reads), and two ISO-to-millis lowerings is the divergence nobody sees
// until a submit window silently stops closing.
//
// The projection is PURE. No clock (the stamp is passed in), no filesystem (the
// host reads the HTML), no Firestore. `appViews.ts` beside this file is what
// turns the result into writes.
import {
  normalizeViews,
  participantScope,
  projectSubmit,
  VIEW_TIER,
  type AuthoredApp,
  type AuthoredCollectionConfig,
  type AuthoredMail,
  type NormalizedView,
  type ProjectedViewCollection,
  type PublishStamp,
  type ViewAudience,
} from "@mulmoclaude/core/collection/server";

/** The two audiences with a tier of their own. `public` keeps `config/*`, which
 *  is already published and already read by a deployed runtime. */
export type TierAudience = Exclude<ViewAudience, "public">;

// ---------------------------------------------------------------------------
// What an audience may CHANGE
//
// mulmoterminal plans/feat-shared-app-member-write.md. The rules already allow
// every write below — `isWriter`, the assignee branch, `ownRow` + `selfWriteOk`
// — so nothing here grants anything. What it does is tell the page which
// buttons exist, and let the parent name a refusal the rules would answer with
// a bare permission error.
//
// THE VOCABULARY IS CLOSED: a transition moves one declared status field, an
// assignment moves one declared assignee field, and there is no third thing.
// A general patch would be no less safe (the rules bind either way) and two
// things worse: a bug in the page reaches as far as the member's role does,
// and nothing above can say what happened.
//
// AND IT IS PROJECTED PER TIER, because "which transitions" is a different
// question for each audience. Staff move `pending → approved`
// (`collections[cid].transitions`); the person who booked moves
// `pending → cancelled` (`public.submit[cid].selfTransitions`). Publishing one
// table to both draws an approve button on a participant's page that the rules
// refuse when pressed — declaration and enforcement disagreeing, which is the
// one failure this whole mechanism exists to prevent.

/** What one audience may change about one collection.
 *
 *  An entry exists only where something is actually writable; a collection a
 *  tier may only read is absent rather than present and empty. */
export interface ProjectedViewWrite {
  cid: string;
  /** The field a transition moves. Without it there are no transitions. */
  statusField?: string;
  /** `{ <current status>: [<status>...] }`, for THIS audience. */
  transitions?: Record<string, string[]>;
  /** The field naming the member a row belongs to. `member` tier only. */
  assigneeField?: string;
  /** Who may write EVERY row here — the `owner` / `editor` holders. `member`
   *  tier only, and it is what makes the tier's one shared document honest:
   *  see {@link writersOf}. */
  writers?: string[];
  /** Who may write only the rows ASSIGNED to them — the `assignee` holders.
   *  Present with `assigneeField`, since without one the role grants nothing.
   *
   *  The assignment CANDIDATES are these two lists together, and are left to
   *  be derived rather than published a third time: a separate list would be
   *  one more thing that can disagree with the two the rules actually read. */
  rowWriters?: string[];
  /** `member` tier only: the rules let only a writer (or the row's own
   *  assignee) queue mail, so a participant handed this could only be refused. */
  mail?: AuthoredMail;
}

/** The declaration as one non-public audience may see it — the document
 *  published at `apps/{aid}/{tier}/live:config`, and deployed at
 *  `staged:config`.
 *
 *  The roster is NOT here, and neither is anything about another member: this
 *  is read by everyone the tier admits, which for `roster` includes every
 *  participant.
 *
 *  APPEND-ONLY, and every key but the four below optional on the reader's side.
 *  A document published three months ago sits in Firestore in the shape of that
 *  day until somebody publishes again, so mulmoserver reads every past version
 *  of this — see `src/firestore/appViewWrite.ts`, whose entry point takes
 *  `unknown` and drops what it cannot parse. Renaming a field here does not
 *  migrate anything; it strands what is already published. */
export interface AppViewConfigDoc extends Record<string, unknown> {
  name?: string;
  views: { id: string; collections: ProjectedViewCollection[] }[];
  /** The submit declarations for the collections these views draw, so the page
   *  can show what may be sent rather than discovering it from a denial. */
  submit: Record<string, Record<string, unknown>>;
  /** What this audience may CHANGE about those collections — see
   *  {@link writeFor}. One entry per collection that has anything writable, in
   *  the order the views declare them; absent entries mean "read only", which
   *  is what a page with no buttons is drawn from. */
  write: ProjectedViewWrite[];
  publishedAt: number;
}

/** One audience's tier, as publish (or deploy) must write it.
 *
 *  Both tiers are returned even when empty, deliberately. An app that WITHDREW
 *  its member pages produces an empty tier, and a host that only ever saw the
 *  tiers with something in them would leave the previous pages live — the
 *  failure `config/view` already had, where a declaration was withdrawn and
 *  the world went on reading the page. */
export interface AppViewTier {
  tier: "member" | "roster";
  audience: TierAudience;
  /** The projection document, for `{tier}/live:config` or `{tier}/staged:config`.
   *  Meaningless when `views` is empty — the host deletes the tier instead. */
  config: AppViewConfigDoc;
  /** The views to publish, in declaration order. The host reads each `path`
   *  and writes it to `{tier}/live:{id}`. */
  views: NormalizedView[];
}

/** What the RULES will be in force with, as against what the manifest says.
 *
 *  `projectPublish` replaces BOTH `participantRead` and `collections` with what
 *  the staged schemas carry, so at publish the promoted pair is what decides
 *  whether a read is allowed and which transitions exist. They travel together
 *  deliberately: passing one and not the other publishes a page whose datasets
 *  follow revision A and whose buttons follow revision B.
 *
 *  At DEPLOY the manifest is exactly what is being staged, so the default is
 *  right — and today deploy is the only caller, because publish PROMOTES the
 *  staged documents rather than re-projecting them. */
export interface PromotedRuleConfig {
  participantRead?: readonly string[];
  collections?: Record<string, AuthoredCollectionConfig>;
}

/** The role a member holds on one collection, by the rules' own resolution:
 *  the per-collection entry, else the `*` fallback, else none. */
function roleOn(app: AuthoredApp, address: string, cid: string): string | undefined {
  const held = app.members[address];
  if (held === undefined) return undefined;
  return held[cid] ?? held["*"];
}

/** The addresses holding one of `roles` on `cid`.
 *
 *  Sorted, for the same reason `memberEmails` is: a second publish of an
 *  unchanged declaration must produce an unchanged document. */
function holdersOf(app: AuthoredApp, cid: string, roles: readonly string[]): string[] {
  return (
    Object.keys(app.members)
      .filter((address) => roles.includes(roleOn(app, address, cid) ?? ""))
      // Code-unit order, NOT `localeCompare`. This array is published to
      // Firestore and compared by ORDER, and idempotence is a property publish
      // is tested for — a locale-sensitive comparison would put the same roster
      // in a different order on a different machine, so a publish that changed
      // nothing would rewrite the document.
      // eslint-disable-next-line sonarjs/no-alphabetical-sort
      .sort()
  );
}

/** Who may write every row of `cid`.
 *
 *  WHY ADDRESSES ARE PUBLISHED AT ALL. One `member/config` document is read by
 *  everyone the tier admits, and the tier only establishes that somebody holds
 *  SOME role SOMEWHERE — so a `viewer`, or a stylist scoped to another
 *  collection, reads the same entry as the front desk. Without these lists the
 *  page would draw approve and reassign for all of them and the rules would
 *  refuse when pressed, which is the declaration/enforcement mismatch this
 *  whole mechanism exists to prevent.
 *
 *  It cannot be answered per principal instead: the document is written once
 *  at publish and read by many, and the reader cannot look their own role up —
 *  `apps/{aid}` is `readerOf(a, '*')`, and a stylist carrying only
 *  `{bookings: "editor"}` holds no `*` role. So the ROSTER'S ANSWER travels
 *  with the declaration and the page compares its own address to it.
 *
 *  The cost is that staff addresses are visible to staff. That is already true
 *  of the approval mail they send each other, and participants read the
 *  `roster` tier, which never carries these.
 *
 *  A SNAPSHOT, like everything else published: a member added since the last
 *  publish is absent until the next one. The rules are the authority either
 *  way — this only decides which buttons are drawn. */
function writersOf(app: AuthoredApp, cid: string): string[] {
  return holdersOf(app, cid, ["owner", "editor"]);
}

/** The transition half: which table applies, and the field it moves.
 *
 *  Both halves or neither. A status field with no table would offer every
 *  value; a table with no field has nothing to write it to. */
function transitionPart(app: AuthoredApp, audience: TierAudience, cid: string): Partial<ProjectedViewWrite> {
  const config = app.collections?.[cid];
  const transitions = audience === "member" ? config?.transitions : app.public?.submit?.[cid]?.selfTransitions;
  if (config?.statusField === undefined || transitions === undefined) return {};
  const part: Partial<ProjectedViewWrite> = { statusField: config.statusField, transitions };
  // The rules let only a writer (or the row's own assignee) queue mail, so a
  // participant handed this could only ever be refused.
  if (audience === "member" && config.mail !== undefined) part.mail = config.mail;
  return part;
}

/** The assignment half. `member` only — see {@link writersOf}.
 *
 *  `rowWriters` rides here rather than beside `writers`, because the
 *  `assignee` role grants nothing at all without a field to compare against
 *  (`isAssigned` in the rules requires one, and publish refuses the pair). */
function assignPart(app: AuthoredApp, audience: TierAudience, cid: string): Partial<ProjectedViewWrite> {
  const assigneeField = app.collections?.[cid]?.assigneeField;
  if (audience !== "member" || assigneeField === undefined) return {};
  return { assigneeField, rowWriters: holdersOf(app, cid, ["assignee"]) };
}

/** What `audience` may change about `cid`, or null when the answer is nothing.
 *
 *  The two audiences differ in WHICH transition table applies, in whether
 *  assignment exists at all, and in whether the roster's answer travels with
 *  it; they agree that the status field is the collection's, since the rules
 *  read one field either way. */
export function writeFor(app: AuthoredApp, audience: TierAudience, cid: string): ProjectedViewWrite | null {
  const write: ProjectedViewWrite = { cid, ...transitionPart(app, audience, cid), ...assignPart(app, audience, cid) };
  if (Object.keys(write).length === 1) return null;
  // Only the staff tier: a participant writes their own row, which the rules
  // answer from the record rather than from a role, and publishing the roster's
  // writers to them would be an address list for nothing.
  if (audience === "member") write.writers = writersOf(app, cid);
  return write;
}

/** What one audience may see of one collection.
 *
 *  For `member` this is always the whole collection: every read branch a role
 *  opens (`readerOf`) is unscoped. Whether THIS member holds the role is not
 *  knowable here — one projection is read by every member of the tier — and is
 *  settled where it can be, by the entrance trying the read.
 *
 *  For `participant` it is the rules' own answer, which is why it can be null:
 *  a participant with neither `participantRead` nor an own-row submit path
 *  cannot read the collection at all, and a page handed it would fail rather
 *  than render less. */
function scopeFor(authored: AuthoredApp, audience: TierAudience, cid: string, participantRead: readonly string[]): ProjectedViewCollection | null {
  return audience === "member" ? { cid, scope: "all" } : participantScope(authored, cid, participantRead);
}

/** What this audience may CHANGE, per collection it draws.
 *
 *  The `collections` config is the PROMOTED one where there is one: at publish
 *  the rules run against what deploy staged, so projecting the manifest's
 *  would advertise transitions the live rules deny. */
export function tierWrites(authored: AuthoredApp, audience: TierAudience, cids: string[], promoted: PromotedRuleConfig): ProjectedViewWrite[] {
  const effective: AuthoredApp = promoted.collections === undefined ? authored : { ...authored, collections: promoted.collections };
  // Read-only collections are absent rather than present and empty: an entry
  // is what a page draws a button from.
  return cids.map((cid) => writeFor(effective, audience, cid)).filter((entry): entry is ProjectedViewWrite => entry !== null);
}

/** What this audience may READ, and how to query for it.
 *
 *  A collection with no scope is dropped rather than published as unreachable:
 *  the gate has already refused the declaration, so reaching here with one is
 *  a programming error, and a page that queries it is denied. */
export function tierViews(
  authored: AuthoredApp,
  audience: TierAudience,
  views: NormalizedView[],
  participantRead: readonly string[],
): { id: string; collections: ProjectedViewCollection[] }[] {
  return views.map((view) => ({
    id: view.id,
    collections: view.collections
      .map((cid) => scopeFor(authored, audience, cid, participantRead))
      .filter((scope): scope is ProjectedViewCollection => scope !== null),
  }));
}

/** The submit declarations for the collections these views draw, so a page can
 *  show what may be sent rather than discovering it from a denial.
 *
 *  `projectSubmit` is core's, and shared rather than copied: the same
 *  declaration also becomes `config/public`, which `firestore.rules` reads. */
function tierSubmit(authored: AuthoredApp, cids: string[]): Record<string, Record<string, unknown>> {
  const declared = authored.public?.submit ?? {};
  return Object.fromEntries(
    cids.flatMap((cid) => {
      const spec = declared[cid];
      return spec === undefined ? [] : [[cid, projectSubmit(spec)] as const];
    }),
  );
}

/** One tier's projection: what this audience may read, and what it may change. */
function tierConfig(
  authored: AuthoredApp,
  audience: TierAudience,
  views: NormalizedView[],
  stamp: PublishStamp,
  promoted: PromotedRuleConfig,
): AppViewConfigDoc {
  const cids = [...new Set(views.flatMap((view) => view.collections))];
  const config: AppViewConfigDoc = {
    write: tierWrites(authored, audience, cids, promoted),
    views: tierViews(authored, audience, views, promoted.participantRead ?? authored.participantRead ?? []),
    submit: tierSubmit(authored, cids),
    publishedAt: stamp.publishedAt,
  };
  if (authored.name !== undefined) config.name = authored.name;
  return config;
}

/** Project the declaration into the per-audience documents.
 *
 *  Pure, like core's `projectApp`: the HTML is not here (the host reads the
 *  files), and neither is the clock. What is here is the answer to "what may
 *  this audience read, how, and what may it change" — computed once, so the
 *  page never has to guess and never has to discover it from a denial. */
export function projectAppViews(authored: AuthoredApp, stamp: PublishStamp, promoted: PromotedRuleConfig = {}): AppViewTier[] {
  const normalized = normalizeViews(authored);
  if (!normalized.ok) throw new Error(`publish: views declaration is not publishable (${normalized.problems.join(" ")})`);
  const audiences: TierAudience[] = ["member", "participant"];
  return audiences.map((audience) => {
    const views = normalized.views.filter((view) => view.audience === audience);
    return { tier: VIEW_TIER[audience], audience, config: tierConfig(authored, audience, views, stamp, promoted), views };
  });
}
