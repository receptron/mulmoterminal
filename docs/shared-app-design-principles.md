# Declarative Shared Application Design Principles

## Purpose

MulmoTerminal shared apps are applications built from committed declarations, not application-specific
backend programs. An author describes the data, policies, workflows, views, and permitted effects. The
platform interprets that description using Firebase Authentication, Firestore, Security Rules, and a
generic browser runtime.

The central principle is:

> A shared app may declare behavior, but it may not introduce its own server-side executable code.

This is not merely an implementation preference. It is the property that makes an AI-generated app
small enough to review, safe enough to publish, and independent of the author's computer after
publication.

"No server-side code" means **no per-application server code**. MulmoTerminal and MulmoServer are
platform software, Firestore Security Rules are shared infrastructure, and the platform may expose
fixed, audited capabilities such as email delivery. An app can select and configure those capabilities,
but it cannot upload a handler, Function, package, or arbitrary program to run with trusted credentials.

## The application is a declaration

One repository defines one application. Its durable definition consists of:

- `app.json`, which declares application identity, membership, collection policy, and public access;
- collection schemas and their agent instructions under `.claude/skills/`;
- declarative views and, when necessary, sandboxed presentation HTML;
- references to platform-provided effects such as an email template.

Schemas, policies, and views are committed to Git. Application records are not: they live in Firestore
under the deployed application identity. A clone therefore carries the application design without
silently copying its users, permissions, or data.

The repository is both:

1. instructions that teach an agent how to work with the application; and
2. the definition from which the non-agent web application is built.

These must remain two interpretations of the same source, not parallel implementations that can drift.

## Architecture

```text
 committed repository
 app.json + schemas + views
             |
             | check / deploy / publish
             v
 MulmoTerminal control plane
 parser + linter + projector + migration gates
             |
             v
 Firebase application data plane
 Auth + Firestore documents + Security Rules + Storage
             ^
             |
 MulmoServer runtime shell <----> sandboxed view
 Firebase identity and writes       rendering and user intent only
```

The responsibilities are deliberately separated:

- **The repository is the source.** It contains reviewable intent.
- **MulmoTerminal is the control plane.** It validates, stages, publishes, and reports partial failure.
- **Firebase is the data plane.** It stores records, distributes realtime changes, and atomically applies
  writes.
- **Firestore Security Rules are the enforcement plane.** They decide whether a direct client operation
  is valid even when the client is malicious.
- **MulmoServer is the runtime shell.** It authenticates the visitor, reads declared datasets, performs
  declared operations, and renders the result.
- **A custom view is untrusted presentation.** It receives only declared data and can request only
  declared actions. It never receives Firebase credentials or a Firestore handle.

The author's machine and MulmoTerminal server are in the build and publication path, not the public
application's execution path. Once published, turning off the author's machine must not stop the app.

## Principles

### 1. Intent is data, not code

Application behavior is expressed through a finite vocabulary: identity strategies, roles, row scopes,
state transitions, submission windows, gates, relationships, atomic operations, projections, views, and
effects. New application categories should normally be new combinations of this vocabulary.

A feature named after one business is a warning sign. `assignee`, `schedule`, `state machine`, and
`resource claim` are platform concepts; `salon workflow` is a template made from them.

### 2. Security is enforced below the UI

Client validation improves error messages but grants no authority. Custom HTML, standard forms, the
MulmoTerminal collection UI, and hand-written Firebase clients must all meet the same Firestore rules.

Anything described as a guarantee must identify its enforcement mechanism. If a view merely hides a
button or filters a record after reading it, the behavior is presentation, not security.

### 3. Use document identity for uniqueness

When an invariant means "only one," encode the contested identity in the Firestore document ID whenever
possible:

- one response per user uses the user's UID;
- one vote per user and question uses UID plus question ID;
- one booking per slot uses the slot ID;
- one active claim per asset uses the asset ID.

Firestore can atomically decide whether that document already exists. A separately stored field does
not provide the same uniqueness guarantee.

### 4. Make atomicity part of the declaration

Some invariants span documents. A booking and its public availability mirror, or a status transition and
its email request, must be one batch. Security Rules use `getAfter` or `existsAfter` to verify the state
that will exist after the complete atomic operation.

The declaration must say which writes form one operation. Accidental client ordering is not a contract.

### 5. Separate authority from projections

Every fact has one authoritative representation. Public mirrors, aggregates, availability rows, and
dashboards are projections of that authority. A projection must be either:

- derived by the reader from records it may read;
- updated atomically with the authoritative write and checked by rules; or
- maintained by a fixed platform capability with a documented consistency model.

A mirror must never become a second, independently editable truth. If temporary drift is possible, the
safe direction of drift and the repair mechanism must be explicit.

### 6. Split data at privacy boundaries

Firestore reads whole documents; rules cannot reveal selected fields. Data with different visibility
belongs in different documents or collections.

For example, a public availability record may contain a slot, time, resource, and state. The associated
booking containing a customer's name, address, phone number, and notes must remain private. Removing
fields in the browser after reading them is already a disclosure.

### 7. Workflows are state machines, not button handlers

A workflow declares:

- the field carrying state;
- permitted initial states;
- permitted transitions;
- which actors may perform each transition;
- fields each actor may change in each state;
- effects bound to an actual transition.

The rules bind writers as well as public submitters. An owner or editor does not bypass record integrity
merely because they have broad operational access.

### 8. Realtime is a dataset property

A view declares the datasets it consumes and whether each is live. The runtime owns Firestore queries
and subscriptions and sends snapshots or patches to the view. This bounds cost, makes access reviewable,
and prevents generated HTML from inventing queries.

### 9. Presentation may be flexible; truth may not move into it

Standard declarative views should cover common semantic shapes such as forms, tables, boards, calendars,
schedules, ballots, and dashboards. Sandboxed HTML is the escape hatch for presentation that those views
cannot express.

Custom HTML may choose layout, interaction, and visualization. It may not define authorization,
validation, state transitions, uniqueness, private queries, or side effects. If reviewing the declarations
no longer explains what the app can do, business truth has leaked into presentation and the design has
failed.

### 10. The platform vocabulary is finite and versioned

All apps share a static rules engine. A declaration may select only capabilities understood by the
deployed rules and runtime. Unknown capabilities fail closed, and publish checks runtime/rules capability
versions before exposing an app.

Adding a primitive is therefore a platform change, not an application deployment. It requires schema
parsing, semantic checks, published projection, rules, runtime behavior, tests, and a compatible rollout
order.

### 11. Git is the governance system

The useful property of a declaration is not just that it is shorter than code. It can be reviewed as a
meaningful diff:

- who gained access;
- which records became public;
- which state transition became possible;
- which fields a visitor may submit;
- which external effect may happen.

Deploy stages the exact declaration for the roster. Publish promotes what was staged, records provenance,
and opens public authorization last. Rollback and audit use ordinary commits and pull requests.

### 12. Fail closed and explain early

Security Rules often reduce a mistake to `permission-denied`, which is safe but difficult to diagnose.
The parser, semantic linter, deploy gate, and publish gate must detect contradictions before they reach a
visitor. A declaration that cannot be enforced exactly must be refused rather than approximated.

Every denial path in rules tests needs a corresponding success path. A rule set that denies everybody is
not evidence that the intended policy works.

## Four classes of execution

Every platform primitive belongs to one of four classes. Its documentation must state which class gives
it authority.

| Class | Mechanism | Examples | Guarantee |
|---|---|---|---|
| Local invariant | One document plus Security Rules | ownership, allowed fields, state transition, deadline, immutable record | synchronous and authoritative |
| Atomic invariant | Firestore transaction or batch plus `getAfter` / `existsAfter` | booking plus availability, transition plus mail request, resource claim | all writes commit or none do |
| Read model | realtime client derivation or constrained projection | calendar, queue rank, dashboard, availability grid | authoritative only to the extent documented by its source and consistency model |
| Platform effect | Fixed audited service selected by declaration | email, push, scheduled materialization, private aggregate, webhook | no app code; semantics owned by the platform capability |

The first three should be preferred. A platform effect is justified when the work needs secrets, private
cross-record computation, time without an active client, or communication with an external system.

## Admitting a new capability

A proposed primitive belongs in the platform only when all of these questions have answers:

1. Which application-independent behavior does it represent?
2. What is its authored syntax?
3. What Firestore documents are published from it?
4. What exact mechanism enforces its guarantees?
5. What can a malicious client attempt, and why does it fail?
6. What data becomes readable to each audience?
7. Is the operation local, atomic, derived, or a platform effect?
8. What are its Firestore expression, document-access, size, index, and billing costs?
9. How does an older rules/runtime version treat it?
10. Which positive and negative emulator scenarios prove the contract?
11. Can at least two meaningfully different application types reuse it?

If the last answer is no, the proposal is probably an application-specific feature or a template concern.

## Explicit boundaries

The declarative platform should say no when it cannot provide the required guarantee. In particular:

- Firestore rules cannot count arbitrary matching documents or run general queries.
- Firestore rules cannot mask fields within a readable document.
- A private realtime aggregate cannot be computed by a client that may not read its source rows.
- Secret ballots require a trusted anonymizing capability; hiding voter identity in the view is not enough.
- Payments, signed webhooks, and third-party credentials require fixed platform effects.
- Recurring or delayed work cannot depend on a visitor or the author's computer remaining online.
- Generated HTML is never a trusted enforcement or secrets boundary.
- Arbitrary uploaded server code, packages, and user-defined Functions are outside the platform model.

These boundaries do not make the platform less declarative. They preserve the meaning of every guarantee
the declaration claims to provide.

## Product consequence

The platform becomes richer by widening its reviewed vocabulary while keeping each application narrow.
Templates demonstrate combinations; they do not extend the engine. If creating a template requires a
business-specific code path, that is evidence of a missing reusable primitive—or a requirement that
should remain explicitly unsupported.

The concrete application targets and capability work are tracked in the
[shared-app platform enhancement plan](../plans/shared-app-platform-enhancements.md).
