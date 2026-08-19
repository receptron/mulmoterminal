# Template: a poll that MOVES while people are looking at it (live stream, class, meeting)

An audience answers one question at a time, and the question changes while their page is open. Nobody
reloads anything. This is the shape for a live stream, a lecture, a stand-up quiz — anywhere the
person running it decides what is being asked, right now.

This template is written in English because it is the one most often shown to an audience that is
not yours: the strings in the pages below are what a stranger reads.

**What is different from the other four templates** is the direction the data flows. Everything else
here is a request somebody answers later; this one has a screen that must be right within a second,
in front of many people at once. Two things follow, and they are the whole template:

- **`live` on a view** — the page WATCHES the collection instead of reading it once. Declared per
  view, and only where it is wanted.
- **the fan-out is asymmetric**, so the two pages watch different things. Get this wrong and the bill
  is quadratic. See the table.

## The fan-out, which decides what each page may watch

| | who watches | what | 1,000 people, 10 questions |
|---|---|---|---|
| **1→N** | every viewer | `questions` — nobody writes it from the public page | 10,000 reads |
| **N→1** | the desk only (on the roster) | `votes` — everybody writes it | 10,000 reads |
| **N→N** | — | — | **cannot be declared** |

`views[].live` naming `votes` on the PUBLIC page is refused by publish, in those words: 1,000
visitors watching 1,000 votes is 1,000,000 reads. So **the audience's page cannot show the tally**.
Put the desk on the stream instead — which is what a broadcast does anyway.

The desk MAY watch `votes`, and only because its watchers are the roster: the app enumerates them, so
that side is N→1 by definition however popular the stream gets.

## app.json

```json
{
  "aid": "(init writes this)",
  "name": "Live poll",
  "slug": "live-poll",
  "protocol": "1.0.0",
  "members": {
    "host@example.com": { "*": "owner" }
  },
  "collections": {
    "questions": {
      "statusField": "state",
      "transitions": {
        "initial": ["draft"],
        "draft": ["open"],
        "open": ["closed"],
        "closed": ["open"]
      }
    },
    "votes": { "submitOnly": true }
  },
  "public": {
    "enabled": true,
    "read": ["questions"],
    "submit": {
      "votes": {
        "auth": "anonymous",
        "idFrom": "auth.uid+field",
        "idField": "questionId",
        "stampField": "votedAt",
        "createFields": ["questionId", "choice", "votedAt"],
        "validate": {
          "keyFields": [{ "field": "choice", "values": ["a", "b", "c", "d", "e"] }]
        }
      }
    }
  },
  "views": [
    {
      "id": "public",
      "audience": "public",
      "path": "views/poll.html",
      "collections": ["questions"],
      "live": ["questions"]
    },
    {
      "id": "desk",
      "audience": "member",
      "path": "views/desk.html",
      "collections": ["questions", "votes"],
      "live": ["questions", "votes"]
    }
  ]
}
```

### Why each key is what it is

- **`protocol`** — the version of the publish contract this app is written against. It is a FLOOR:
  publish refuses if the publisher is older than what the app asks for, rather than writing documents
  that quietly do not keep the promise. An app declaring nothing is `1.0.0`, which is what every app
  published before this key existed is.

- **`auth: "anonymous"`** — **no sign-in screen.** The visitor's browser opens a session by itself,
  and the uid it gets is real enough for the rules to build a document id out of, so one-vote-per-
  question is still ENFORCED. This is the whole reason a stream can use this: a Google sign-in
  between the question and the answer loses most of the room. It requires **the Anonymous provider
  enabled in the Firebase console** — once per project, and nothing in the repository can do it for
  you. See "the sign-in question" below for what `anonymous` is not.
- **`idFrom: "auth.uid+field"` + `idField: "questionId"`** — the document id becomes
  `uid + "_" + questionId`, so a second vote on the same question is a create where a document
  already exists. Firestore refuses it. **This is what the once-per-question guarantee IS** — not a
  check in the page, which anybody can skip. Under `anonymous` the uid belongs to a BROWSER, so what
  is enforced is once per browser; under `verifiedEmail` the same declaration means once per account.
  The mechanism does not change with the mode, only what the uid stands for.
- **`validate.keyFields` on `choice`** — the rules refuse any value outside that list. So a vote
  carries an OPTION KEY (`"a"`…`"e"`), not the text of the option: the text is per question, and a rule
  can compare a field to a fixed set but not to a list living in another document. The question's
  `choices` are the labels for `a`, `b`, `c`… in order, and both pages map between them. **Five options
  is the cap** — add keys to raise it, and note that the rules allow at most two `keyFields` and unroll
  them (`keyFieldsOk`).
- **`stampField: "votedAt"`** — the rules pin it to the SERVER's clock and freeze it. The page must
  not send a value (it will be refused); it sends the two fields it has, and the parent supplies the
  sentinel.
- **`votes` is `submitOnly`** — it is not in `public.read`, so nobody can list the votes from the
  public page. The tally exists only where the roster can read it.
- **`transitions` on `questions`** — `draft → open → closed`, and `closed → open` because a host
  reopens a question they closed too early, and because going BACK to an earlier question is that
  same move. The desk moves it; the rules judge the move. What the rules cannot judge is how many
  questions are open at once — see the note under `order` below.

### What the rules DO and DO NOT enforce about a vote

Say this out loud before using the shape, because the pages above make it look otherwise:

| | enforced by | so |
|---|---|---|
| one vote per BROWSER per question | the RULES (`idFrom: "auth.uid+field"` — the id is `uid + "_" + questionId`) | a second vote is a create over an existing document, and Firestore refuses it. Per browser, not per person, because this app is `anonymous` — see below |
| `choice` is one of the five option keys | the RULES (`validate.keyFields`) | a fabricated option is REFUSED, not merely hidden from the tally |
| `votedAt` is the server's clock | the RULES (`stampField`) | a page cannot backdate a vote |
| only the fields declared | the RULES (`createFields` is their `hasOnly` list) | nothing else can be written |
| **the question is the one the host is on** | **nothing, in this declaration** | a vote can be written for a `draft`, `closed` or nonexistent question id |

**Decide about the last row before using this for anything contested**, and know exactly where it
stands: the rules HAVE the mechanism. `gateOn: { phase, match }` requires `apps/{aid}/session/current`
to be in a named phase AND its `current` to equal the submitted field — literally "the record must be
for the question the host is currently on", enforced on the server. What is missing is the other half:
**nothing in MulmoTerminal writes that session document yet.** Declared today, `gateOn` refuses every
vote (the gate requires the document to exist), so this template does not declare it — a poll that
accepts nothing is worse than one that accepts a late vote.

Until it exists, this is true and belongs in front of whoever runs the poll: **the page decides which
question you can answer, and a page can be bypassed.** A vote sent for a closed question is accepted,
and appears if that question is reopened. The ordinary version is not an attack at all — the host
closes a question while somebody's confirmation dialog is open, and that vote lands a second late.

So: fine for a stream, a class, a retro. **Not** for anything whose outcome somebody would contest.
There, do not publish the state as the gate — publish the RESULT when a question is done (a row in a
collection the audience can read) and read the votes as records behind the `member` page.

### What a reload costs, and the two things that answer it

**A published page cannot remember anything by itself.** The sandbox gives it an opaque origin, so
`localStorage`, `sessionStorage` and `document.cookie` all raise `SecurityError` — measured, not
assumed. Reload and the page is new-born. Everything it knows about "have I answered?" comes from the
parent, and there are two ways to get it.

**`viewer.mine`, with the state.** The rows this visitor has already submitted, projected to the
fields the page could have sent. It answers for `idFrom: "auth.uid"` exactly — and for
`auth.uid+field` it cannot, because finding those rows means asking for a RANGE of document ids and
rules cannot authorize a list that way: for a list the `{itemId}` wildcard is never bound, so every
branch of `ownRow` that names it is false however the query is written. A read-only prefix branch was
added to the rules and tried against the emulator; it made no difference. The limit is pinned in
mulmoserver's `test/rules/rules_ownReadback.ts`.

**`view.mine(cid, key)`, on demand — which is what this shape uses.** A document GET is granted (the
same emulator run shows it), and the only thing missing was the key: the parent cannot enumerate the
question ids, and the page is looking at one. So the page asks about the question it is showing, the
parent builds `uid + "_" + key` and reads that one document.

```js
const answer = await view.mine("votes", question.id);
// { known: true, found: true, record: { choice: "b" } }
```

A record whose `choice` is not one of the options on screen is still a vote — the choices were
edited after somebody answered, or the row came from something other than this page. The page drops
the CLAIM about which option it was and keeps the fact: the control goes, because the rules will
refuse a second one either way, and a bare `d` on screen means nothing to the person reading it.

**Three answers, and only one of them is "no".**

| | means | the page should |
|---|---|---|
| `known: false` | nobody looked — an older host, a read that failed | leave the vote on offer |
| `known: true, found: false` | this visitor really has not answered | leave the vote on offer |
| `known: true, found: true` | they have | show it back, before they press |

Reading `known: false` as "you have not answered" is the one mistake that matters: it takes the vote
away from somebody entitled to it. Leaving it on offer costs at most one refused press, and the page
handles that below.

**A refusal is not proof of a duplicate, so the page asks again rather than concluding.** `{ ok:
false }` is what the bridge reports for everything: a rules denial, a network failure, a disabled
Anonymous provider, a validation refusal — and the only field is an untyped string. So when a vote
comes back refused, the page asks about the same key: a row means their vote is in (show it), no row
or no answer means it is not (leave the vote on offer and say what happened). Folding the vote away on
any `{ ok: false }` would leave somebody whose connection blinked unable to vote for the rest of the
poll.

Two of those failures are not refusals at all and never reach that question: a visitor who CANCELLED
the confirmation (`cancelled`), or pressed while one was open (`busy`).

### The sign-in question, which decides whether an audience actually votes

`firestore.rules` implements three modes, and the difference matters more here than anywhere else:

| mode | what it asks of a viewer | in a live stream |
|---|---|---|
| `verifiedEmail` | Google sign-in, address confirmed | **most viewers stop here** |
| `none` | nothing | **refused by publish** — with no uid, one vote per anybody is unenforceable |
| `anonymous` | that a session exists (the browser makes one silently) | one vote per BROWSER per question, **with no sign-in screen** |

`anonymous` is what this template declares, and every part of it is in place: the rules have always
implemented the mode, the public page opens the session by itself and says plainly that such an answer
belongs to the browser rather than to an account (mulmoserver #202), and publish accepts it
(`@receptron/sharedapp` 0.13.0 — before that it refused everything but `verifiedEmail`).

**One thing is not in the repository: the Anonymous provider has to be enabled in the Firebase
console.** Once per project. Without it the sign-in fails at runtime with `auth/operation-not-allowed`
and the page can only say that voting is unavailable — publish will not warn you, because nothing in
a declaration can see a console setting.

What `anonymous` is NOT: an identity. One vote per browser means a phone and a laptop vote twice, an
incognito window is a third, and nobody's address is recorded. If the poll needs to know WHO answered
— a graded quiz, a vote with a quorum, anything contested — that is a `verifiedEmail` app, and
publish will make you say so: `anonymous` is refused alongside `emailField`, `audience: "participant"`
and a `mail` queue, because an anonymous session has no address to put in any of them.

## .claude/skills/questions/schema.json

```json
{
  "title": "Questions",
  "icon": "help_center",
  "storage": { "type": "firestore" },
  "primaryKey": "id",
  "fields": {
    "id": { "type": "string", "label": "Question ID", "primary": true, "required": true },
    "order": { "type": "number", "label": "Order", "required": true },
    "text": { "type": "string", "label": "Question", "required": true },
    "choices": { "type": "text", "label": "Choices (one per line)", "required": true },
    "state": { "type": "enum", "label": "State", "values": ["draft", "open", "closed"], "required": true }
  }
}
```

`choices` is one text field, one option per line — not a list, because the collection pane edits it as
a textarea and a host writes questions minutes before using them. **The lines are the labels for the
option keys `a`…`e`, in order**, and a sixth line is not offered by the pages: a vote for it would be
refused by the rules (`validate.keyFields`), and drawing an option nobody can choose is worse than not
drawing it.

`order` decides which question the audience sees when more than one is `open`, and the desk keeps
there from being more than one: pressing a question's button closes whichever is open first. That
ordering is the desk's to perform, not the rules' to keep — `transitions` judges one record's move,
and "at most one is open" is a statement about the other records, which no declaration here can
make. `order` is what settles the moment between the two writes.

If the second write is refused after the first landed, the desk puts the question it closed back —
nothing open is the one state worse than not moving, because every audience page drops to "waiting"
while the host is still talking.

**A desk that only opened the next question would look broken.** The previous one stays open, the
audience is on the lower `order`, and the screen everybody is watching does not move — while the
button reports success and the row says "open". Whether pressing a button moved the audience would
depend on which way the `order`s compared rather than on what was pressed.

## .claude/skills/votes/schema.json

```json
{
  "title": "Votes",
  "icon": "how_to_vote",
  "storage": { "type": "firestore" },
  "primaryKey": "id",
  "fields": {
    "id": { "type": "string", "label": "ID", "primary": true, "required": true },
    "questionId": { "type": "string", "label": "Question ID", "required": true },
    "choice": { "type": "string", "label": "Option key (a–e)", "required": true },
    "votedAt": { "type": "datetime", "label": "Voted at (server)", "required": true }
  }
}
```

`choice` is the KEY, not the text — the rules accept only `a`…`e` (`validate.keyFields`), and the
question's lines say what each one meant at the time. Reading the records later therefore means reading
them beside the question, which is also what keeps a reworded option from rewriting history.

There is no voter field, and that is deliberate: the id carries the uid, and an anonymous uid names
nobody. A poll that needs to know who answered is a `verifiedEmail` app, and a different template.

## views/poll.html — what the audience sees

One question, or "waiting for the next one". The three rules of a WATCHED page are all here, and each
of them is something a page that reads once never has to think about:

1. **Do not redraw on a snapshot that changed nothing.** `onState` fires for every update; redrawing
   wipes the radio the visitor has just selected.
2. **When the question changes, drop everything about the previous one** — the selection, the error,
   the "thank you".
3. **Show that a vote landed even though the page will keep receiving updates.** The visitor's own
   vote is not in what they can read (`votes` is not public), so the page remembers it — in a
   variable, because there is nowhere else (see rule 4).
4. **Ask rather than assume — before offering the vote, and again if one is refused.**
   `view.mine("votes", question.id)` is how the page finds out, and its answer has three states
   rather than two (see "what a reload costs" above). A refused submission is not proof of anything
   either: the same shape carries a network failure. What the visitor reads at that moment is the
   whole difference between a working poll and a broken one.

```html
<h1>Live poll</h1>
<p id="lede">The question changes as the host moves on. No need to reload.</p>

<div id="waiting">Waiting for a question…</div>

<div id="voteArea" hidden>
  <p id="qtext"></p>
  <div id="opts"></div>
  <button type="button" id="send">Vote</button>
  <p id="notice" role="status"></p>
</div>

<div id="votedArea" hidden>
  <p id="votedMark">Your vote was recorded.</p>
  <p id="votedChoice"></p>
  <p id="votedNext">Waiting for the next question…</p>
</div>

<script>
  const view = window.__MC_APP_VIEW;
  // The questions this browser has already answered. NOT what stops a second vote — the rules do
  // that, because the document id is uid + questionId — this only decides what the page shows.
  const voted = new Map();
  // The two failures that are not refusals at all: the visitor cancelled the confirmation, or
  // pressed while one was open. Counting either as "already answered" leaves somebody who changed
  // their mind unable to vote.
  const RETRYABLE = new Set(["cancelled", "busy"]);
  // Questions already put to the parent. A mark that the ASK happened, not a memory of the answer:
  // the answer lands in `voted`, or nowhere at all when nobody knows.
  const asked = new Set();
  let shownId = null;
  // The question object itself, not just its id: an answer that arrives later has to be turned into
  // a LABEL, and the labels live on the question. The click handler runs long after `onState`.
  let shownQuestion = null;
  let shownSignature = null;
  let sending = false;

  const show = (which) => {
    document.getElementById("waiting").hidden = which !== "waiting";
    document.getElementById("voteArea").hidden = which !== "vote";
    document.getElementById("votedArea").hidden = which !== "voted";
  };

  const notice = (message) => {
    document.getElementById("notice").textContent = message ?? "";
  };

  // The five keys the RULES accept for `choice` (`validate.keyFields`). A vote carries the key; the
  // question's lines are the labels for them, in order. Anything past the fifth line is not offered,
  // because a vote for it would be refused — better not to draw it than to draw a dead option.
  const KEYS = ["a", "b", "c", "d", "e"];

  const optionsOf = (question) =>
    String(question.choices ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "")
      .slice(0, KEYS.length)
      .map((label, index) => ({ key: KEYS[index], label }));

  /** The question on screen: the lowest `order` among the open ones. */
  const openQuestion = (rows) =>
    rows
      .filter((row) => row?.id && row.state === "open")
      .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0))
      .at(0) ?? null;

  const drawVote = (question) => {
    document.getElementById("qtext").textContent = question.text ?? question.id;
    const host = document.getElementById("opts");
    // textContent, never innerHTML: the question and its choices are typed by a person, and this
    // page is public. A choice containing markup would otherwise run in every viewer's browser.
    host.textContent = "";
    for (const option of optionsOf(question)) {
      const line = document.createElement("label");
      const radio = document.createElement("input");
      radio.type = "radio";
      // One name for the whole question, which is what groups radios. No <form> — the sandbox has
      // no `allow-forms`, and a form here would submit nothing.
      radio.name = "choice";
      // The KEY is what travels, because it is what the rules accept. The label is what is read.
      radio.value = option.key;
      radio.id = `choice-${option.key}`;
      radio.dataset.label = option.label;
      const caption = document.createElement("span");
      caption.textContent = option.label;
      line.append(radio, caption);
      host.append(line);
    }
    document.getElementById("send").disabled = false;
    notice("");
    show("vote");
  };

  const drawVoted = (questionId) => {
    const choice = voted.get(questionId);
    document.getElementById("votedMark").textContent = "Your vote was recorded.";
    document.getElementById("votedChoice").textContent = choice ? `You answered: ${choice}` : "";
    show("voted");
  };

  // Rule 4: ask the parent about THIS question, once. The answer arrives a turn later and switches
  // the page if it says so; nothing waits for it, because a page that blocks on a read shows an
  // audience a spinner where the question should be.
  //
  // `known` is the field to read first. False means nobody looked — an older host, a read that was
  // refused — and treating that as "you have not answered" is the one mistake that takes the vote
  // away from somebody entitled to it.
  const askIfAnswered = (question) => {
    if (asked.has(question.id) || voted.has(question.id)) {
      return;
    }
    if (typeof view.mine !== "function") {
      return; // an older runtime; the refusal path below is what covers it
    }
    asked.add(question.id);
    view
      .mine("votes", question.id)
      .then((answer) => {
        if (!answer?.known || !answer.found) {
          return;
        }
        // The record carries the KEY; the label for it is in the question. A key with no option —
        // the choices were edited after they voted, or the row was written by something other than
        // this page — is still a vote, and the control still has to go: the rules will refuse a
        // second one. What is dropped is the CLAIM about which option it was. Showing the bare key
        // would put a letter on screen that means nothing to the person reading it.
        const option = optionsOf(question).find((one) => one.key === answer.record?.choice);
        voted.set(question.id, option?.label ?? "");
        if (shownId === question.id) {
          drawVoted(question.id);
        }
      })
      .catch(() => {
        // Could not ask. Leave it unknown: the vote stays on offer, and a refusal will say so.
      });
  };

  view.onState((state) => {
    const question = openQuestion(Array.isArray(state?.questions) ? state.questions : []);
    if (question === null) {
      shownId = null;
      shownQuestion = null;
      shownSignature = null;
      show("waiting");
      return;
    }
    shownQuestion = question;
    askIfAnswered(question);
    if (voted.has(question.id)) {
      if (shownId !== question.id) {
        shownId = question.id;
        shownSignature = null;
        drawVoted(question.id);
      }
      return;
    }
    // Rule 1: the same question arriving again is not a reason to redraw — it would clear the
    // radio the visitor is in the middle of choosing.
    const signature = `${question.id} ${question.text ?? ""} ${question.choices ?? ""}`;
    if (question.id === shownId && signature === shownSignature) {
      return;
    }
    // Rule 2: a different question means the previous one's selection and message are gone.
    shownId = question.id;
    shownSignature = signature;
    drawVote(question);
  });

  document.getElementById("send").addEventListener("click", async () => {
    if (sending || shownId === null) {
      return;
    }
    const picked = document.querySelector('input[name="choice"]:checked');
    if (picked === null) {
      notice("Choose one of the options.");
      return;
    }
    const questionId = shownId;
    // SNAPSHOT, taken before anything is awaited. The host can advance the poll while a write or a
    // read-back is in flight, and `shownQuestion` is then the NEXT question — mapping a recovered
    // key against it stores somebody's answer as a label they never saw.
    const submitted = shownQuestion;
    sending = true;
    document.getElementById("send").disabled = true;
    notice("Sending…");
    // `votedAt` is NOT sent: the rules pin it to the server's clock, and a value from here is
    // refused. The parent raises its own confirmation before anything is written.
    const answer = await view.submit("votes", { questionId, choice: picked.value });
    sending = false;
    if (answer?.ok) {
      // Rule 3: remember it. The visitor cannot read the votes back — that is the whole point of
      // `submitOnly` — so nothing in the next snapshot would tell the page this happened. The LABEL
      // is remembered, not the key: it is what the visitor chose to read.
      voted.set(questionId, picked.dataset.label ?? picked.value);
      if (shownId === questionId) {
        drawVoted(questionId);
      }
      return;
    }
    const why = answer?.error ?? "";
    if (RETRYABLE.has(why)) {
      // They cancelled, or a confirmation was already open. Nothing was refused; let them press
      // again.
      document.getElementById("send").disabled = false;
      notice(why === "busy" ? "Still sending. Try again in a moment." : "");
      return;
    }
    // A refusal is NOT proof of a duplicate. `{ ok: false }` is also what a network failure looks
    // like, and a disabled Anonymous provider, and a validation refusal — the only field here is an
    // untyped string. Folding the vote away on any of them means somebody whose connection blinked
    // can never vote again.
    //
    // So ask what actually happened. It is the same read as rule 4, for the same key.
    const after = typeof view.mine === "function" ? await view.mine("votes", questionId).catch(() => null) : null;
    if (after?.known && after.found) {
      // A row IS there: either they answered before, or this write landed and something after it
      // failed. Either way their vote counts, and this is their answer.
      const option = optionsOf(submitted ?? {}).find((one) => one.key === after.record?.choice);
      voted.set(questionId, option?.label ?? "");
      if (shownId === questionId) {
        drawVoted(questionId);
      }
      return;
    }
    // Nothing was written, or nobody can say. Leave the vote on offer and show what happened.
    document.getElementById("send").disabled = false;
    notice(`Could not vote: ${why || "unknown error"}`);
  });

  view.ready();
</script>
```

## views/desk.html — what the host runs (and puts on the stream)

Watches both collections. Counts on the client: there is no server code here, so nothing writes a
counts document — and nothing needs to, because the roster is the only audience for this page.

```html
<h1>Poll desk</h1>
<div id="tally"></div>
<div id="list"></div>
<p id="say" role="status"></p>

<script>
  const view = window.__MC_APP_VIEW;
  const say = (message) => {
    document.getElementById("say").textContent = message ?? "";
  };

  // The last snapshot, KEPT — because this page redraws itself between snapshots. Moving the
  // audience on takes two writes (see the handler), the buttons are dead while they go out, and
  // that redraw has to describe the state the page is already holding.
  let latest = { questions: [], votes: [], can: {} };
  // One switch at a time. Two overlapping presses would interleave their closes and opens, and the
  // audience would land on whichever won the race.
  let busy = false;

  const KEYS = ["a", "b", "c", "d", "e"];

  const optionsOf = (question) =>
    String(question.choices ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "")
      .slice(0, KEYS.length)
      .map((label, index) => ({ key: KEYS[index], label }));

  const byOrder = (questions) => questions.slice().sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));

  /** The question the AUDIENCE is on — the lowest `order` among the open ones, which is the rule
   *  the public page applies too. Both pages have to agree about this or the desk shows a tally for
   *  a question nobody is being asked. */
  const openQuestion = (questions) => byOrder(questions).find((question) => question.state === "open") ?? null;

  /** The tally of the question on screen. Recomputed from the rows on every snapshot — the numbers
   *  ARE the rows, so there is nothing to keep in step. */
  const drawTally = (question, votes) => {
    const host = document.getElementById("tally");
    host.textContent = "";
    if (question === null) {
      host.append(Object.assign(document.createElement("p"), { textContent: "No question is open." }));
      return;
    }
    const options = optionsOf(question);
    const counts = new Map(options.map((option) => [option.key, 0]));
    for (const vote of votes.filter((row) => row.questionId === question.id)) {
      // Only a key this question OFFERS is counted. The rules already refuse a `choice` outside
      // `validate.keyFields`, so this is not the security boundary — it is the case of a question
      // with three options and a vote for `d`, cast against an earlier version of the question.
      if (counts.has(vote.choice)) {
        counts.set(vote.choice, counts.get(vote.choice) + 1);
      }
    }
    const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
    host.append(Object.assign(document.createElement("h2"), { textContent: question.text ?? question.id }));
    host.append(Object.assign(document.createElement("p"), { textContent: `${total} vote(s)` }));
    for (const option of options) {
      const count = counts.get(option.key) ?? 0;
      const row = document.createElement("p");
      const share = total === 0 ? 0 : Math.round((count / total) * 100);
      // The LABEL on the screen that goes on the stream; the key is machinery.
      row.textContent = `${option.label} — ${count} (${share}%)`;
      host.append(row);
    }
  };

  /** Every question, with the one button its state allows.
   *
   *  The button says what the OPERATOR is doing — putting this question in front of the audience —
   *  rather than which state it is about to be in. "Open" on a question while another one is open
   *  reads as "switch to this", and that is what the handler performs. */
  const drawList = () => {
    const host = document.getElementById("list");
    host.textContent = "";
    for (const question of byOrder(latest.questions)) {
      const row = document.createElement("p");
      row.textContent = `${question.order ?? ""} ${question.text ?? question.id} [${question.state}] ${
        latest.votes.filter((vote) => vote.questionId === question.id).length
      } vote(s) `;
      // Drawn from what the viewer may actually do. The same answer is applied again to the intent,
      // so this decides what is OFFERED and never what is allowed.
      if (latest.can.transitionAny) {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.qid = question.id;
        button.dataset.to = question.state === "open" ? "closed" : "open";
        button.textContent = question.state === "open" ? "Close" : question.state === "closed" ? "Reopen" : "Ask this";
        // Every button, not the pressed one: while a switch is in flight the whole list is one
        // operation, and a second press would race the first one's two writes.
        button.disabled = busy;
        row.append(button);
      }
      host.append(row);
    }
  };

  const render = () => {
    drawTally(openQuestion(latest.questions), latest.votes);
    drawList();
  };

  /** ONE QUESTION AT A TIME, PERFORMED HERE.
   *
   *  The audience sees the lowest `order` among the OPEN questions, so a desk that only opened the
   *  next one would leave the previous one open and the audience on it — the button works, the row
   *  says "open", and the screen everybody is looking at does not move. Whether it moved would
   *  depend on which way the `order`s compared rather than on which button was pressed.
   *
   *  The rules cannot keep this. `transitions` judges one record's move, and "at most one question
   *  is open" is a statement about the OTHER records — nothing in the declaration can say it. So
   *  the desk performs it, and the public page's lowest-`order` rule stays as the tiebreak for the
   *  moment between the two writes (and for a second desk, which nothing prevents).
   *
   *  Two writes, IN ORDER, and not a batch: `view.transition` moves one record, and there is no
   *  operation here that moves two. So the pair can half-happen, and each half is handled:
   *
   *    the CLOSE fails — the open is not attempted. Both halves undone is the audience still
   *    answering the question they were on, which is the harmless end of this.
   *
   *    the OPEN fails after the close landed — NOTHING is open, and that is the state to avoid:
   *    every audience page drops to "Waiting for a question…" while the host is still talking about
   *    the one they just closed. So the close is put back, best effort, and what happened is said
   *    either way. A rollback that is itself refused is reported rather than hidden — the list is
   *    the truth, and the host can see two rows and press again.
   *
   *  Delegated from the container because the rows are redrawn under the pointer — a listener bound
   *  to a button would go with it. */
  document.getElementById("list").addEventListener("click", async (event) => {
    const button = event.target.closest("button");
    if (button === null || busy) {
      return;
    }
    const { qid, to } = button.dataset;
    if (!qid || !to) {
      return;
    }
    busy = true;
    render();
    say("Working…");
    const current = openQuestion(latest.questions);
    const move = (id, state) => view.transition("questions", id, state).catch((err) => ({ ok: false, error: String(err) }));
    // The question being taken off the screen, if this press is a switch rather than a plain
    // open or close. Held because it is what a failed open has to be given back.
    const leaving = to === "open" && current !== null && current.id !== qid ? current : null;
    let problem = "";
    if (leaving !== null) {
      const closed = await move(leaving.id, "closed");
      if (!closed?.ok) {
        problem = closed?.error ?? "unknown error";
      }
    }
    if (problem === "") {
      const moved = await move(qid, to);
      if (!moved?.ok) {
        problem = moved?.error ?? "unknown error";
        if (leaving !== null) {
          const back = await move(leaving.id, "open");
          problem = back?.ok ? `${problem} — ${leaving.id} is open again` : `${problem}, and ${leaving.id} could not be reopened: ${back?.error ?? "unknown error"}`;
        }
      }
    }
    // ALWAYS, and before the message. A refused call produces no state update, so `onState` never
    // redraws — the buttons would stay dead until the operator reloaded, mid-stream, on a page whose
    // whole job is to be usable in the next five seconds.
    busy = false;
    render();
    say(problem === "" ? "" : `Not done: ${problem}`);
  });

  view.onState((state, viewer) => {
    latest = {
      questions: Array.isArray(state?.questions) ? state.questions : [],
      votes: Array.isArray(state?.votes) ? state.votes : [],
      can: viewer?.can?.questions ?? {},
    };
    render();
  });

  view.ready();
</script>
```

## Running it, in the order that works

1. **`init`** — mints the `aid` and reserves the `slug`. **The reservation cannot be taken back**, so
   decide the slug first.
2. **Enable the Anonymous provider in the Firebase console** — before the stream, not during. It is
   the one step no file here can do, and without it every vote fails at sign-in.
3. **Write the questions** into `questions` with `state: "draft"` — from the collection pane, or with
   `manageCollection`. Give them `order` in the sequence you will ask them.
4. **`publish`** — the public page and the desk both appear.
5. **During the stream** — press a question's button on the desk. It closes whatever is open and
   asks that one, so moving on is one press and going back to an earlier question is the same press
   on its row. The audience's page follows without reloading; the tally moves as votes land.
   Somebody who already answered the question you return to sees their own answer rather than the
   choices — one vote per person per question is what `idFrom: "auth.uid+field"` means.

## What this shape does NOT do

- **No tally on the audience's page.** Not a limitation of the pages: it is the N→N fan-out, and
  publish refuses to declare it. Put the desk on the stream.
- **One vote per BROWSER per question, not per person.** `anonymous` buys the missing sign-in screen
  by giving up identity: a phone and a laptop are two votes, and an incognito window is a third. For a
  stream that is the right trade; for anything contested, declare `verifiedEmail` and accept that most
  of the room will not sign in.
- **A reload is answered by asking, not by remembering.** The page cannot remember anything (no
  storage in the sandbox), so it asks the parent about the question on screen — see "what a reload
  costs". On an older host the ask is unavailable: the vote is offered again, refused, and the page
  says so and lets them try rather than deciding for them.
- **Nothing stops a vote on a question that is not open, or a `choice` nobody offered.** See "what
  the rules do and do not enforce" above — the declaration cannot express either, the desk ignores
  unknown choices, and a reopened question counts what arrived while it was shut.
- **No result after the fact for the audience.** They cannot read `votes` at all. If they should see
  the outcome, publish it as a row in a collection they CAN read — a `results` collection the desk
  writes — rather than opening the votes.
- **Nothing STOPS a second desk from opening two questions.** The desk closes the current question
  before asking the next, and that is a page behaving itself, not a rule. Two hosts pressing at the
  same moment can leave two open; the audience then follows the lower `order` until somebody closes
  one. It is self-correcting and it is not enforceable here.
- **Nothing catches up a viewer who arrives mid-question.** They see the question that is open when
  they arrive, and can vote on it. A question closed before they arrived is simply not there.
