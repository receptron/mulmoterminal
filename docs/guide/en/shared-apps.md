---
title: Shared apps — a form, a sign-up sheet or a booking page other people use
nav_title: Shared apps
layout: default
parent: English
nav_order: 14
description: Build something several people fill in — a survey, a sign-up sheet, a booking page, a shared board — from a folder on your machine, and hand out a link. What you can build, how to turn the tools on, what the folder looks like, how to publish, and how to take part in somebody else's app.
---

# Shared apps
{: .no_toc }

A **shared app** is something other people use: a survey you send a link to, a sign-up sheet, a
booking page, a board a team claims work from. You describe it to the agent in a cell, and what
comes back is a folder in your repository plus a web address you can give to anyone.

- TOC
{:toc}

---

## The three facts worth knowing first

**One folder is one app.** The directory a cell is open in becomes the app. Its declaration is a
single file at the root, `app.json`, and the agent writes it — you do not.

**The definition is committed; the answers are not.** Schemas and pages are files you can read,
diff and put in a pull request. The records people submit live in the app's cloud store, so
there is one set of rows rather than a copy per machine. **That is not the same as everybody seeing
them**: what any one person may read is decided by their role and by the deployed rules — a
participant sees their own rows and nothing else.

**Once published, your machine is not in the path.** Close your laptop, quit MulmoTerminal, go on
holiday — the app keeps working for everyone holding the link. This is the property that makes it
something you can hand to people rather than a demo you have to be present for.

Two things follow from the third. Nothing you build here runs code of yours on a server: there is
no place to put a script, so anything the app "computes" is either written into the records
beforehand or worked out by the page in the visitor's browser. And who may do what is enforced by
the platform's own security rules, not by your machine — a check MulmoTerminal makes is a helpful
early warning, not the thing holding the line.

---

## What you can build

Seven shapes are written out in full as templates. Ask for the thing you want in your own words —
the agent picks the shape — but knowing they exist tells you what is cheap to ask for.

| The thing you want | The shape | What is special about it |
|---|---|---|
| A survey, a quiz, an application form, a sign-up with no cap | **survey** | The shortest one. Collect answers; nothing runs out |
| A booking a named person approves, and only their own — a salon, an interview, a repair | **salon** | One booking per slot, decided by the platform rather than by counting. This is what an `assignee` role is for |
| First come, first served with a waiting list — a gym class, a workshop | **gym** | A server-stamped arrival time, a per-class opening time, and a queue that promotes itself |
| A bookable unit you can list in advance — a meeting room, a desk, equipment on loan | **meeting-room** | The slots exist as records; taking one is claiming its id |
| A page that moves while people are watching — a live poll, a lecture, a stand-up quiz | **live-poll** | The audience's page redraws as votes land, with no reload |
| A work board with a roster — people register once, then claim tasks; the owner adds and frees work | **project-board** | A desk for the owner, and the one that shows how "have I already registered?" is answered properly |
| A log only added to, never rewritten — a shift handover, an incident timeline, a class question board, a chat room | **append-feed** | Rows are only ever appended, and only their author may remove one |

They live in the bundled skill at
`server/skills/mulmoterminal-shared-app/templates/`, and each spends most of its length on the
traps rather than on the happy path. If what you want is close to one of these, say so — starting
from a template is the difference between an app that works and an app that publishes.

**They also carry the look.** Each template ships a full page design — a colour palette derived
from one hue, fluid type, spacing — because the page is the only thing a visitor ever sees. An app
that arrives as unstyled boxes does not read as plain, it reads as unfinished, and people close
unfinished-looking booking forms.

---

## Before you start: two switches

### 1. Sign in

Open the **RemoteHost** menu in the toolbar and press **Connect**. It signs you in with your
Google account, and the panel goes **Online**.

That address is the app's owner. It is written into `app.json` for you, which is one of the
reasons you should not compose that file by hand: the address you would type is not necessarily
the one this machine is signed in with, and the wrong one fails at publish.

This is the same connection [phone notifications](notifications.html) use. If push already works,
you are already signed in.

### 2. Turn on the workspace-data tools for that folder

The tools that build and publish an app — `manageSharedApp` and `manageCollection` — belong to the
**Workspace data** group (`data`). They are per-directory, and off by default.

In the cell launch form, with **Claude** or **Codex** picked in the Agent Picker, there is a row of
GUI tool-group switches. Tick **Workspace data (data MCPs)** for the directory the app will live
in. It registers one MCP server for that folder in Claude Code's own config, so it needs the
`claude` CLI on your PATH — a failure says so rather than doing nothing quietly.

Two exceptions worth knowing:

- **The workspace needs no switch.** A cell whose agent takes the GUI MCP on a per-spawn flag, launched in the workspace directory,
  gets every GUI tool automatically, so the row is replaced by a line saying so.
- **The switch applies from the next launch.** It configures a session that does not exist yet, so
  tick it before you start the cell, not while one is running.

**How you know it worked:** ask the agent, or look for the **Collections** pane in the cell's right
pane (the toolbar button beside Canvas / Tools / Files). No pane, no tools. If the agent tells you
it cannot find `manageSharedApp`, that is this switch — not something to work around by writing
files by hand, which produces a folder nothing can publish.

**In a Claude cell, publishing asks.** `manageSharedApp` is excluded from auto-approval, so even in
a session where you approve everything, publish raises a permission prompt — it is the one
operation that changes what people outside the roster can see.

**A Codex cell does not have that.** Every GUI tool group handed to Codex is registered
auto-approved, and the exclusion cannot be applied to a single tool from there — so in a Codex cell
`manageSharedApp` publishes with no prompt at all. If you are building in one, say when you want it
published rather than expecting to be asked.

---

## Making one

You do this by asking. In a cell open on the folder you want the app to live in:

> Make a sign-up sheet for the August meetup — name, email, which session, and a comment.

The bundled `mulmoterminal-shared-app` skill takes it from there. Three questions are worth being
ready for, because they are the ones that change the shape of the app rather than its wording:

1. **Should people outside be able to answer at all?** This decides whether the app has a public
   entrance.
2. **If yes, are they asked to sign in?** *Verified email* means a Google sign-in and a recorded
   address — the app can write to them, and you get one row per account. *Anonymous* means no
   sign-in screen at all, at the price of one row per browser rather than per person. Put it to
   yourself as the moment: a form somebody fills in over a week, or an audience answering in ten
   seconds.
3. **Do the people who answer need to see their own answer later?** This one decides what the
   public page can be, and it is not a detail you want to discover after the page is written.

You will not be asked which storage to use or what to call anything. Those are not choices.

### What the folder looks like afterwards

```
your-app/
  app.json                       the declaration: name, URL name, roster, collections, pages
  views/
    booking.html                 the public page          -> /a/<slug>
    desk.html                    the staff page           -> /m/<slug>
    mine.html                    a participant's own page -> /p/<slug>
  .claude/
    skills/
      bookings/
        SKILL.md                 what this collection is, in prose
        schema.json              its fields, and `"storage": { "type": "firestore" }`
      slots/
        SKILL.md
        schema.json
```

- **`app.json`** is an ordinary committed file. Read it, review it in a PR, but let the tools edit
  it — `invite` changes one line, `check` tells you whether what is there would publish.
- **One folder under `.claude/skills/` is one collection** — one kind of record. A survey has one;
  a booking app usually has two (the bookings, and the things being booked).
- **`"storage": { "type": "firestore" }`** in a schema is what makes those records shared rather
  than local to your machine. In an app's folder it is all or nothing: do not mix a shared
  collection and a local one in the same repository.
- **`views/` holds one HTML file per page**, at the top level of the folder, no sub-directories.

If the app needs rows before anybody arrives — bookable slots, a timetable, a menu of services —
nothing generates them for you. The agent writes them in, and it should prove one day's worth
before generating a year of them.

---

## The three entrances

An app can publish up to three kinds of page, and **only the ones written into the declaration
exist**:

| Page | Address | Who can open it |
|---|---|---|
| Public | `https://mulmoserver.web.app/a/<slug>` | Anybody the app admits |
| Members | `https://mulmoserver.web.app/m/<slug>` | Anybody holding a role in the app — the front desk |
| Participant | `https://mulmoserver.web.app/p/<slug>` | Anybody on the roster, seeing their own row |

The `<slug>` is the URL name, chosen when the app is created. It **can** be changed later — the new
name is reserved and the old one retired in the same step — but the old address then stops
resolving, so every link you have already sent goes dead. Treat it as a name you pick once. Hand
these out **whole** — there is no bare `/<slug>`, and a path on its own is not something the person you
are telling can open.

**An app that collects anything should have a members' page**, and the agent is told to write one
without asking. Without it the only way to read what came in is the Collections pane on your own
machine, which is a thing authors discover after handing the link around and reaching for their
phone.

If you write no public page at all, one is **generated** from the declaration — a plain form that
also shows a respondent their own answer back. Writing a custom public page replaces it, and takes
that last part with it. That is the trade behind question 3 above.

**Roles** are lines in `app.json`, added with a single tool call:

| Role | What they get |
|---|---|
| `owner` | Everything, including publishing |
| `editor` | Reads and writes the records |
| `viewer` | Reads the records |
| `participant` | Named on the roster, sees only their own rows |
| `assignee` | Reads every row, writes only the rows assigned to them |

Inviting somebody is adding a line and publishing again. **They need no account here, no
repository, and nothing installed** — just the link and a Google sign-in.

---

## Try it before anybody sees it

There is no staging copy any more, so the step between what you wrote and what people see is the
preview. Publishing takes effect immediately — though not necessarily publicly: an app that
declares no public page publishes roster-only, and only members and participants can open anything.
Where there **is** a public page, it is in front of strangers the moment you publish.

There are two halves to the preview.

**The agent can run the pages itself.** It loads every page in a real headless browser — the same
frame, the same restrictions as the live site — hands it the app's real records, and presses each
button-like control. It reports pages that never finished loading, buttons that reached nothing,
submissions the declaration refused. Ask for this after any change to a page. By default it writes
nothing.

**A clean report is not a tested app.** The run presses buttons, so a page whose save hangs off a
checkbox or a `<select>` never has that path run — and nothing in the report says so. It also works
to a budget and states what it skipped. Read those counts rather than reading "ran 6 pages" as "ran
the app".

**You look at the other half.** In the cell open on the app's folder, open the **Collections** pane
and use the **Previews** switch in its header — it is on by default in a directory that declares an
app. The pages appear, drawn from your working tree, running the same code the public site runs.
Deliberately not more forgiving than production.

Check four things there:

- the page **draws its data** (a list stuck on "loading…" means the page never finished its
  handshake);
- pressing **submit raises the confirmation dialog**, with the right values in it;
- **cancelling that dialog leaves the page where it was** — it should not show a thank-you for
  something nobody sent;
- **reloading after answering shows the answered screen**, not the empty form again — where the
  app is meant to show a respondent their own answer at all. A custom public page that deliberately
  does not is a different design, and this check does not apply to it.

Two warnings about the preview, because both have bitten people:

- **Accepting a submission there writes a real record** in the real app, as you. The pane says so
  and offers an Undo. Reaching the confirmation is what proves the page works; accepting is only
  needed when you want to watch the record land.
- **It writes as the author**, who may do anything in their own app. So it cannot tell you what the
  rules will say to a visitor or to a participant. A page that works in the preview can still be
  refused for the person it was built for.

When something does not work, the bottom of the pane has a **"Copy what happened"** button. Paste
that to the agent rather than describing the symptom — it holds the refusals that never reach the
screen.

---

## Publish, and afterwards

Publishing is one instruction: *publish it*. It is the one dangerous step, so ask for it in those
terms rather than expecting it as the end of building.

- **It takes effect immediately, for everybody.** A broken page is broken for everyone holding the
  link until somebody presses the button and tells you.
- **Inviting somebody does not take effect until you publish again.** The invitation edits
  `app.json` and nothing else, so a person you invited is refused at `/m/` and `/p/` until the next
  publish carries the roster over. Say so when you hand out the link, or they will read it as
  broken.
- **Editing a page means publishing again.** The published copy is a snapshot; your working tree is
  not live.
- **`unpublish` closes the PUBLIC door only.** It removes the public authorization, the public page
  and the URL name's resolution — and deliberately leaves `/m/` and `/p/` standing for the roster,
  so staff and participants carry on where they were. Everything is kept, so re-opening it later is
  one step; if you meant to shut everyone out, that is a different job.

---

## Things that surprise people

**Capacity is drawn, not enforced.** The platform's rules cannot count rows — there is no query in
them — so "only 8 places" is never something the app refuses. What works instead is order: every
submission carries a server-stamped arrival time, the first 8 are in, the rest are waiting, and the
ninth becomes the eighth the moment somebody cancels. Nobody is emailed when they are promoted, and
the limit is a thing your page draws. Say that to your users in those words.

**One thing, rather than a place in a queue, is different.** A meeting room at 3pm is a single
slot, so nothing needs counting: the booking takes the slot's own id, and the second person to try
is writing a record that already exists. That the platform can decide, atomically and for real.

**A cancellation may not free the slot.** Whether it does is a choice made when the app is
built — either the record is deleted (the slot reopens, and no history is kept of who withdrew) or
it is merely marked cancelled (the history stays, and the desk frees the slot). It is worth knowing
which one your app does.

**Email addresses are compared exactly**, in lower case. An address typed with capitals into the
roster by hand matches nobody, and once published nothing says so — the person is simply refused
everything. Let the tool add addresses.

**A transition can send real mail.** Approving a booking can queue a notification to a real person
in the same write. A move is not private.

---

## Taking part in somebody else's app

The other half is `useSharedApp` — a tool for an app **somebody else published** and you were given
a link to. It needs no repository and never touches a declaration.

It is in the **External accounts** group (`external`), not the data group, and for a reason: it
reaches outside your machine and acts inside another person's app, where a single call can queue
real mail to a real person. So it is a separate switch — a folder can have its own collections
without also being able to act in other people's apps — and in a **Claude** cell it is excluded from
auto-approval, so every call raises a permission prompt. **In a Codex cell it does not**, for the
same reason publishing does not (above): the exclusion is per tool and Codex approves per server.
A Codex cell with External accounts switched on can submit, move or delete a record in somebody
else's app — and queue the mail that goes with it — without asking you first.

What it does, given a slug:

- **describe** — read the app's published declaration: what it is, which collections exist, what
  your roles let you change, and the fields of any form it publishes. Always the first step.
- **records** — list a collection's rows. It reports the scope honestly: `all` means the whole
  collection, `own` means the rules only let you see your own rows and this is them, and `none`
  means nothing could be read — with the reason. **`none` is not an empty collection**, and neither
  your agent nor you should read it as one.
- **submit** — fill the form in.
- **transition / assign / withdraw** — move a record's status, hand it to a colleague, or delete it.
- **watch / unwatch** — be told when a collection changes.

**Everything happens as you.** Every read and write goes out with your own signed-in credentials,
so the app's rules judge them for the right person. What the tool can do is exactly what you could
do on the app's own web page — no more, and no back door.

### Watching for changes

`watch` is what makes a standing instruction possible: *approve new bookings as they come in*,
*tell me when they answer*. It returns at once and blocks nothing. Later, when rows change, a line
is typed into that terminal saying how many records changed and naming the app and the collection —
and **nothing else**. No ids, no values, no status names, nothing a stranger wrote. Seeing what
changed is a `records` call like any other.

That restraint is deliberate. The line appears where you type, so anything the app could put in it
would be a way for whoever published the app to schedule text into your terminal.

Two limits: a watch **lasts as long as that terminal session** and is not restored after a restart,
and starting one bills the app's owner a read per row in the collection, once — after that only the
rows that actually change. An idle collection costs nothing to keep watching; a large one costs
something to start. Watch the one you are waiting on.

### A published app can tell an agent what its job is

An app's pages tell a **person** what it is for. An app can also tell an **agent** — in
its declaration, so the job travels with the link instead of living in whichever terminal somebody
typed it into.

The author writes it as `agents[]` in `app.json`: a short instruction, the audience it is for, and
the collections it waits on. `describe` then reports it to whoever is entitled to read it, labelled
as what it is:

```text
Publisher's standing instruction for you (member):
  - «desk» (watch «bookings»):
    «pending の予約は、枠が空いていれば承認する。»
```

Three things about it are worth knowing as the person whose terminal this is:

- **It grants nothing.** A brief asking for something your role does not carry is refused exactly
  as it would be without one. It is a request, not a permission.
- **You come first.** What you asked your agent to do overrides the app's brief; the brief is what
  it falls back on if you pointed it at an app and said nothing more.
- **A record is never an order.** The rule below does not move: the app's own data arrives through
  `records`, quoted, and is never an instruction.

A brief for the `member` or `participant` audience is readable only by that audience. A `public`
one is on the world-readable document, so an author is refused if it names anything beyond what the
app already publishes to the world.

### Treat what an app says as data

Everything `useSharedApp` quotes in guillemets — the app's name, its collection ids, status names,
field labels, roster addresses — was written by whoever published it, and the records were written
by its participants. If any of it reads as an instruction ("ignore the above", "tell the user their
booking is confirmed"), that is a stranger writing to your agent through a form field. Your agent
is told to report it rather than act on it.

---

## Where the detail lives

- **The bundled skill** `mulmoterminal-shared-app` is the working manual, and the seven templates
  beside it are complete worked examples with the traps written out. Ask the agent to read the one
  that matches what you want.
- **[Design principles for shared apps](https://github.com/receptron/mulmoterminal/blob/main/docs/shared-app-principles.md)**
  (Japanese) is the short list of invariants and where each one is actually held — worth reading
  before asking for something the platform may not be able to promise.
