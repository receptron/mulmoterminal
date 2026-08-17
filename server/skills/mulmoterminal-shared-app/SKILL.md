---
name: mulmoterminal-shared-app
description: Build something several people use together — a survey, a sign-up sheet, a booking form, a shared list, a form on a link — where the answers are kept in one place rather than on this machine. Use when the user asks for anything other people will fill in or read, and when they later say show it to someone, invite an address, publish it, or take it down. Turns the request into a shared app in this repository and drives publish / unpublish. Works in whatever language the user writes in.
---

# Something other people use

A request like "make a survey for my talk", "I need a sign-up sheet", "let people book a slot",
"a form I can send a link to" is asking for a SHARED APP — a thing that lives on the web, keeps
its answers in one place, and can be handed to people who do not have this repository or this
machine.

**Do not offer a printable page, a Google Form, or a stand-alone HTML form as the answer.** They
are what this looked like before there was anywhere to keep the answers, and each of them leaves
the user to solve the actual problem — where the responses go — by themselves. Offer them only if
the user turns this down.

## What a shared app is

- **One repository is one app.** The folder this session is open in becomes the app; its
  declaration is `app.json` at the root.
- **The definition is committed; the answers are not.** Schemas and views are files in the
  repository. Records live in the app's cloud store, so everyone sees the same rows.
- **Who may do what is a list of email addresses** in `app.json`. Inviting somebody is adding a
  line and publishing — they need no account here and no repository.

## Start from a template when one fits

Four shapes are written out in full — declaration, schemas, and the reasoning behind each key:

- **[templates/salon.md](./templates/salon.md)** — a request that a NAMED PERSON approves, and only
  their own (a salon's bookings, interviews, repairs, review assignments). This is what `assignee`
  is for.
- **[templates/gym.md](./templates/gym.md)** — **first come, first served**, with a waiting list and
  a per-class opening time (a gym class, a workshop, a slot booking). This is what `stampField` and
  `window.fromField` are for, and it explains why the capacity lives in the VIEW and not in the
  rules.
- **[templates/survey.md](./templates/survey.md)** — **collecting answers**, with nothing to run out
  of (a survey, a quiz, an application form, a sign-up with no cap). The shortest declaration of the
  four, which is why it is the one that ships with no way to READ what it collected — so it is
  written around the `member` page, and it spells out the three-way trade above.
- **[templates/meeting-room.md](./templates/meeting-room.md)** — a bookable unit you can LIST IN
  ADVANCE, taken on the spot with no approval (a meeting room, a desk, equipment on loan, a parking
  space). This is what `idFrom: "field"` and `mirror` are for, and it is the one that spells out who
  refills the slots, and what a cancellation does NOT do.

Read the matching one before writing `app.json` by hand. All four are checked against the real
publish gate by this repository's tests, so what they show is what publishes — and they spend most
of their length on the traps, which is the part you cannot recover by guessing.

## The path

Say what you are doing in the user's words ("作っています", "みんなが見えるようにしました"). The
words below are for you, not for them: an author does not need to know what a `cid` is.

### 1. Start the app

`manageSharedApp` with `action: "init"`, and `name` (and `slug`, if you have one worth wanting).

**Do not compose `app.json` yourself.** The declaration names its owner by EMAIL and it has to be
the address this machine is SIGNED IN with — you cannot read that, and the address the user tells
you is the one that fails at publish. `init` writes it, generates the `aid`, and refuses if the
repository already declares an app.

`init` also TAKES the `aid` on the server before it writes the file, so it needs a connected
session and reports a refusal instead of leaving a half-started app. That is not bookkeeping: the
id lives on a shelf shared by everyone using this deployment, `app.json` is meant to be committed,
and an id that is written down but not yet taken can be taken by whoever reads the file first — and
an app id can never be freed. If the reservation is refused, nothing was written and `init` can
just be run again.

`slug` is the name in the URL people will be given. Take it from what the thing IS
(`aug-talk-survey`), lowercase with hyphens. It is a wish: if it is taken, a number is appended and
written back. **`init` RESERVES it** along with the app id, so the address is fixed from the start —
and the reservation can never be freed, which is why it follows a name the user wanted rather than
one you invent. The name resolves for the app's own roster immediately (`/m/{slug}`) and for
everybody when you publish.

The file is an ordinary committed declaration afterwards — you may read it, and the user may edit
it in a pull request. What you should not do is REWRITE it: `invite` changes one roster entry, and
`check` tells you whether what is there would publish.

#### The repository is a CLONE of somebody else's app

`manageSharedApp` with `action: "fork"` — not `init`, which refuses here, and above all not by
editing `app.json` yourself.

A cloned repository already carries a declaration, and the schemas beside it are exactly what the
user cloned it FOR. `fork` mints a new `aid`, makes the signed-in address the only member, and
carries `collections` and `public` over unchanged. It does not touch `.claude/skills/`.

The signals are a user saying this is a clone, someone else's address in `members`, or `init`
telling you an app is already declared. Ask for a `name` and a `slug` before you run it — the
cloned app's URL name is deliberately NOT carried, because kept it would be honoured as a wish and
come back as `their-name-2`, which is a name nobody chose.

What the user must be told, in their words: the app they cloned is untouched, and **its answers do
not come across.** They are getting the same form, empty. And the people on the old roster are not
on theirs.

`fork` refuses when the signed-in address already owns the app — that is not a clone, and forking
it would abandon the existing app and every record in it.

### 2. Write the collection

One collection per kind of record — a survey has one (`responses`), a booking app might have two
(`bookings`, `services`).

**A NEW collection is created by writing the files**: `SKILL.md` and `schema.json` under
`.claude/skills/<slug>/`. `putSchema` is EDIT-ONLY and refuses a collection that does not exist
yet ("unknown collection … create it by writing SKILL.md + schema.json"), so do not try to create
one with it. Use it afterwards, to CHANGE a schema.

**Read the shape first**: `manageCollection` with `action: "schemaDocs"`, and
`topic: "Shared storage (firestore)"` for this part specifically. The shape is not what a
reasonable person guesses — `fields` is an OBJECT keyed by field name (not a list), `primaryKey`
and `icon` are required, and the key for a field's human name is `label`. A schema in the shape
you would design does not parse, and a collection whose schema fails validation is **skipped
silently**: nothing errors, it simply never appears.

That topic covers the STORAGE key and not the field types, and the two are asked for separately:
`topic: "Field types"` is where a `datetime`'s exact format lives, and it is the one a seeded
collection gets wrong (step 2b).

The one thing that differs from an ordinary collection:

```json
{ "storage": { "type": "firestore" } }
```

That is what makes the records shared. Declare no `dataPath` beside it — exactly one of the two.

**The app already has its `aid`** — `init` wrote it in step 1 — so a shared collection you write
correctly is discovered straight away. If `getSchema` says "unknown collection" after you have
written the files, that is the schema FAILING VALIDATION, not something publishing will fix: read it
back against `schemaDocs` (`primaryKey` naming a field flagged `primary: true`, `icon` present,
exactly one of `dataPath` / `dataSource` / `storage`). Publishing past it produces an app with the
collection missing and no error anywhere.

**Everything in the folder is shared or nothing is.** Do not mix a shared collection and a local
one in an app's repository.

### 2b. Load the inventory, if the app needs rows before anybody arrives

Some apps have nothing to show until rows exist: bookable slots, a timetable, a menu of services.
Nothing generates them — the platform runs no code of its own — so they are written with
`manageCollection` `putItems` before the app opens, and topped up later (the meeting room's
[枠の補充](./templates/meeting-room.md) covers the weekly refill task).

**Prove ONE batch before you generate thousands.** Write a single day, read it back with
`getItems`, then run `check` (step 4b). `putItems` REFUSES a row missing a required field or
carrying an unknown `enum` value (and, under `mode: "create"`, an id that already exists) — that is
what it refuses, and it is not everything it checks. The SHAPE of a typed value (a real date, a
numeric `number`, a `datetime`'s exact format) is **written and reported**: the answer carries a
`lint` block beside `written`, and the same rows are **refused at publish**. So an empty `rejected`
is not proof — 720 accepted rows are not 720 valid rows — and one day first is one round trip
against one regeneration per batch.

**That proof needs a session.** `check` answers offline, and offline it does NOT read the records —
it says so in as many words ("the live records were NOT scanned"). A `check` that has not scanned
them proves nothing about the batch you just wrote, so connect first, and read what it says about the
records. Exactly one answer is a proof: the scan RAN, over every shared collection in this
repository, and found nothing.
Everything else is repaired first, and the rest are not degrees of that one — they are different
repairs, and more than one can be reported at once (a collection that could not be read does not
stop the others being scanned):

- **rows that do not fit** — named, and a MIGRATION. `confirm` at publish is the decision to break
  them for everybody, not a way past this.
- **UNKNOWN** — a collection could not be READ, so nothing at all is known about the rows behind it.
  That is access, not data.
- **not scanned** — the line says which: no session, or an `app.json` that does not parse.

**`datetime` is a wall clock, not an instant.** `YYYY-MM-DDTHH:MM`, seconds optional, **no timezone
suffix**. `new Date(...).toISOString()` is the reflex and it is wrong twice: the `Z` is refused at
publish, and the time SHIFTS into whatever timezone this machine is in — a Tokyo court's 08:00
becomes `15:00Z` when the script runs in Seattle, and `16:00Z` for the same 08:00 in winter, because
the offset moves too. Had the format been accepted, the app would have published with every row
seven hours out — eight, on the dates the other side of the change. Build the string from its parts
(`` `${dateKey}T${hh}:00` ``). A `stampField`'s `…Z` (step "limited number of places") is the one
`datetime` shaped that way (nine fractional digits), and the rules write it — no script does.
`putItems` flags the wrong shape in `lint` as it writes, so the reflex is caught on the first batch
rather than at publish — if you read the answer.

**Generate with a deterministic script, and do not write the rows out yourself.** Dates, month ends
and daylight saving are what an LLM gets wrong, and a few hundred inline rows are tens of KB emitted
a token at a time. Have the script write a bare array of records to a JSON file under the workspace
and pass its absolute path as `putItems`' `itemsFile` — 1000 rows and 8 MiB per call, and an
over-limit call writes nothing at all.

**Pass `mode: "create"`.** The default REPLACES a whole record, so a re-run — a retry, a refill that
overlaps what is already there — silently overwrites fields nothing regenerated, and reading the ids
first does not save you: another run or a hand edit can create the same id in the gap between the
read and the write. `create` has the host refuse a colliding row instead.

**And then read `rejected` AND `lint`.** They answer different questions, and only one of them is
about rows that failed to land. `lint` appears beside `written` when a row WAS written and its
values are the wrong shape — a `datetime` that is an instant, a `date` that is not a real day, a
`number` holding text — with `total` (every flagged row) and `rows` (the first ten, as
`{ id, problem }`). Those rows are in the collection and publish will refuse them, so a `lint` block
is the generator to fix and the batch to rewrite, now rather than after the other 719. No `lint`
key at all is the clean answer, and `total` — not the length of `rows` — is how many there are.

Rewriting them is the one place `mode: "create"` is the wrong mode: the rows exist, so `create`
would refuse every one of them. Fix the generator, regenerate the SAME ids, and send them with the
default `upsert` — the script produces the whole record, so replacing it whole is exactly right, and
it is only safe here because these ids are the ones you just wrote in this same batch.

`rejected` is the other half. It is not a count and not only about collisions: `putItems` returns
`{ written, rejected }` with one `{ id, problem }` per refused row, and the `problem` is as likely
to be a missing required field or an unknown `enum` value as an id that already existed. So go
through them: every `problem` that is not "already exists" is a row that was NOT written, and it
needs fixing and re-sending — just that row. A refusal of the whole CALL (over the row or byte
limit) is a different thing and does not arrive as `rejected` at all: no `{ written, rejected }`
comes back, nothing was written, and the fix is to split the file rather than to re-send rows.

And "already exists" says exactly that much: the id was there when the write ran. It does not say
who put it there — an earlier attempt of this same refill, another run, a hand edit — and it does
not say the stored row is the row you just generated. `create` cannot correct it either. If that
matters — a regeneration that changes what a slot should say — read those ids back with `getItems`
and compare before calling them done.

### 2c. Decide the ENTRANCES. An app with one page is usually unfinished

Three entrances exist, and **only the ones written into `views` are real**:

| `audience` | address | who opens it |
|---|---|---|
| `public` | `/a/{slug}` | anybody the app admits |
| `member` | `/m/{slug}` | anybody holding a role in `members` |
| `participant` | `/p/{slug}` | anybody LISTED in `members`, seeing their own row |

**An app that collects records gets a `member` page, and you do not ask first.** Without one, the
only way to read what was collected is the collection pane on the author's own machine — so the
answers exist but nobody can reach them from a phone, and the author finds this out after handing
the link around. It is not a feature the author chose to skip; it is one nobody mentioned. Write
it, and say in their words what it is ("集まった回答はここで見られます").

This is the step that gets missed. The reason is worth knowing: an app built from a template
inherits that template's pages, while a form-shaped app is written from scratch — so the apps with
no member page were the ones nobody had a sample for. Every template now shows one, and
`templates/survey.md` is the one for a form.

**The participant page is a real question, and it is not "do you want one".** Ask
**whether the people who answer need to see their own answer later**, and know what the answer
costs before you offer it:

- `/p/{slug}` is readable only by people **on the roster**. A stranger who answers a public form is
  not on it, so a participant page renders for nobody unless the author invites them one by one.
- A **generated** public form (an app declaring no `public` view) already shows a visitor their own
  answer back, roster or not. **Writing a custom public page removes that** — the custom page
  replaces the generated form, and the data a public page may be handed is limited to
  `public.read`, which the submitted records can never be in.
- So "anyone may answer" + "a public page I wrote myself" + "answerers can see their answer" is
  three things, and **only two of them are available at once**. Say so while the shape is still
  being chosen, not after the page is written.

The rules are not the obstacle here and do not need working around: a submitter may already read
their own row (`emailField`, or `idFrom: "auth.uid"`). What is missing in that third case is a page
they are allowed to open. `participantRead` does not fix it.

### 3. RUN THE PAGE. Not reading it — running it.

There is no step between writing the app and publishing it. `deploy` — which wrote a copy only the
roster could see, at `/staging/{aid}` — is gone: an app EXISTS from `init` (its id and its URL name
are taken, and its records can be written) and everything else is written by `publish`. So this
step is the only thing standing between what you wrote and what everybody sees.

**A page you have not seen work does not work.** Everything a view does that is broken by the
sandbox fails the same way: nothing is drawn, nothing throws, and the HTML reads perfectly. You
cannot find these by looking at your own code, because the code is not wrong — the frame it runs
in is stricter than the one you pictured. The only thing that finds them is pressing the button.

**You can press it yourself: `manageSharedApp` with `action: "preview"`.** It loads every page the
declaration names in a real headless browser — the same parent, the same
`sandbox="allow-scripts"`, the same CSP, the same private-port handshake — hands it the app's real
records, and presses each control on a freshly loaded copy of the page. It runs to a budget and
**says what it left out** — pages it did not run, controls it did not press — so read those counts
rather than reading "ran 6 pages" as "ran the app". What comes back is what
you would otherwise have to be told by somebody looking at a screen: a page still on its loading
state (quoted, in the author's own words), a `<form>` in the live document, a button that reached
nothing, a submission the declaration refused. **Run it after writing or editing any view, and
again before you publish.** A page that has never been through it is a page nobody has run.

**By default it writes nothing — and that is the mode to use after every edit.** It still loads every
page, presses every control and reports everything; submissions are simply reported and left
unwritten. Reach for this one freely.

**`confirm: true` lets it write, and you must ASK THE USER FIRST.** When a press produces a
submission, the run then makes a real record in the real app and removes it in the same breath — so the report can tell you what the
**deployed rules** say, which is the one answer an author most wants before publishing and the one
no amount of reading the declaration produces. Each line says whether the record went in, why it
was refused if it was, and **whether the removal succeeded** — a booking left standing occupies a
real slot, so never skip that part when reading the report back.

**Only a submission the runtime marked as caused by the click is written.** A page can submit from a
timer, from `onState`, or from a promise settling, and no amount of measuring before and after a
press tells those apart — so the proof comes from the runtime injected into the page, which is in
the same realm as the event and knows whether `submit()` was called while a real click was being
dispatched. Everything else is reported as **withheld** and nothing is written for it.

**An `async` click handler that awaits real work is withheld, and this is the one that will confuse
an author.** These two are identical in shape and land on opposite sides:

```js
button.onclick = async () => { await Promise.resolve(); view.submit(...) }  // written
button.onclick = async () => { await validate(); view.submit(...) }         // WITHHELD, if validate yields
```

The second resumes in a later task, and a later task is not the click however fast it was. So a save
that checks something first writes nothing in a headless preview. **Say that is the reason** — an
author told only "nothing was written" will go looking for a bug in a button that works.

An app pinned to `@receptron/sharedapp` older than **0.9.0** lands in `withheld` for every
submission — that runtime marks nothing, so the run writes nothing at all. It is not a fault in the
page.

**A control that saves from its own `change` handler — a checkbox, a select — is worse than
withheld: it is never exercised, and the report will not say so.** Two separate things:

- the run presses button-like controls only (`button`, `[role=button]`, `input[type=submit|button]`),
  so a page whose only save control is a toggle produces **no press at all** — and with no press
  there is no `withheld` line to read;
- while preparing the page the run ticks checkboxes and dispatches `change` itself, BEFORE the press
  window. A page that saves from that handler therefore submits outside any press, and the runtime
  would not mark it in any case (activation behaviour runs after the click's dispatch has ended).

So for such a page the report can look completely clean while the save path has never run. **Say
that plainly to the user rather than reading the silence as success**, and ask them to exercise the
toggle in the Collections pane.

There is also a **budget** on writes. Over it, a confirmation is declined rather than accepted, and
the run says how many — read that count before concluding every control was exercised.

**Why the ask, when the record is removed a moment later:** the removal is not the safety boundary.
While the record exists it is real — a rule, a function or an integration may act on it, a
notification may already have gone out — and the removal itself can fail (the report has a line for
exactly that, and in a first-come app a record left standing occupies a real slot). So say what it
will do and get a yes, the same as for `publish`. Run the default read-only preview as often as you
like; ask before the writing one.

So the report proves the page draws, the handshake completes, the records arrive, **a press reaches
the parent as a submission the declaration accepts**, and — for the presses that were written —
**what the deployed rules said**.

It also **tries to photograph each page**, and gives you the path for every one it managed. Open it
when the words leave the layout in doubt; that is the one thing prose cannot carry. A page with no
picture says why in its own line — the capture failed, or there was nowhere to write it — and that
is a fact about the run rather than about the page.

If no browser can be started it says so, and then the pane below is the whole answer rather than the
second half of it.

**The Collections pane's preview is the same thing with a person in front of it.** It is not a
convenience and it is not a rough approximation. Before it existed, an LLM wrote the page and it went to a public URL without
anybody ever having loaded it once — which is exactly how a sign-up form was published twice with
a Submit button that did nothing at all. So the preview runs **the same parent as
`/a/{slug}`** (`@receptron/sharedapp/view`, the code mulmoserver itself runs), with the same
`sandbox="allow-scripts"`, the same CSP, the same private-port handshake and the same confirmation
dialog. **It is deliberately not looser than production**: a preview kinder than the real page
would be a machine for producing "it worked on my machine".

**Ask the user to open it once the headless run is clean** — it is the half you cannot do, because
it puts a person in front of the page and lets them judge how it LOOKS, and because it exercises the
controls the headless run never presses (see the toggle case above). What it does NOT add is another
identity: the pane posts to `/api/shared-app/preview/submit`, which calls the same
`writePreviewSubmission` as the headless run, so **both write as the author**. Neither preview can
tell you what the rules would say to a visitor or a participant — only a real session as that person
does. In
the cell open on this repository: the **Collections pane** → the **"Preview the shared app"** button at the top → the
page appears, drawn from the working tree. Opening it reads only: nothing is written and no URL
name is taken.

**Accepting a submission there DOES write a real record**, as the signed-in author, into the live
app — the pane says so at the button and lists what it made with an Undo beside it. So it is a
real answer in the app's data, not a rehearsal: tell the user that before they press *Send it*,
and offer to remove it afterwards. Reaching the CONFIRMATION is what proves the page works;
accepting is only needed when you want to see the record land.

Ask them to confirm, in these terms:

- the page **draws its data** (a grid that stays on "loading…" means `ready()` was never called);
- pressing the **submit button raises the confirmation dialog**, with the right values in it (no
  dialog = the message never left the frame — a `<form>`, or a handler that never ran);
- the **error paths** say something: an empty required field, an unchosen option.

Do this **before publish** and again after any change to a page. If the user cannot look right now,
say plainly what was and was not checked: a clean headless run means the page draws and the button
reaches the parent, and it does not mean the write goes through.

**When something in the pane does not work, ask for the log rather than for a description.** At the
bottom of the pane is a count and a **"Copy what happened"** button. It holds the facts that exist
nowhere else on the screen: what the page submitted and what the parent REFUSED (a refusal is
answered on the port, so on screen it is a button that did nothing), what the frame reported about
itself (an uncaught error, a modal the sandbox ignored — `alert`, `confirm` and `prompt` do nothing
there and nothing on the published page), and **the deployed rules' own refusal** of a write that
was accepted. That last one is the half a headless run can never reach, and it is why "Missing or
insufficient permissions" arrives with the field it is about rather than on its own.

It is written in the same words `action: "preview"` uses, so read it the same way. It carries field
NAMES and never values, so it is not a substitute for asking what the user typed — with one
exception, marked `page text:` in the block itself. That is a string the PAGE wrote, so it can
contain anything the page put there, a value out of a record included. Treat it as the page's
words rather than as the host's, and do not repeat it back anywhere it does not belong.

**Read the tool's `warnings` back to the user too.** `check`, `preview` and `publish` all read the
pages the declaration names and report what one will probably get wrong — a modal call, a
`<form>`, an `onState` with no reachable `ready()` — as well as refusing a `path` that names
nothing. They are hints and they do not stop a publish: a page they are silent about can still be
broken, which is why they are not a substitute for the paragraph above.

**What the pane's preview does NOT prove**, so do not claim it: the write is made **as the author**, who may write anything in their own app, so a visitor's or a participant's
permission is untested and a page that works here can still be refused for the person it was built
for. Nobody else exists, so nothing is concurrent. And it cannot tell whether the rules a new
declaration needs have been deployed at all.

### 4. Invite

`manageSharedApp` with `action: "invite"`, `email`, and `role` (omit `role` to remove them). It
edits `app.json` and nothing else; the next publish is what makes it real.

| role | what they get |
|---|---|
| `owner` | everything, including publishing |
| `editor` | reads and writes the records |
| `viewer` | reads the records |
| `participant` | named on the roster, sees only their OWN rows |
| `assignee` | reads EVERY row, writes only the rows assigned to them |

`cid` narrows it to one collection instead of the whole app.

`assignee` is the one for "the stylist approves their own bookings, not a colleague's" — and it
needs two things or it silently grants nothing. It needs a `cid` (it cannot be app-wide: which
rows are yours is a per-collection question), and the collection needs
`collections.<cid>.assigneeField` naming the field that holds the member's ADDRESS. Not a `ref` to
a staff collection — a ref stores that record's primary key, and the rules can only compare an
address. `check` says so; publish refuses.

Addresses are written in lower case, because the rules compare one exactly and the sign-in token
carries a lower-cased address. An entry with capitals matches nobody, and once published nothing
says so — the person is simply refused everything. So `invite` lower-cases a NEW address, and a
roster edited by hand is checked before publishing: a key with capitals is reported as a problem
and the publish is refused until it is fixed (the exception is the address you are signed in with, which
is what the rules compare against whatever its case).

An address the roster already has keeps the spelling it has there, and that entry is changed in
place — `invite` never migrates a key or writes a second one beside it. If a hand edit has left two
entries for one person differing only in case, `invite` refuses and names them: merge them by hand.

### 4b. Check, whenever you have edited `app.json`

`manageSharedApp` with `action: "check"` runs the gate publish runs — the declaration, the
collections it names — and writes nothing. It needs no connection.

Use it after any hand edit, and before telling the user something is ready. The alternative is
finding out at publish, and a publish that refuses in the middle is where an agent starts editing
files to recover.

`check` READS the pages the declaration names — it refuses a `path` that names nothing and warns
about what one usually gets wrong. It does not run them. `action: "preview"` does (step 3), and
neither replaces the other: a page `check` is silent about can still be a page that draws nothing.

### 5. Publish, when the user asks to open it

Publishing is the one dangerous step: it changes what everybody outside sees, immediately. Do it
when the user asks for it in those terms, not as the last step of building.

**Do not publish a page nobody has run** (step 3). Publishing is immediate and anonymous: a
broken page is broken for everybody holding the link, and it stays that way until somebody
happens to press the button and tell you.

What being public MEANS is declared in `app.json`, and it is worth reading back to the user before
you publish. This is a survey anyone may answer once they sign in:

```json
{
  "collections": {
    "responses": { "submitOnly": true, "statusField": "status" }
  },
  "public": {
    "enabled": true,
    "read": [],
    "submit": {
      "responses": {
        "auth": "verifiedEmail",
        "emailField": "email",
        "createFields": ["name", "affiliation", "score", "comment", "email", "status"],
        "initialStatus": "submitted"
      }
    }
  }
}
```

Every line of that is load-bearing, and publish refuses the declaration without them:

- **`auth` must be `verifiedEmail`.** `none` and `anonymous` exist in the rules and are REFUSED
  here — a product decision, not an oversight. So "anyone with the link, no sign-in" is not
  something you can offer today: a respondent signs in with an email address. Say that to the user
  rather than promising anonymity and discovering it at publish.
- **`emailField` names the field their address lands in**, and it must be in `createFields`.
- **`submitOnly: true` is required** whenever the submission binds a record to its submitter. The
  record means "this person said this", and without it an owner or editor could write rows that
  carry that meaning without having earned it.
- **`initialStatus` needs `collections.<cid>.statusField`** and that field must be in
  `createFields`. It is NOT a hole: the rules pin the value to `initialStatus` on create, so a
  respondent can only write `submitted` — listing it is what lets the rules check it. What
  `createFields` must NOT contain is anything else you do not want them setting.
- **Only simple fields go in `createFields`**: `string`, `text`, `markdown`, `number`, `boolean`,
  `date`, `datetime`, `email`, and `enum` (whose choices travel with it). A `ref`, `table` or
  `money` field is refused — the public page reads the published form and nothing else, so it has
  no way to draw one — and so is anything the host computes (`derived`, `embed`, `backlinks`,
  `rollup`, `toggle`, `flag`), which is a value nobody may submit. Such fields stay in the
  collection; they are just not what a stranger fills in. `check` names any that slipped in.
- **`read: []`** — a survey lists nothing publicly. People answer; they do not browse the answers.

### If people are racing for a limited number of places

Two more keys, and one thing the rules cannot do. Read
[templates/gym.md](./templates/gym.md) before promising anything here.

- **The rules cannot count.** There is no query and no aggregate in them, so "only 8 people" is not
  something a declaration can enforce — at all. What works is to stop storing the capacity and
  derive it: order the rows by when they arrived, and the first 8 are in, the next 2 are waiting.
  Promotion then costs no write at all — the 9th becomes the 8th the moment the 3rd cancels — and
  a rush at opening time has nothing to contend over. **Say to the user that the limit is drawn,
  not enforced**, and that nobody is emailed when they are promoted.
- **`stampField`** names a `datetime` field the rules pin to the server clock on create and freeze
  afterwards. Without it the order is whatever each submitter typed, and the queue is decoration.
  It goes in `createFields` (the rules refuse any key outside that list) and is NOT drawn as an
  input — the page fills it in.
  **A page receives it as `2026-08-15T23:05:54.605987654Z`** — UTC, nine fractional digits, `Z`.
  Stored it is a Firestore timestamp, but both hosts normalise at their read boundary, so a page
  never sees one. Lexicographic order IS chronological order, so **sort it with a plain string
  compare and do not put it through `new Date()`** — that keeps only milliseconds, and two
  submissions in the same millisecond then tie and fall back to the order they were read in. Ties
  at full precision break by document id, which every host reads in.
  It is also the ONE `datetime` shaped like that: a value you write yourself is a wall clock with
  no timezone suffix (step 2b), and `toISOString()` is refused at publish.
- **`window.fromField`** is an opening time that lives on ANOTHER record:
  `{ "ref": "classId", "collection": "classes", "field": "opensAt" }`. `opensAt` is a **number**,
  epoch millis, computed by whoever schedules the class — "three days before, at 08:00" is business
  knowledge, and the rules have no date arithmetic and no local time zone. A `datetime` there is a
  type error that denies every submission.
- **Ranking needs READING.** A submitter who can see only their own row cannot be told they are
  second. That means the members are on the roster (with `peerVisibility: "public"`), and everyone
  can see who else signed up. Ask before building it.

### If people are racing for ONE thing rather than for a place in a queue

A class has a capacity and the rules cannot count it, so the queue above is drawn rather than
enforced. **A slot is different: it is one thing, so nothing needs counting.** Put its id into the
booking's id and the second person to want it is writing a document that already exists — which is
an update, which the public submission path never allows. Firestore decides that atomically. Read
[templates/salon.md](./templates/salon.md) before building one.

- **`idFrom: "field"` + `idField`** make the record's id the value of one of its fields. That
  field cannot be changed afterwards, and the id it produced is what holds the slot.
- **`idIn`** is REQUIRED with it, and says which collection that id must be found in — with the
  state it must be in — `"idIn": { "collection": "slots", "where": { "field": "state", "equals": "open" } }`.
  Without it the id is any string a submitter likes, and the app quietly accepts bookings for
  things that do not exist. Publish refuses the declaration.
- **`window.untilField`** is `fromField`'s twin: a per-slot deadline, epoch millis on the same
  record. A desk that opens per slot and never closes is not a booking desk.
- **`mirror` (on the submission) and `mirrorOf` (on the collection)** are the two halves of the
  PUBLIC face. A booking carries a name and a phone number and Firestore cannot hide a field, so
  the public page must never read bookings — it reads the slot rows, whose `state` is a copy of
  "does a booking with this id exist". The rules accept the two writes only as one batch, in both
  directions. **Declare both halves or neither**; publish refuses one on its own.
- **`selfDelete`** (on the submission) names the statuses the person who booked may take their
  OWN row away from — the only thing that gives a slot back without the desk. Cancelling does
  not: the record's id IS the exclusivity, so a booking that is merely `cancelled` goes on
  holding the slot. Declaring this deletes the row instead, and the rules reopen the mirror in
  the same write, so a half-freed slot cannot exist.
  **What it spends is the record**: no history of who withdrew, and no `mail` can be bound to it
  (the queue rule reads the document after the write, and there is none). An app that wants the
  record kept names no status and sends its people to the desk. Say which one the user is
  choosing — it is not a detail they discover later.
  **Do not give a participant both.** `selfTransitions` to `cancelled` alongside
  `selfDelete: ["booked"]` reads as two ways to cancel and is a one-way trap: the transition
  lands the row in a status `selfDelete` no longer names, so the person has, with a documented
  bridge call, turned a slot nobody can free into staff cleanup. Declare one of them per
  collection — and remember an old published page still reaches whatever the declaration allows,
  so removing the button is not removing the move.
- **These five keys freeze once records exist.** `confirm` does not override that, because what
  breaks is not a visible schema mismatch — it is the exclusivity itself, silently, in an app that
  goes on working. Say so before an author starts renaming things.

### If a form is not enough to choose from

**Every page you write here goes through step 3 before it is published.** A view is code running
in a frame stricter than the one you are picturing, and its failures are silent — read the two
rules below, then have the user press the button in the preview.

A form ANSWERS something. Choosing from what is available — a stylist-by-hour grid — is not the
far end of a table, so an app may publish HTML pages instead. They are declared in `views`, one
entry per page, each naming **who it is for**:

```json
{
  "views": [
    { "id": "public", "audience": "public",      "path": "views/booking.html", "collections": ["stylists", "slots"] },
    { "id": "desk",   "audience": "member",      "path": "views/desk.html",    "collections": ["bookings", "slots"] },
    { "id": "mine",   "audience": "participant", "path": "views/mine.html",    "collections": ["bookings"] }
  ]
}
```

| `audience` | who reads it | where they go |
|---|---|---|
| `public` | anybody, signed out | `/a/{slug}` |
| `member` | anybody holding a role in the app — the front desk | `/m/{slug}` |
| `participant` | anybody on the roster, seeing their own row | `/p/{slug}` |

- **Hand these out ABSOLUTE, with `https://mulmoserver.web.app` in front.** Nothing is served
  from the machine this runs on, and there is no bare `/{slug}` — a path on its own is not
  something the person you are telling can open, and `/{slug}` is a not-found page. With a `slug`
  declared, `init` and `publish` print the whole address — say what they print. **Without one
  there is no address at all**, and they say that instead: an app may publish staff and
  participant pages while declaring no URL name, and both entrances need one.

- **The two are not exclusive.** An owner who also books is on both, and each address shows one
  face — so a staff member opening `/p/{slug}` sees their own booking, not the front desk. Write
  the participant page for everybody on the roster, not only for the people with no role.
- **`audience` is what decides who can read the page**, and it is a PLACE, not a filter: each one
  is published to a different document with a different rule. That is also why a staff page must
  not be declared `public` — the HTML itself carries the app's internal vocabulary (status names,
  review-note headings, how work is assigned).
- **`id` becomes the document the page is published at**, so it must be unique in the app and
  lowercase letters, digits and hyphens (`front-desk`). `config` is reserved. One audience may
  have as many pages as it needs — the front desk and the stock room — except `public`, which is
  published at one document and so may have only one.
- The path is **relative to the repository root** (`views/<name>.html`, one file, no
  sub-directories) — `app.json` is there.
- **It is not the host's custom view.** A page written against the collection pane reads
  `__MC_VIEW.token` and fetches its own data; a published page has neither and is handed its data
  instead. Publish refuses a file that mentions `__MC_VIEW`, because otherwise it would render
  blank with nothing to say why.
- **`collections` is declared, not inferred.** A view fed the wrong data renders perfectly and
  draws an empty page, which is the one failure nothing reports. Publish refuses a `public` page
  fed a collection outside `public.read`, and a `participant` page fed one a participant cannot
  reach at all (neither in `participantRead` nor their own row through `public.submit`).
- **`submit` carries STRINGS and nothing else.** A number, a boolean or a nested object in
  `values` is not read as a partial submission — the whole message stops being one, and the view
  is answered `not-a-submission`, which names no field. `attendees: 3` breaks a booking; `"3"`
  writes it. The reason is not fussiness: the generated form path sends strings, and the rules
  compare stored values without coercing, so a number would write a record that differs BY TYPE
  from the identical-looking one a form wrote.

  **The schema does not have to change for that.** A submitted value is stored exactly as it
  arrives — nothing coerces it on the way in, and the rules check no field's type — while a
  `number` field accepts a NUMERIC STRING at both check tiers (`"3"` passes; only `"abc"` is
  reported, and only under `strict`). So `attendees: "3"` against `"type": "number"` writes and
  validates. What it does affect is anything that later READS the value expecting arithmetic —
  sort it, add it up, and it is a string.
- **A submission is CONFIRMED outside the frame, so do not narrate it as sent.** The parent draws
  the values in a dialog of its own and writes only when the visitor accepts — so between the
  click and the answer, nothing has been sent and the promise is simply waiting for a person. A
  page that says 送信中… there is describing a step that has not happened, and reads as stuck.
- **`alert`, `confirm` and `prompt` DO NOTHING.** (`check` and `publish` warn when a page looks
  like it calls one, and go through anyway — the check reads the page without parsing it, so it
  is a hint, not a verdict. A page it stays quiet about can still be wrong.) Every view — public, staff, participant — is
  rendered in `sandbox="allow-scripts"`, and without `allow-modals` the browser ignores the call
  and logs *"Ignored call to 'prompt()'. The document is sandboxed, and the 'allow-modals'
  keyword is not set."* Nothing throws, so a page that asks for a name with `prompt` submits an
  empty one, or looks like a button that does nothing. Ask with an `<input>` in the page and
  answer in an element of its own; that is the only thing that works here.
- **A `<form>` CANNOT SUBMIT — draw a `<div>` and a `<button type="button">` instead.** (`check`
  and `publish` warn about a `<form>` for the same reason they warn about a modal, and go through
  anyway.) The frame is `sandbox="allow-scripts"` with no `allow-forms`, and the browser blocks the
  submission **before** it fires the `submit` event — so an `onsubmit` handler never runs at all,
  `e.preventDefault()` on its first line included, and the only sign is *"Blocked form submission
  to '' because the form's frame is sandboxed and the 'allow-forms' permission is not set"* in a
  console nobody is reading. What the author sees is a Submit button that does nothing. The same
  block takes Enter-in-a-text-field with it, and `required` stops working — constraint validation
  is part of submitting a form. So: no `<form>` element at all, a `type="button"` whose **click**
  calls `submit(...)`, and every check the page needs written out in that handler.
- **What the visitor CHOOSES belongs in an `<input>`, not in a variable a click sets.** A page that
  collects answers by clicking (buttons that toggle, a `Map` filled on click) works in front of a
  person and is **untestable by `preview`**: the harness mounts a FRESH document for every control
  it presses, so anything an earlier press put in a variable is gone before the Submit button is
  reached — the run then reports a submit that sent nothing, or never reaches Submit at all,
  because the choice buttons exhaust its six-press budget first. Radios, checkboxes and `<select>`
  are FILLED by the harness rather than pressed, which leaves Submit as the only control and gets
  the write actually exercised. (Native inputs also draw their own selected state; a button
  carrying only `aria-pressed` shows a sighted visitor nothing after the pointer lifts.) Buttons
  are right for a control that ACTS — one that submits, cancels, filters.
- The view asks for writes through `window.__MC_APP_VIEW` — see the next section.
  (`window.__MC_PUBLIC_VIEW` is the same object under its former name, kept for one release.)
- **`public.view` is the older spelling** of the first row above. It still works and normalizes to
  `id: "public"`. Declaring both `views` and `public.view` is refused — write one.

**Say this out loud when an author adds a `member` page.** What the public page is handed is data
any stranger could already fetch, so a view carrying it off costs nothing. A members' page is
handed the real records — names, phone numbers, who is coming at 3pm — and, for every collection it
can change, the addresses of the colleagues who may change it. The platform does
not stop an owner's own page from moving an owner's own data, and does not pretend to; the author
should know that is what they are writing.

Publish writes the pages the way it writes schemas, into the tier each audience may read. A page
dropped from `views` is DELETED rather than left behind: the tier is readable by everyone it
admits, forever, so not writing it again is not enough.

### What a page may WRITE

**`transition`, `assign` and `withdraw` need the runtime deployed, and they do not fail softly.** `submit` has
been on the bridge since public forms; these two and the `/p/{slug}` entrance arrived with the
shared-app runtime, and on anything older they are simply ABSENT — a page calling one throws
`__MC_APP_VIEW.transition is not a function`, which in an iframe looks like a page that does
nothing. So before offering the author these controls, check that the runtime serving `/m/` and
`/p/` has them.

Draw from `viewer.can` (below) rather than from the method's existence, and this is handled for
you: an app published before the runtime landed carries no `writers` in its projection, so every
capability comes back empty and the page draws a read-only view of itself. It stays that way until
the app is published again — a projection without those lists cannot tell a receptionist from an
observer, and refuses rather than assuming.

Four calls, and a page cannot name a field in any of them:

```js
await window.__MC_APP_VIEW.submit(cid, values);          // a new record
await window.__MC_APP_VIEW.transition(cid, itemId, to);  // approve, reject, cancel
await window.__MC_APP_VIEW.assign(cid, itemId, address); // hand a row to a colleague
await window.__MC_APP_VIEW.withdraw(cid, itemId);        // take the reader's OWN row away
```

`withdraw` names no destination because nothing moves — the row is deleted, and where the
collection has a `mirror` the parent reopens it in the same batch. It works only where
`selfDelete` names the row's current status, only on a participant's page, and (like the two
above) only on a runtime that has it.

**Call `ready()` once, after registering `onState` — nothing arrives until you do.** The parent
holds the app's data until the view answers the handshake, so a page that listens and never says
`ready()` waits on a send that was never made: it draws its loading line and stays on it forever,
with no error at either end. (`check` and `publish` warn when a page registers `onState` and
calls no `ready`.)

```js
window.__MC_APP_VIEW.onState((data, viewer) => { draw(data); });
window.__MC_APP_VIEW.ready();   // ← without this, the callback above never fires
```

Each returns `{ ok, error }`. The page is told **who the reader is and what they may actually do**
in the second argument to `onState`:

```js
window.__MC_APP_VIEW.onState((data, viewer) => {
  const can = viewer.can.bookings ?? {};
  // can.transitionAny  — may approve any row  (owner / editor)
  // can.transitionOwn  — may approve the rows assigned to them  (assignee)
  // can.withdrawFrom   — the statuses this reader may take their OWN row away from
  // can.assigneeField  — the field a row carries its owner's address in
  // can.assign         — may hand a row to somebody else
  // can.assignees      — who may be named
  // viewer.me          — this reader's own address
  const mine = (row) => can.transitionAny || (can.transitionOwn && row[can.assigneeField] === viewer.me);
});
```

Draw only those buttons, and for `transitionOwn` only on the rows that pass that comparison —
`transitionOwn` alone cannot say WHICH rows, which is why `me` and `assigneeField` come with it.
The page never sees a role name: branching on `"editor"` would be the rules written a second time,
where nobody reviews them. The write applies the same comparison, so a page that ignores this is
refused rather than obeyed.

`submit` is the visitor's path and **the page confirms with the reader before writing** — the HTML
is not trusted to have been asked. `transition` and `assign` are the
roster's, and they do NOT confirm: the person pressing them is on the app's own roster doing
their own work, and a modal in front of a button used forty times a day is abandoned rather than
read. The page prints what happened above the frame instead, from what was written.

**`withdraw` is the exception, and the page is what has to ask.** The parent does not confirm it
either — but it deletes a record and, where there is a `mirror`, hands the slot to whoever clicks
next, so there is nothing to undo and nothing left to read afterwards. That is not the same kind
of button as approving a booking for the fortieth time today. Put the confirmation in the page,
and say what it costs: 取り下げると枠はすぐ他の人が取れるようになります。

**In the page means IN THE PAGE — not `confirm()`**, which the sandbox ignores (above). A
`if (!confirm(…)) return;` guard is worse than none: the call returns `false`, so the button
silently does nothing, and the author who tested it once concludes withdrawal is broken. Draw the
question — a button that arms itself, a row that expands into 「取り下げる / やめる」 — and put
the cost in the text the reader can see.

- **`transition` moves ONE field** — `collections.<cid>.statusField` — and only along
  `transitions` (for a member) or `public.submit.<cid>.selfTransitions` (for a participant). Those
  are different tables, so a staff page and a participant page draw different buttons for the same
  collection. Ask for a move the record cannot make and the answer names it.
- **`withdraw` takes the reader's own row away** and names no destination, because nothing moves.
  It exists only where `selfDelete` declares the statuses, it is offered on a participant's page
  and never on a staff one (owner and editor delete by role), and where the collection has a
  `mirror` the parent reopens it in the same batch. `viewer.can.<cid>.withdrawFrom` is the list of
  statuses, not a boolean: draw the control on the rows that are actually in one of them.
- **`assign` moves `assigneeField`**, and only to an address holding `owner`, `editor` or
  `assignee` on that collection (`assignees` in the capability above). Anything else would write a
  row NOBODY could touch afterwards. An `assignee` cannot hand a row on at all, their own
  included: the rules require the row to be theirs before AND after.
- **Being shown the page is not permission.** `/m/{slug}` admits anybody holding a role ANYWHERE in
  the app, so a `viewer`, or somebody scoped to a different collection, reads the same declaration
  as the front desk. That is why the capability exists and why it is per reader.
- **A staff page published before this shipped is READ-ONLY until it is published again.** The
  capability is computed from lists the projection carries, and a projection without them cannot
  tell a receptionist from an observer — so it refuses rather than assuming. Re-run
  `manageSharedApp` with `action: "publish"` and the buttons come back.
- **The notice is not the page's to choose.** If `collections.<cid>.mail` declares a template for
  the move being made, it is queued IN THE SAME WRITE, addressed from the record. A page that
  could name a template could mail "your booking is approved" about one it had just rejected.
- **Nothing here grants anything.** The rules already decide what this member may write; these
  calls only let the page ask, and let the refusal say which assumption in the page was wrong.

The simplest correct survey omits status entirely (`submitOnly` + `verifiedEmail` + `emailField`).
Add a status only when somebody is going to work through the responses.

Then `manageSharedApp` with `action: "publish"`.

`action: "unpublish"` closes it again and keeps everything, so re-opening it later is one step.

## What the tool refuses, and why it is right

- **Live records that do not fit the schema you are about to write.** It lists them. Migrate them,
  or pass `confirm: true` — after telling the user what breaks, not before.
- **`publish` writes THIS working tree**, immediately and for everybody. It used to promote a
  version the roster had reviewed at `/staging/{aid}`; there is no such copy any more, so `preview`
  (step 3) is the only thing between what you wrote and what they see.

## Before you ask the user a question

Three things are worth asking and the rest are not:

- **their email address**, if you do not have it — nothing works without it in `members`;
- **whether people outside the roster should be able to answer** — it decides whether there is a
  `public` block at all. Ask it in those words: everyone who answers signs in with an email
  address either way, so "public" here means "anyone who signs in", not "anonymous";
- **whether the people who answer need to see their own answer later** (step 2c) — it decides
  whether the app is invite-only, so it cannot be settled afterwards. The AUTHOR'S own page is not
  on this list: an app that collects records gets one, and asking makes it sound optional.

Do not ask which storage to use, whether to make it "an app", or what to call the collection.

## Where people actually look — say what is true today

- **The roster's entrance exists.** `manageSharedApp` reports the address; hand that to the people
  you invited. It works from `init` — the URL name is reserved there, and the roster can resolve it
  before anything is public.
- **The public entrance exists too, and works end to end** — `/a/{slug}` renders the app's public
  view, or the form generated from the declaration when there is none, and a visitor signs in and
  submits there. It is a link you can promise. (This bullet once said the opposite, from when the
  page that renders it had not been built. Do not tell an author their public link will not work.)
- **What is conditional is the RUNTIME, not the page.** `transition`, `assign`, `withdraw` and the
  `/p/{slug}` entrance arrived later than public forms and are simply absent on an older one — a
  page calling one throws, which in a frame looks like a page that does nothing. Draw from
  `viewer.can` rather than from whether the method exists.

Say what an address does at the START, when the user's request implies handing out a link — not
after they have watched you build it.

## If the tools are not here

`manageSharedApp` and `manageCollection` are only offered in a cell whose directory has the
workspace-data tool group. If they are not in your tool list, **stop and say so**: a shared app
cannot be published from here, and writing `app.json` and a schema by hand produces files nothing
can act on. Point the user at the launcher's tool-group switch for this folder rather than
carrying on.

## Two refusals that are NOT your cue to start editing

The run this skill was written from lost several minutes to each of these, and both times the
repair made things worse — an `aid` was deleted and a second app was created by accident.

- **`getSchema` / `putSchema` says "unknown collection".** The schema was not ACCEPTED. With
  `init` having written the `aid`, that means it failed validation — read it back against
  `schemaDocs` rather than publishing past it. (Before `init` existed this could also mean "no aid
  yet"; it no longer does, and treating it that way publishes an app with the collection missing.)
- **Anything about permissions on `apps/{aid}`.** The `aid` in `app.json` is the app's identity.
  Removing it does not reset anything: the next `init` mints a NEW one and the old app stays where
  it is, owned by nobody who can reach it. If a publish is refused, read what it says and fix that;
  never edit the `aid` by hand.
