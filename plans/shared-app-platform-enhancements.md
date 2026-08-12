# Plan: Expand Shared Apps into a Declarative Application Platform

**Status:** Proposed

**Date:** 2026-08-12

**Principle:** Applications declare data, policy, operations, views, and effects; they do not ship
application-specific server code.

## Goal

Make shared apps expressive enough for booking, scheduling, task management, approvals, registration,
resource lending, surveys, and live voting while preserving the architecture in
[`docs/shared-app-design-principles.md`](../docs/shared-app-design-principles.md).

The goal is not a catalog of unrelated vertical products. It is a compact set of composable primitives
whose combinations cover those products. Each example application below is a conformance test for the
declaration language. Templates remain pure data and must not add engine code.

## Constraints

- The public application continues to work when the author's computer and MulmoTerminal are offline.
- Clients use Firebase directly; Firestore Security Rules remain the final authority.
- An application cannot upload trusted code or receive privileged Firebase credentials.
- Custom HTML is sandboxed presentation and can access only declared datasets and actions.
- New declarations must fail closed on an older rules/runtime deployment.
- New rules must remain within Firestore expression and document-access budgets.
- Data with different visibility is stored separately; field masking is not simulated in a client.
- Requirements that need secrets or autonomous background work use only fixed, audited platform effects.

## Current foundation

The platform already has much of the semantic kernel:

- repository-scoped application identity, roster, staging, publish, unpublish, provenance, and fork;
- Firestore-backed collections and realtime collection listeners;
- owner, editor, viewer, participant, and assignee roles with collection overrides;
- public submission with field allowlists, verified identity, submitter binding, and own-row reads;
- automatic, UID, and UID-plus-field document identity;
- initial states, state transitions, immutable collections, per-state self-update, and self-transitions;
- fixed and record-relative opening windows;
- server timestamps for honest first-come ordering;
- live session gates, staged reveal, peer visibility, and public/member read policies;
- transition-bound email queue writes;
- deploy and publish gates that validate declarations and existing records.

The largest gaps are not basic storage. They are a public realtime view/action runtime, stronger reusable
integrity primitives, richer row-scoped workflow policy, atomic multi-document operations, named query
contracts, standard semantic views, and derived/effect capabilities.

## Application conformance suite

The examples are deliberately concrete. An increment is complete only when the named application can be
built from declarations and generic views, with the guarantees below enforced against a direct malicious
Firestore client.

### A1. Conference survey with conditional questions

An organizer publishes five questions. Every signed-in attendee may answer once until Friday at 17:00.
Question 4 appears only when question 3 is `yes`. Attendees may reread their own answer but never another
person's. The public sees totals by answer without seeing individual responses.

Required composition:

- `idFrom: "auth.uid"` for one response per person;
- an absolute submission window and immutable/finalized response;
- declarative conditional field visibility;
- private `responses` and a separate public `results` projection;
- a form view and a chart/dashboard view.

Missing or incomplete capabilities: conditional public forms, finalized create semantics in the public
runtime, and a privacy-preserving aggregate projection. If totals must update without an authorized reader
online, aggregation is a fixed platform effect rather than client code.

### A2. Salon appointment booking

A visitor chooses a stylist, service, and currently open slot. Two visitors racing for the same slot
cannot both book it. A customer may cancel a pending booking but cannot approve it or move an approved
booking. The assigned stylist may approve only their own bookings; reception may manage all bookings.
Approval sends an email. The public schedule contains no customer information.

Collections: `stylists`, `services`, `slots`, `availability`, and private `bookings`.

Required composition:

- field-derived document identity, with booking ID equal to slot ID;
- an existence/state constraint proving that the selected slot is real and open;
- record-relative opening and closing times;
- an atomic booking plus public-availability update;
- assignee-scoped writes and actor-specific transitions;
- a schedule view and transition-bound email.

This is the first acceptance target for `idFrom: "field"`, `idIn`, `window.untilField`, declarative
mirrors, atomic actions, and the public View Bridge.

### A3. Team task and Kanban application

A team creates tasks with a reporter, assignee, priority, due date, labels, comments, and state. The
reporter may edit the description while a task is open. The assignee may move it from `todo` to `doing`
and `review`; a reviewer may move it to `done` or back to `doing`. Every transition is retained in an
append-only activity log. The board updates live.

Collections: `tasks`, `comments`, `activity`, `members`, and `labels`.

Required composition:

- multiple named row actors rather than one hard-coded assignee;
- actor-specific transitions and per-state field mutation policy;
- append-only child/event records bound to the parent and authenticated actor;
- named live datasets with filters and limits;
- board, detail, and activity-timeline views.

This application prevents `editor` from becoming a universal workflow bypass and establishes the
general workflow model used by reviews, repairs, case management, and issue tracking.

### A4. Expense approval workflow

An employee submits an expense with receipt attachments. Their manager may approve or reject it. Finance
may mark an approved expense as paid but cannot rewrite the original amount or receipt. The submitter sees
their request and its audit trail. Manager and finance queues show only work assigned to them. Each valid
transition may send a different notification.

Collections: `expenses`, `approvals`, and append-only `activity`.

Required composition:

- submitter, manager, and finance row actors;
- role/actor-specific transition permissions;
- immutable fields after submission and per-state editable fields;
- Storage attachment policy tied to the parent record;
- transition-bound email/push effects;
- filtered queue and detail views.

This is the acceptance target for scoped workflow actions, immutable field subsets, audit events, and
attachment authorization.

### A5. Shift scheduling and swap board

A manager publishes staffed and open shifts. A worker can claim one open shift if it does not overlap a
shift they already hold, release it before a deadline, or offer it for swap. Another worker accepts the
swap atomically; the schedule must never temporarily assign one shift to both workers. Everyone sees the
live team schedule, but private worker notes remain hidden.

Collections: `workers`, `shifts`, `claims`, `swapOffers`, and public `schedule`.

Required composition:

- deterministic claim identity and create-only claims;
- relation and state constraints on referenced shifts;
- atomic claim/swap operations across multiple documents;
- deadline policy and safe schedule projection;
- calendar/schedule views.

Arbitrary time-range overlap is not efficiently provable by Firestore rules. The initial supported model
must use declared, discrete shift/slot IDs. Free-form interval conflict detection remains out of scope
until the platform has an audited claim-index primitive.

### A6. Workshop registration with capacity and waiting list

Registration opens three days before each workshop. A person can register once per workshop. The first
20 valid registrations are shown as confirmed and the next five as waiting. Cancellation moves the next
person into the displayed confirmed range. Contact details remain visible only to organizers. A promoted
participant may receive a notification.

Collections: `workshops`, private `registrations`, and public `registrationStats`.

Required composition:

- UID-plus-workshop identity;
- server-stamped immutable arrival order;
- record-relative open/close windows;
- rank-derived capacity and waiting status;
- a public count/projection that does not expose participant rows;
- optional promotion notification effect.

Firestore rules cannot count registrations. The declaration must distinguish a rank-derived display from
an enforced finite set of discrete seats. If strict capacity is required, the workshop materializes 20
seat documents and registrations claim one of those IDs atomically.

### A7. Equipment checkout and return

Staff maintain a catalog of cameras and laptops. A member may check out an available asset; only one
active checkout can exist for an asset. The borrower may request an extension, staff approve it, and staff
record return and damage. Historical checkouts remain immutable. Overdue reminders are sent even when no
client is open.

Collections: public/member-readable `assets`, private active `checkouts`, and append-only `history`.

Required composition:

- asset-derived active-checkout identity;
- atomic asset-state plus checkout/history operation;
- borrower and staff transition policy;
- immutable historical events;
- due-date queries and list/detail views;
- a generic scheduled reminder effect.

This validates resource claims, append-only audit, and the boundary between synchronous Firestore
invariants and autonomous platform effects.

### A8. Shared calendar with recurring events and RSVP

Organizers create one-time or recurring events. Members see a calendar, RSVP once per occurrence, and may
change their RSVP until its cutoff. Organizers can cancel one occurrence without deleting the series.
Public visitors see event time and capacity status but not attendee identities.

Collections: `series`, `occurrences`, private `rsvps`, and public `eventStats`.

Required composition:

- materialized occurrence IDs and UID-plus-occurrence RSVP identity;
- occurrence-relative RSVP windows;
- recurrence materialization as a deterministic platform operation;
- public aggregate projection separated from private RSVP rows;
- calendar and event-detail views.

Security Rules cannot generate future occurrences. Initially an organizer explicitly materializes a
declared date range. Automatic rolling generation, if added, is a fixed scheduled capability with bounded
horizon and idempotent IDs.

### A9. Live classroom quiz

A teacher selects one question and opens answering. Students may answer that question once while the
phase is `open`. Correct answers and explanations remain unreadable until the teacher reveals them. The
student screen advances live. After reveal, students see the class distribution and their own result;
the teacher sees every student's answer.

Collections: `questions`, gated `answers`, gated `solutions`, `stats`, and `session/current`.

Required composition:

- participant-only submission with UID-plus-question identity;
- session phase/current gate;
- storage-level split between pre-reveal and post-reveal data;
- realtime session and dataset subscriptions;
- private-source aggregate revealed by policy;
- presenter, answer, and results views.

This is the principal acceptance target for the live View Bridge, staged visibility, and phase-bound
aggregates.

### A10. Named live vote

A chair opens one agenda item at a time. Each rostered voter casts one immutable `yes`, `no`, or `abstain`
vote for that item. Votes and totals appear live to participants according to the declaration. The chair
cannot manufacture or alter another member's vote. The final record remains available after the session.

Collections: `topics`, immutable `votes`, `session/current`, and optionally `results`.

Required composition:

- participant audience and UID-plus-topic identity;
- verified actor binding and `submitOnly` integrity;
- immutable records, session gate, and enum validation;
- declared peer visibility and live aggregate/dashboard.

A secret ballot is a separate capability, not a presentation option. It requires trusted anonymization
and coercion/privacy analysis and remains explicitly unsupported by this plan.

## Capability workstreams

### W1. Capability contract, strict parsing, and version negotiation

Define a versioned capability catalog shared by core, MulmoTerminal, MulmoServer, and the deployed rules.
Every new key is strict-parsed; unknown keys are errors rather than silently stripped.

Deliverables:

- authored and published capability version fields;
- raw-declaration linting plus semantic checks across collections;
- runtime refusal for incompatible public config/view versions;
- publish refusal when rules/runtime capabilities are too old;
- one specification entry per primitive: syntax, projection, enforcement, cost, and tests.

This work comes first because every later declaration depends on an unambiguous compatibility contract.

### W2. Public View Bridge and declared runtime capabilities

Add a public bridge with an explicit contract distinct from the existing host custom-view contract. Host
views use `window.__MC_VIEW`; public views use `window.__MC_PUBLIC_VIEW`. They may share browser-safe
message types and validation helpers, but one HTML file must not try to implement both contracts. The
public parent owns Firebase and the public view owns presentation.

Declare:

- named datasets the view may receive;
- actions the view may request;
- whether each dataset is one-shot or live;
- bounded reference expansion;
- protocol and application publication versions.

The public bridge provides `ready`, initial state, patches, action requests, correlated results, status,
and resize. It validates `event.source`, action name, payload shape, field types, and declared capability
before calling Firebase. Because a sandboxed `srcdoc` iframe has an opaque origin, `event.origin` is not
an identity check. The public sandbox receives no credentials, tokens, or arbitrary fetch endpoint.

Publish rejects a public view that references `__MC_VIEW`, and the public runtime rejects mismatched
config/view publication versions instead of combining a new declaration with stale HTML.

Unlocks: A2, A3, A8, A9, and A10 presentation and realtime behavior.

### W3. Identity, relation, and time constraints

Extend the finite rule-enforced identity vocabulary:

- `idFrom: "field"` with an immutable `idField`;
- `idIn` proving the ID exists in a declared collection and optionally matches a declared state;
- `window.untilField` symmetric with the existing record-relative opening bound;
- immutable declaration identity once live records occupy that ID space;
- optional claim-document patterns for discrete resources and seats.

Rules must deploy before declarations that can emit the new values. Publish must refuse unsafe identity
changes even when a general schema migration is confirmed.

Unlocks: A2, A5, A7, and the strict-seat form of A6.

### W4. Row actors and actor-specific workflow policy

Generalize row-scoped authorization without turning policies into arbitrary expressions. A bounded actor
map binds names such as `submitter`, `assignee`, `reviewer`, or `manager` to authenticated fields or roster
roles. Transitions and editable fields refer to those actor names.

Required semantics:

- both pre-write and post-write actor binding where reassignment is possible;
- transition permission by actor and source state;
- immutable field subsets after specified states;
- append-only event creation bound to a parent transition and authenticated actor;
- no owner/editor bypass of lifecycle invariants;
- explicit caps chosen from measured Firestore rule expression budgets.

Unlocks: A3, A4, A5, and A7.

### W5. Declarative atomic operations and authoritative mirrors

Introduce a small audited vocabulary of atomic operations rather than an arbitrary write script.
Initial patterns:

- create a record and update its declared mirror;
- transition a record and append an audit event;
- transition a record and enqueue a declared effect;
- create or release a deterministic resource claim;
- swap two declared assignments;
- compare a related record's post-write existence or state.

The runtime constructs a Firestore batch; rules independently verify every document and its relationship
using `getAfter` or `existsAfter`. Operation inputs cannot select arbitrary collections, fields, or paths.

Unlocks: A2, A4, A5, and A7.

### W6. Named datasets, queries, and standard semantic views

Views consume named datasets rather than constructing Firestore queries. A dataset declares collection,
audience, filter, order, limit, pagination, live mode, and bounded reference expansion.

Publish performs a query-plan check:

- ensure the collection is readable by the intended audience;
- reject unbounded public reads;
- identify composite index requirements;
- cap payload and subscription counts;
- prevent a filtered view from being mistaken for a security boundary.

Add standard views in this order:

1. form and detail;
2. table/list and filtered queue;
3. board/Kanban;
4. calendar;
5. resource schedule;
6. dashboard/chart;
7. live presenter/ballot.

Custom HTML remains available for layout and visualization, but it uses the same datasets and actions.

Unlocks: the primary UI for all ten acceptance applications.

### W7. Validation and data integrity

Expand rules-enforced validation beyond field allowlists and selected aggregation enums. Because rules
cannot iterate arbitrarily, publish lowers authored validation into a bounded, explicitly unrolled policy.

Prioritize constraints that protect meaning:

- primitive type and nullability;
- string length and safe pattern;
- numeric range;
- enum membership;
- immutable fields;
- required references and related-record state;
- server timestamps;
- maximum document field count and payload size.

The client repeats these checks for useful errors; rules remain authoritative. Publish reports when a
schema asks for a constraint that the rules cannot enforce.

Unlocks robust direct-client resistance across all applications.

### W8. Aggregates, projections, and platform effects

Define three distinct declarations rather than one ambiguous `aggregate` feature:

- **client aggregate:** computed from rows the audience may read;
- **verified mirror/projection:** updated atomically or repairably under rules;
- **private projection:** maintained by a fixed platform capability because the audience cannot read its
  source rows.

Add audited effects incrementally:

1. transition-bound email;
2. push notification;
3. scheduled reminder;
4. bounded recurrence materialization;
5. private aggregate projection;
6. signed webhook integrations, only after secret management and retry/idempotency contracts exist.

Each effect has deterministic request identity, a declared source transition, allowed recipient/source
fields, retry semantics, and an audit record. Apps configure effects; they never supply executable code.

Unlocks: public survey results, promotion/overdue reminders, recurring calendars, and external delivery.

### W9. Templates and the application conformance suite

Ship templates indexed by behavior rather than industry:

- intake/collection;
- resource booking;
- ranked registration;
- assigned workflow;
- task board;
- resource checkout;
- calendar/RSVP;
- live gated session;
- immutable named record.

Each template includes the declaration, schemas, views, threat model, privacy boundary, known Firebase
limits, and common incorrect variants. Templates are validated by the same parser, publish checks,
emulator tests, and browser tests as normal applications.

## Milestones

### M1. Public interactive applications

Complete W1, W2, and the first part of W6. A survey and simple public form/list application work end to
end with a sandboxed custom view, declared datasets/actions, and versioned publication.

### M2. Correct booking and scheduling

Complete W3 and the booking portions of W5 and W6. A2 salon booking passes concurrent race, privacy,
cancellation, and assignee tests. A5 supports discrete shifts; A8 supports manually materialized
occurrences.

### M3. General workflows and task management

Complete W4, audit-event operations in W5, board/queue views in W6, and integrity checks in W7. A3 task
board, A4 expense approval, and the synchronous portion of A7 equipment checkout pass.

### M4. Live applications and derived results

Complete live datasets, presenter/ballot/dashboard views, and aggregate/projection semantics. A9 classroom
quiz and A10 named vote pass reveal, immutability, identity, and realtime tests.

### M5. Autonomous audited effects

Complete scheduled reminders, recurrence materialization, and private projections in W8. A1 public
private-source results, A7 overdue reminders, and A8 rolling occurrences work without an author's machine
or visitor remaining online.

### M6. Template ecosystem

Complete W9 and publish the conformance templates through the existing registry/fork workflow. Creating
or forking any template requires no platform code change.

## Cross-repository implementation order

The system spans three repositories, and rollout order is part of correctness:

1. **MulmoServer rules and emulator tests** accept and enforce a new published capability.
2. **MulmoClaude core** parses authored syntax, projects the bounded rule configuration, and exposes
   browser-safe bridge/types.
3. **MulmoServer runtime** reads the new projection and implements public/member behavior.
4. **MulmoTerminal** lints, stages, publishes, removes, versions, and reports the capability.
5. **Templates and skills** may begin emitting it only after the compatible runtime and rules are live.

When a capability is retired, reverse compatibility must keep old published apps safe until they are
migrated or unpublished.

## Verification strategy

Every primitive and example application needs:

- parser tests proving unknown or misspelled keys are rejected;
- projection tests proving only enforceable data reaches Firestore;
- publish checks for cross-collection contradictions and live-data migration hazards;
- paired Firestore emulator tests: the intended write succeeds and the nearest attack fails;
- concurrency tests for claims, bookings, swaps, and batches;
- browser tests for public/member datasets, actions, realtime updates, and stale route protection;
- privacy tests proving sensitive collections cannot be listed or inferred through public projections;
- custom-view bridge tests for source validation, undeclared actions/datasets, replay, and version mismatch;
- rules expression/document-access budget measurements on the most expensive permitted declaration;
- recovery tests for partially completed deploy/publish and idempotent effects.

The ten example applications are release-level acceptance tests. A template is not considered supported
because its UI renders; its security, race, privacy, and offline-host guarantees must also pass.

## Known limits and design risks

### Firestore rules complexity

Rules functions are expanded and requests have a finite expression budget. Every new generic predicate
increases the cost of every app. New actor, validation, and atomic-operation vocabularies must be bounded
and measured rather than designed as open maps with unlimited depth.

### Query and index growth

Arbitrary view filters and sort combinations can require an unbounded set of composite indexes. Named
datasets need a restricted query grammar, a publish-time index plan, or both. Client-side filtering is
acceptable only after a bounded authorized read and must never be described as access control.

### Shared project blast radius

Applications share Firebase project quotas, billing, rules deployment, and index space. Per-application
namespaces provide authorization isolation but not quota or deployment isolation. Usage budgets,
observability, abuse protection, and eventual project partitioning need an explicit operational plan.

### Projection consistency

Public mirrors improve privacy and query cost but introduce staleness. Every mirror declares its
authority, update path, repair path, and safe direction of drift. A stale projection may degrade display;
it must not allow an invalid authoritative write.

### Custom-view governance

Sandboxing prevents credential access but does not make arbitrary presentation harmless. Public custom
views need a restrictive CSP, payload caps, protocol versioning, and visible provenance. Declarations
remain the review target for business behavior.

## Definition of platform richness

The platform is rich enough for this phase when:

1. all ten example applications can be expressed without application-specific engine or server code;
2. their important guarantees are enforced by rules, atomic Firebase operations, or named audited
   platform effects—not by presentation;
3. a reviewer can determine public data, actors, workflows, effects, and realtime datasets from the
   declarations alone;
4. every template is pure data and can be forked into a new empty application;
5. unsupported requirements such as secret ballots are refused explicitly rather than approximated;
6. new application ideas can normally be described as combinations of existing primitives, and a genuine
   gap produces one reusable vocabulary proposal instead of one vertical code path.
