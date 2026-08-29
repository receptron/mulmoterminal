# A magazine: several writers, one masthead, a URL per article

A group of people — or agents — who each publish under their own name, in public, at an address
you can send to somebody: a team blog, a newsletter's back issues, a research log, release notes,
a class's write-ups, a review column. Nobody approves anything; a writer publishes, and the
article is readable by the world the moment it exists.

Use this when what is being collected is **something to READ**, and each item deserves its own
link. That is the whole difference from every other template here. A survey's responses are rows,
and the page decides how they look; an article is a page, and the platform draws it — so the app
declares which fields are the title, the summary, the body and the byline, and the platform gives
each record an address of the form `/a/{slug}/{id}`.

**What is different from the other templates** is that this one publishes a `views[].article`
block, and that single key changes three things at once:

- **The document id becomes the URL.** `idFrom: "slug"` takes the id from a field the writer
  chooses, and the rules freeze it. An article's address is decided once, by the person writing it,
  and can never be edited — only replaced by a different article.
- **The app states its own protocol.** Article views are `2.0.0`; every other template here says
  `1.0.0`. This is the one place a template declares something newer, and the reason is in the
  traps below.
- **The index is a cost, in bytes, that publish will refuse.** The world's index reads whole
  records — a rule cannot hide a field — so `limit` times the declared field caps is a real number
  the gate checks against 1,000,000. Bodies are the biggest thing this platform stores, and this is
  the only shape where a page routinely lists a lot of them.

The other thing worth knowing before you copy it: **there is no draft.** A row of a world-readable
collection is world-readable, and `status` cannot hide a field. Writing happens outside the app,
in ordinary files; the app is where a finished piece is published.

## What each person can do

| | publish an article | edit or delete their own | edit or delete somebody else's |
|---|---|---|---|
| owner | yes | yes | **no** |
| participant (writer) | yes | yes | **no** |
| anyone not on the roster | no | — | no |

Reading is the whole world, with no sign-in.

**The owner row is not a typo, and it is the first thing to understand about this shape.** The
owner holds `participant` on `articles` *deliberately*, and the reason is a chain of three
declarations — spelled out in "The owner has to demote themselves" below. Writers here are equals.
If you want somebody who can correct anybody's article, give that person `"articles": "editor"`;
it is one word, and it is not the default because a magazine of peers is the more common thing and
the more surprising one to discover you do not have.

## app.json

```json
{
  "name": "Field Notes",
  "slug": "field-notes",
  "protocol": "2.0.0",
  "members": {
    "editor@example.com": {
      "*": "owner",
      "articles": "participant"
    },
    "first.writer@example.com": {
      "articles": "participant"
    },
    "second.writer@example.com": {
      "articles": "participant"
    }
  },
  "collections": {
    "articles": {
      "statusField": "status",
      "submitOnly": true
    }
  },
  "theme": {
    "hue": 115
  },
  "views": [
    {
      "id": "public",
      "audience": "public",
      "path": "views/home.html",
      "collections": ["articles"],
      "article": {
        "title": "title",
        "summary": "summary",
        "body": "body",
        "byline": "byline"
      },
      "limit": {
        "articles": 10
      }
    },
    {
      "id": "desk",
      "audience": "member",
      "path": "views/desk.html",
      "collections": ["articles"]
    },
    {
      "id": "write",
      "audience": "participant",
      "path": "views/desk.html",
      "collections": ["articles"]
    }
  ],
  "public": {
    "enabled": true,
    "read": ["articles"],
    "submit": {
      "articles": {
        "auth": "verifiedEmail",
        "audience": "participant",
        "uidField": "byUid",
        "createFields": ["slug", "title", "summary", "body", "tags", "byline", "byUid", "status", "publishedAt"],
        "initialStatus": "published",
        "validate": {
          "required": ["title", "body"]
        },
        "idFrom": "slug",
        "idField": "slug",
        "stampField": "publishedAt",
        "maxBytes": {
          "title": 200,
          "summary": 800,
          "body": 60000,
          "byline": 100
        },
        "selfUpdate": {
          "published": ["title", "summary", "body", "tags", "byline"]
        },
        "selfDelete": ["published"]
      }
    }
  },
  "agents": [
    {
      "id": "author",
      "audience": "member",
      "instruction": "You write for Field Notes. Publish with useSharedApp `action: \"submit\"` into the `articles` collection — `manageCollection`'s `putItems` cannot write here, and returns a PERMISSION_DENIED that names no field. `slug` is the article's URL name AND its document id: lowercase letters, digits and hyphens, starting with a letter or digit, 64 characters at most, and unique. The article is published at /a/field-notes/<slug> and the id is frozen, so choose a name a person could read aloud and never try to change it. `title` and `body` are required; `body` is Markdown and cannot carry images; `summary` is the two lines the index shows; `tags` is comma-separated; `status` is `published`. The caps are UTF-8 BYTES, not characters: title 200, summary 800, body 60000. Do not send `publishedAt` — the server stamps it and it is frozen. Do not send `byUid` — the host fills it in. DO fill in `byline` with the name you want printed: it is drawn under the title on the article page and at the foot of the card in the index, up to 100 bytes. It is a string you type, not an identity the rules check — who published is recorded in `byUid` — so NEVER put an email address in it; that field is drawn to the whole world. Publishing is instant and public: there is no draft in this app, so keep work in progress in drafts/*.md and submit when it is finished. Fix a typo with `action: \"update\"`, passing the article's `slug` as `id` and only the fields that change; never republish. You can only change articles this account published — everybody here is a peer and nobody can reach everybody's work. Withdrawing means deleting, and it cannot be undone. A person at this terminal does all of the same things from the desk at /m/field-notes."
    }
  ]
}
```

**The keys that are doing the work, in the order they matter.**

`public.submit.articles.audience: "participant"` — only somebody the roster names may create an
article. This is load-bearing beyond the obvious: the byte caps below are enforced by publish and
by the host, **never by a Firestore rule**, so they bind only people who go through a host. Let the
world submit and the caps become a comment. Publish knows this and refuses an `article` view whose
collection anybody with an account can write to.

`submitOnly: true` — required as soon as `audience` is declared, and it is what closes the
*writer* branch of the rules. See the owner trap.

`idFrom: "slug"` with `idField: "slug"` — the document id comes from the `slug` the writer sends,
and the rules check its grammar and then freeze it. This is what buys per-article URLs. `slug` is
in `createFields` but it must NOT be the schema's `primaryKey` — publish refuses that, because the
rules can pin a document id but cannot pin the value of a field.

`stampField: "publishedAt"` — the server's clock, written by the rules as `request.time`. It has
to be listed in `createFields` (the rules refuse any key outside that list, and they require the
record to carry the stamp), but **the page and the agent must never send a value**: the host fills
it in. The index sorts on it, and the page receives it as a `…Z` string whose lexical order is
chronological.

`uidField: "byUid"` — the publisher's uid, filled in by the host for the same reason. A uid and
not an email, because every field of this collection is readable by the world, and `emailField`
here would print every contributor's address beside their article forever.

`selfUpdate` / `selfDelete` — a writer may rewrite the listed fields of their own published
article, and may delete it. `slug` and `publishedAt` are absent from `selfUpdate` because they are
frozen; that is not a policy in the page, it is the rules, and `viewer.can.<cid>.frozen` tells the
page so.

`limit.articles` — how many the index reads. Read the index-cost trap before raising it.

## .claude/skills/articles/schema.json

```json
{
  "title": "Articles",
  "icon": "article",
  "primaryKey": "id",
  "storage": { "type": "firestore" },
  "fields": {
    "id": { "type": "string", "label": "ID", "primary": true, "required": true },
    "slug": { "type": "string", "label": "URL name", "required": true },
    "title": { "type": "string", "label": "Headline", "required": true },
    "summary": { "type": "text", "label": "Standfirst (the two lines in the index)" },
    "body": { "type": "markdown", "label": "Body (Markdown)", "required": true },
    "tags": { "type": "string", "label": "Tags (comma separated)" },
    "byline": { "type": "string", "label": "Byline" },
    "byUid": { "type": "string", "label": "Published by (uid)" },
    "status": { "type": "enum", "label": "Status", "values": ["published"], "default": "published" },
    "publishedAt": { "type": "datetime", "label": "Published at" }
  }
}
```

`status` has exactly one value, and that is the honest declaration for this shape. An enum with
`draft` in it would compile, publish, and lie: the row is readable by the world either way.

## views/home.html — the index the world sees

The masthead is the whole reason this page exists. The platform draws each article for you; what
it has no place for is the thing that says *whose* magazine this is. Everything below the header is
a list of cards that open one article each.

```html
<style>
  * { box-sizing: border-box; }
  :root {
    --hue: 115;
    --main:  oklch(47% .09 var(--hue));
    --line:  oklch(47% .09 var(--hue) / .16);
    --muted: oklch(53% .02 var(--hue));
    --fill:  oklch(96% .018 var(--hue));
    --ink:   oklch(23% .015 var(--hue));
    --paper: oklch(99.4% .007 85);
    --bad:   oklch(48% .16 25);
  }
  html { min-height: 100%; color: var(--ink); color-scheme: light; background: var(--paper); background-image: linear-gradient(180deg, oklch(98.6% .01 var(--hue)) 0, oklch(96.4% .012 var(--hue)) 100%); background-attachment: fixed; }
  body {
    margin: 0;
    padding: clamp(18px, 4vw, 44px) clamp(14px, 3.5vw, 26px) 80px;
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    line-height: 1.55;
  }
  .wrap { max-width: 760px; margin: 0 auto; }

  header.masthead { margin: 0 0 clamp(20px, 4vw, 34px); }
  .eyebrow {
    font-size: 12px; font-weight: 800; letter-spacing: .16em;
    text-transform: uppercase; color: var(--main); margin: 0 0 10px;
  }
  h1 { margin: 0; font-size: clamp(30px, 7vw, 46px); line-height: 1.05; letter-spacing: -.035em; font-weight: 800; }
  .standfirst { margin: 12px 0 0; color: var(--muted); font-size: clamp(14px, 2.6vw, 16px); max-width: 46ch; }

  .feed { list-style: none; margin: 0; padding: 0; display: grid; gap: 14px; }
  .card {
    display: block; width: 100%; text-align: left; cursor: pointer;
    background: var(--paper); border: 1px solid var(--line); border-radius: 20px;
    padding: clamp(16px, 3vw, 24px); font: inherit; color: inherit;
    box-shadow: 0 14px 40px oklch(30% .05 var(--hue) / .06);
    transition: border-color .15s, transform .15s;
  }
  .card:hover { border-color: oklch(47% .09 var(--hue) / .38); transform: translateY(-1px); }
  .card:focus-visible { outline: 2px solid var(--main); outline-offset: 2px; }
  .stamp { margin: 0 0 6px; font-size: 12px; font-weight: 700; letter-spacing: .06em; color: var(--muted); }
  .headline { margin: 0; font-size: clamp(18px, 3.4vw, 22px); line-height: 1.25; letter-spacing: -.02em; font-weight: 780; }
  .dek { margin: 8px 0 0; color: var(--muted); font-size: 14.5px; }
  .byline { margin: 10px 0 0; font-size: 12.5px; font-weight: 700; color: var(--main); }
  .tags { margin: 10px 0 0; font-size: 12px; color: var(--muted); }
  .miss { margin: 10px 0 0; font-size: 12.5px; font-weight: 700; color: var(--bad); }

  .empty { margin: 0; padding: 28px; text-align: center; color: var(--muted); border: 1px dashed var(--line); border-radius: 20px; }
  footer { margin: clamp(28px, 5vw, 44px) 0 0; color: var(--muted); font-size: 12.5px; }
</style>

<div class="wrap">
  <header class="masthead">
    <p class="eyebrow">Field Notes</p>
    <h1>What we worked out this week</h1>
    <p class="standfirst">Written by the people who did the work. Everyone here signs their own
      pieces and edits nobody else's.</p>
  </header>

  <ul class="feed" id="feed"></ul>
  <p class="empty" id="empty" hidden>Nothing published yet.</p>

  <footer id="foot"></footer>
</div>

<script>
  (function () {
    var view = window.__MC_APP_VIEW;
    var feed = document.getElementById("feed");
    var empty = document.getElementById("empty");
    var foot = document.getElementById("foot");

    var text = function (record, field) {
      var value = record && record[field];
      return typeof value === "string" ? value.trim() : "";
    };

    /** The server's stamp. `publishedAt` is frozen, and its string order IS its time order. */
    var dateOf = function (record) {
      var at = text(record, "publishedAt");
      if (at === "") return "";
      var when = new Date(at);
      if (isNaN(when.getTime())) return "";
      return when.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
    };

    var newestFirst = function (rows) {
      return rows.slice().sort(function (left, right) {
        return String(right && right.publishedAt || "").localeCompare(String(left && left.publishedAt || ""));
      });
    };

    var cardFor = function (record) {
      var id = typeof record.id === "string" ? record.id : "";
      var item = document.createElement("li");
      var card = document.createElement("button");
      card.type = "button";
      card.className = "card";

      var when = dateOf(record);
      if (when !== "") {
        var stamp = document.createElement("p");
        stamp.className = "stamp";
        stamp.textContent = when;
        card.appendChild(stamp);
      }

      var headline = document.createElement("h2");
      headline.className = "headline";
      // No headline? Show the URL name. The writer chose it, so it reads better than a placeholder.
      headline.textContent = text(record, "title") || id;
      card.appendChild(headline);

      var summary = text(record, "summary");
      if (summary !== "") {
        var dek = document.createElement("p");
        dek.className = "dek";
        dek.textContent = summary;
        card.appendChild(dek);
      }

      var byline = text(record, "byline");
      if (byline !== "") {
        var by = document.createElement("p");
        by.className = "byline";
        by.textContent = byline;
        card.appendChild(by);
      }

      var tags = text(record, "tags");
      if (tags !== "") {
        var tagLine = document.createElement("p");
        tagLine.className = "tags";
        tagLine.textContent = tags;
        card.appendChild(tagLine);
      }

      // To the article. **You cannot link out of this frame**: it is sandboxed with scripts and
      // nothing else, so there is no top navigation and no popup. `view.open` asks the host, and
      // names a RECORD rather than a URL — the host holds the slug and builds the address.
      //
      // The promise usually never settles, because a navigation destroys this document along with
      // it — so **settling means it did not happen**. In a frame that can draw no link, "I pressed
      // it and nothing moved" is the least diagnosable failure there is, so say it on the card.
      // Only an explicit `opened === false` counts: a host that answers nothing on success must
      // not be read as a refusal.
      card.addEventListener("click", function () {
        if (id === "" || !view || typeof view.open !== "function") return;
        Promise.resolve(view.open("articles", id)).then(function (res) {
          if (!res || res.opened !== false) return;
          var miss = card.querySelector(".miss");
          if (!miss) {
            miss = document.createElement("p");
            miss.className = "miss";
            card.appendChild(miss);
          }
          miss.textContent = "That article would not open. Try again in a moment.";
        });
      });

      item.appendChild(card);
      return item;
    };

    var render = function (data) {
      var rows = (data && data.articles) || [];
      feed.textContent = "";
      newestFirst(rows).forEach(function (record) {
        if (record && typeof record === "object") feed.appendChild(cardFor(record));
      });
      empty.hidden = rows.length > 0;
      // NOT "N articles": this page is handed at most `limit` of them, and how many exist in
      // total is not something it is told — telling it would mean reading them all.
      foot.textContent = rows.length === 0 ? "" : "Latest " + rows.length;
    };

    if (!view) {
      empty.hidden = false;
      empty.textContent = "This page only runs inside the host. Open it at /a/field-notes.";
      return;
    }

    view.onState(function (data) {
      render(data || {});
    });
    // OUTSIDE `onState`. Called from inside it, it is never called at all.
    view.ready();
  })();
</script>
```

## views/desk.html — where the writers work

One file, declared twice: as the `member` view (the owner reaches it at `/m/field-notes`) and as
the `participant` view (a writer reaches it at `/p/field-notes`). It is the same page because the
two audiences can do the same things here — which is the point of this shape — and `viewer.can`
is what draws the controls, so the page does not need to know which door it came through.

```html
<style>
  * { box-sizing: border-box; }
  :root {
    --hue: 115;
    --main:  oklch(47% .09 var(--hue));
    --line:  oklch(47% .09 var(--hue) / .16);
    --muted: oklch(53% .02 var(--hue));
    --fill:  oklch(96% .018 var(--hue));
    --ink:   oklch(23% .015 var(--hue));
    --paper: oklch(99.4% .007 85);
    --bad:   oklch(48% .16 25);
  }
  html { min-height: 100%; color: var(--ink); color-scheme: light; background: var(--paper); background-image: linear-gradient(180deg, oklch(98.6% .01 var(--hue)) 0, oklch(96.4% .012 var(--hue)) 100%); background-attachment: fixed; }
  body {
    margin: 0;
    padding: clamp(16px, 3.5vw, 36px) clamp(14px, 3.5vw, 26px) 72px;
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    line-height: 1.55;
  }
  .wrap { max-width: 820px; margin: 0 auto; display: grid; gap: 16px; }
  .panel {
    background: var(--paper); border: 1px solid var(--line);
    border-radius: 24px; padding: clamp(18px, 3.4vw, 28px);
    box-shadow: 0 18px 50px oklch(30% .05 var(--hue) / .08);
  }
  .eyebrow {
    font-size: 12px; font-weight: 800; letter-spacing: .16em;
    text-transform: uppercase; color: var(--main); margin: 0 0 8px;
  }
  h1 { margin: 0; font-size: clamp(22px, 4.4vw, 30px); line-height: 1.15; letter-spacing: -.03em; font-weight: 780; }
  h2 { margin: 0 0 14px; font-size: 17px; letter-spacing: -.015em; font-weight: 780; }
  .note { margin: 10px 0 0; color: var(--muted); font-size: 13.5px; }

  label { display: block; font-size: 12.5px; font-weight: 750; color: var(--muted); margin: 0 0 5px; }
  .field { margin: 0 0 14px; }
  input[type=text], textarea {
    width: 100%; background: #fff; color: var(--ink);
    border: 1px solid var(--line); border-radius: 12px;
    padding: 10px 12px; font: inherit; font-size: 15px;
  }
  textarea { resize: vertical; line-height: 1.55; }
  textarea.body { min-height: 220px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13.5px; }
  input:focus, textarea:focus { outline: 2px solid var(--main); outline-offset: 1px; border-color: transparent; }

  .btn {
    background: var(--main); color: var(--paper);
    border: 0; border-radius: 12px; padding: 10px 18px;
    font: inherit; font-weight: 750; font-size: 14px;
    min-height: 38px; touch-action: manipulation; cursor: pointer;
  }
  .btn.ghost { background: var(--fill); color: var(--main); }
  .btn.danger { background: oklch(52% .16 25); color: oklch(99% .005 25); }
  .btn.small { padding: 6px 12px; font-size: 12.5px; min-height: 32px; }
  .btn:disabled { opacity: .5; cursor: default; }
  .btn:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }

  .msg { margin: 12px 0 0; font-size: 13.5px; font-weight: 700; color: var(--main); }
  .msg.bad { color: var(--bad); }

  .row {
    display: grid; grid-template-columns: 1fr auto; gap: 12px; align-items: start;
    border: 1px solid var(--line); border-radius: 14px;
    padding: 12px 14px; margin: 0 0 10px; background: var(--paper);
  }
  .row:last-child { margin-bottom: 0; }
  .row.editing { border-radius: 14px 14px 0 0; margin-bottom: 0; }
  .row .t { font-weight: 780; font-size: 15px; letter-spacing: -.01em; }
  .row .m { margin-top: 4px; font-size: 12.5px; color: var(--muted); }
  .row .side { display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end; align-items: center; }
  .confirm { font-size: 12.5px; font-weight: 700; color: var(--bad); margin-right: 4px; }

  .editor {
    border: 1px solid var(--line); border-top: 0;
    border-radius: 0 0 14px 14px; background: var(--fill);
    padding: 14px 14px 12px; margin: 0 0 10px;
  }
  .editor input[type=text], .editor textarea { background: var(--paper); }

  @media (max-width: 680px) {
    .row { grid-template-columns: 1fr; }
    .row .side { justify-content: flex-start; }
    .btn { width: 100%; }
    .btn.small { width: auto; }
  }
</style>

<div class="wrap">
  <div class="panel">
    <p class="eyebrow">Field Notes</p>
    <h1>The desk</h1>
    <p class="note">Publishing puts the article on <strong>/a/field-notes</strong> immediately, for
      everybody. There are no drafts here, and <strong>the only way to withdraw one is to delete
      it</strong>, which cannot be undone.</p>
    <p class="note">A published article can be <strong>rewritten in place</strong> — headline,
      standfirst, body, tags. <strong>Its URL name and its date do not change</strong>: the rules
      froze both when it was created, so a link that once resolved goes on resolving. An article
      that needs a different name is a different article.</p>
    <p class="note">Writers here are <strong>equals</strong>. You can edit and delete
      <strong>only what you published</strong>, and that includes whoever set the magazine up.
      Nobody can reach everybody's work. The list below shows everyone's articles — they are public,
      so of course you can read them — but <strong>the controls appear only on your own</strong>.
      While the host has not yet answered which ones are yours, they appear on every row; press one
      on somebody else's article and <strong>the rules refuse it</strong>. The list says so when
      that is the state you are in.</p>
    <p class="note"><strong>The byline is filled in for you</strong> — from the part of your address
      before the <code>@</code>. <strong>Only that name is published; your email address is
      not.</strong> It appears under the headline on the article and at the foot of the card in the
      index. <strong>It is a default, not an identity</strong>: you can change it here or later, and
      the rules never check it. What does record who published an article is <code>byUid</code>,
      which is never drawn.</p>
  </div>

  <div class="panel" id="compose">
    <h2>New article</h2>
    <p class="note" id="composeNote">Loading…</p>
  </div>

  <div class="panel">
    <h2>Articles</h2>
    <div id="list"><p class="note">Loading…</p></div>
  </div>
</div>

<script>
  (function () {
    var view = window.__MC_APP_VIEW;
    var compose = document.getElementById("compose");
    var composeNote = document.getElementById("composeNote");
    var list = document.getElementById("list");
    var latest = null;
    var built = false;
    var arming = {};    // id -> its delete confirmation is showing
    // The article being rewritten, and what has been typed into it. `list` is rebuilt whenever
    // state arrives, so anything held inside it is thrown away the moment somebody else publishes.
    var editing = null; // { id, values, saving, msg, bad, node, nodes, keys, record, can, fields }

    var el = function (tag, cls, text) {
      var n = document.createElement(tag);
      if (cls) n.className = cls;
      if (text != null) n.textContent = text;
      return n;
    };

    // `publishedAt` is a server Timestamp, and it reaches the page as a `…Z` string.
    var when = function (v) {
      var m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(String(v || ""));
      if (!m) return "";
      return m[1] + "-" + m[2] + "-" + m[3] + (m[4] ? " " + m[4] + ":" + m[5] : "");
    };

    // A URL name out of a headline. Anything that is not a-z, 0-9 or a hyphen is dropped, so a
    // headline with no Latin letters in it produces nothing and the writer is asked for a name.
    var slugify = function (text) {
      return String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64).replace(/-+$/, "");
    };

    var capOf = function () {
      return (latest && latest.viewer && latest.viewer.can && latest.viewer.can.articles) || {};
    };
    var rows = function () {
      return ((latest && latest.data && latest.data.articles) || []).slice().sort(function (a, b) {
        return String(b.publishedAt || "").localeCompare(String(a.publishedAt || ""));
      });
    };

    var LABELS = { title: "Headline", slug: "URL name", summary: "Standfirst", body: "Body", tags: "Tags", byline: "Byline" };
    var labelOf = function (key) {
      return Object.prototype.hasOwnProperty.call(LABELS, key) ? LABELS[key] : key;
    };

    /** The default byline: the part of the signed-in address before the `@`.
     *
     *  **Do not keep a table here.** The obvious next step is a map of address to display name so
     *  that a byline cannot be faked — and it is a second roster, kept by hand, beside the one in
     *  `app.json`. Nobody owns keeping the two in step, so it drifts, and the guarantee it offers
     *  reaches only the addresses somebody remembered to add.
     *
     *  **The guarantee is not available anyway.** No rule looks at `byline`, and `selfUpdate` lists
     *  it, so whatever the form does at submission time can be undone by the writer a second later.
     *  So fill the field in and let it be edited, and make the page's own words true instead.
     *  Who published an article is `byUid`, which the host fills in and the page never draws.
     *
     *  The address itself is not published: only the part before the `@` is, and this page is
     *  reachable only by the roster. */
    var bylineOf = function () {
      var me = String((latest && latest.viewer && latest.viewer.me) || "");
      var at = me.indexOf("@");
      return at > 0 ? me.slice(0, at) : "";
    };

    // The one bound the rules do not also make. The host refuses an over-long value too, but
    // saying it here lets the refusal **name the field and the number**.
    var overLong = function (values) {
      var caps = capOf().maxBytes || {};
      var over = [];
      Object.keys(values).forEach(function (key) {
        if (!Object.prototype.hasOwnProperty.call(caps, key)) return;
        var cap = caps[key];
        if (typeof cap !== "number") return;
        var bytes = new TextEncoder().encode(String(values[key])).length;
        if (bytes > cap) over.push(labelOf(key) + " is " + bytes + " bytes, over the limit of " + cap);
      });
      return over;
    };
    var overLongMessage = function (over) {
      return over.join(". ") + ". That is UTF-8 bytes rather than characters, and a non-Latin character is usually 3. Nothing was sent.";
    };

    // ---- New article (built ONCE; rebuilding it throws away what is half-typed) ----
    var buildCompose = function () {
      compose.replaceChildren();
      compose.appendChild(el("h2", null, "New article"));

      var mk = function (labelText, node) {
        var f = el("div", "field");
        f.appendChild(el("label", null, labelText));
        f.appendChild(node);
        return f;
      };
      var input = function (ph) {
        var n = document.createElement("input");
        n.type = "text";
        n.placeholder = ph || "";
        return n;
      };

      var title = input("Why our deploys got slower");
      var summary = document.createElement("textarea");
      summary.rows = 2;
      var tags = input("deploys, ci");
      var body = document.createElement("textarea");
      body.className = "body";
      body.placeholder = "Markdown: headings, **bold**, `code`, quotes, lists and\n[links](https://example.com). Images cannot be stored.";

      var slug = document.createElement("input");
      slug.type = "text";
      slug.placeholder = "why-our-deploys-got-slower";
      var slugTouched = false;
      slug.oninput = function () { slugTouched = true; };
      title.oninput = function () { if (!slugTouched) slug.value = slugify(title.value); };

      compose.appendChild(mk("Headline", title));
      compose.appendChild(mk("URL name — becomes /a/field-notes/<name>, and can never be changed", slug));
      compose.appendChild(mk("Standfirst — the two lines the index shows", summary));
      compose.appendChild(mk("Tags — comma separated", tags));

      var byline = input("your name");
      byline.value = bylineOf();
      compose.appendChild(mk("Byline — printed under the headline and in the index. Editable (empty means unsigned)", byline));

      compose.appendChild(mk("Body (Markdown)", body));

      var actions = el("div", "actions");
      var post = el("button", "btn", "Publish");
      post.type = "button";
      actions.appendChild(post);
      compose.appendChild(actions);

      var msg = el("p", "msg");
      compose.appendChild(msg);
      var say = function (text, bad) {
        msg.textContent = text || "";
        msg.className = bad ? "msg bad" : "msg";
      };

      post.onclick = function () {
        if (!(title.value || "").trim()) { say("A headline is required.", true); return; }
        if (!(body.value || "").trim()) { say("There is no body.", true); return; }
        var name = slugify(slug.value || title.value);
        if (!name) { say("Choose a URL name (lowercase letters, digits, hyphens). One cannot be made from this headline.", true); return; }
        // The URL name IS the document id, so the same one cannot be created twice: the rules
        // allow only a create, and what comes back is a PERMISSION_DENIED that names no field.
        // This page holds every article — they are public — so it can say so before sending.
        if (rows().some(function (r) { return r.id === name; })) {
          say("The URL name " + name + " is already taken. Every article needs its own — check the list and pick another. Nothing was sent.", true);
          return;
        }

        var written = {
          slug: name,
          title: title.value.trim(),
          summary: (summary.value || "").trim(),
          tags: (tags.value || "").trim(),
          byline: (byline.value || "").trim(),
          body: body.value
          // `publishedAt` and `byUid` are NOT sent. The host and the rules fill in and freeze both.
        };
        var over = overLong(written);
        if (over.length > 0) { say(overLongMessage(over), true); return; }

        post.disabled = true;
        say("");
        view.submit("articles", written).then(function (res) {
          post.disabled = false;
          if (res && res.ok) {
            say("Published. It is readable at /a/field-notes/" + name + ".");
            title.value = ""; summary.value = ""; tags.value = ""; body.value = ""; slug.value = "";
            slugTouched = false;
            return;
          }
          if (res && res.error === "cancelled") { say(""); return; }
          say("Could not publish: " + ((res && res.error) || "unknown") + ". Most often the URL name " + name + " was taken by somebody a moment earlier, and another name will work. Otherwise: only people on the roster may publish, so if you were invited just now the app may not have been published since.", true);
        });
      };
    };

    // There is no capability that says "may create" — creating is not among them. So the form is
    // drawn for everybody who can open this page, which is only ever the roster, and a refusal is
    // reported with its reason.
    var renderCompose = function () {
      if (built) return;
      buildCompose();
      built = true;
    };

    // ---- Rewriting what has been published ----
    var EDITABLE = [
      { key: "title", label: "Headline", kind: "text" },
      { key: "summary", label: "Standfirst", kind: "area" },
      { key: "tags", label: "Tags (comma separated)", kind: "text" },
      { key: "byline", label: "Byline", kind: "text" },
      { key: "body", label: "Body (Markdown)", kind: "body" }
    ];

    // Who may rewrite what. The question is asked of the CAPABILITY, never of the audience.
    // `can.frozen` is what NOBODY may write (slug, publishedAt, byUid, status). `correctFrom` is
    // your own article, per status. `correctAny` — reaching everybody's — is held by nobody in
    // this app; it is read anyway so that the page stays correct the day somebody is made editor.
    var editableFields = function (can, status) {
      var frozen = can.frozen || [];
      var reachable = EDITABLE.filter(function (f) { return frozen.indexOf(f.key) === -1; });
      if (can.correctAny === true) return reachable;
      var byStatus = can.correctFrom || {};
      var allowed = Object.prototype.hasOwnProperty.call(byStatus, status) ? byStatus[status] || [] : [];
      return reachable.filter(function (f) { return allowed.indexOf(f.key) !== -1; });
    };

    /** Which articles are yours — **as the host read them with the reader's own credentials**
     *  (`viewer.mine`).
     *
     *  Not an answer the page computes by comparing uids. The projection does not carry the
     *  reader's uid, and whose a row is belongs to the rules; `mine` answers the same question the
     *  same way round — the rows themselves, read as the reader.
     *
     *  **There is a THIRD state.** `null` is not "you have none", it is **"nobody looked"** — the
     *  host has not answered, or cannot. Read as "none", it takes the controls off your OWN
     *  articles. So on `null` every row is drawn (the rules refuse the wrong ones) and the list
     *  says why. */
    var mineIds = function () {
      var mine = (latest && latest.viewer && latest.viewer.mine) || {};
      if (!Object.prototype.hasOwnProperty.call(mine, "articles")) return null;
      var rows = mine.articles;
      if (!Array.isArray(rows)) return null;
      var ids = {};
      rows.forEach(function (r) {
        if (r && typeof r.id === "string") ids[r.id] = true;
      });
      return ids;
    };

    /** Somebody whose ROLE reaches every article. Nobody here — but somebody the day a member's
     *  `articles` is changed to `editor`. */
    var isDesk = function () {
      var can = capOf();
      return can.correctAny === true || can.withdrawAny === true;
    };

    /** Is this row within reach: by role, or because it is yours? On "nobody looked", true —
     *  draw it, and let the rules refuse. */
    var reaches = function (id) {
      if (isDesk()) return true;
      var ids = mineIds();
      return ids === null || ids[id] === true;
    };

    // Deletable? In this app only `withdrawFrom` (your own, from that status): `writerDelete` is
    // not declared, so `withdrawAny` is held by nobody. Nobody reaching everybody is the design.
    var mayWithdraw = function (can, status) {
      if (can.withdrawAny === true) return true;
      var from = can.withdrawFrom || [];
      return from.indexOf(status) !== -1;
    };
    /** A refusal, with this reader's boundary added. Controls are only drawn on your own articles,
     *  so arriving here means a conflict — or a press made **before `viewer.mine` had answered**. */
    var refusalNote = function (can, error) {
      var own = can.correctAny !== true;
      return (error || "unknown") + (own ? " (only articles you published)" : "");
    };

    // Three parts that keep somebody's hands on the keyboard when state arrives mid-sentence.
    // **The editor is not rebuilt.** Rebuilding keeps the text (it is in `editing.values`) but
    // loses **the caret and the undo history** — and state arrives when anybody publishes, which
    // is indistinguishable from the middle of a sentence. `editorFor` reuses the node, `syncEditor`
    // changes only state, and `focusMemo` / `restoreFocus` carry the caret: `replaceChildren()`
    // detaches the focused element, so re-appending the same node is not enough on its own.
    var syncEditor = function () {
      if (editing === null || !editing.node) return;
      var saving = editing.saving === true;
      Object.keys(editing.nodes).forEach(function (key) { editing.nodes[key].disabled = saving; });
      editing.saveBtn.textContent = saving ? "Saving…" : "Save";
      editing.saveBtn.disabled = saving;
      editing.cancelBtn.disabled = saving;
      editing.msgNode.textContent = editing.msg || "";
      editing.msgNode.className = editing.bad ? "msg bad" : "msg";
      editing.msgNode.hidden = !editing.msg;
    };

    var focusMemo = function () {
      if (editing === null || !editing.nodes) return null;
      var active = document.activeElement;
      var found = null;
      Object.keys(editing.nodes).forEach(function (key) { if (editing.nodes[key] === active) found = key; });
      if (found === null) return null;
      return { key: found, start: active.selectionStart, end: active.selectionEnd };
    };

    var restoreFocus = function (memo) {
      if (memo === null || editing === null || !editing.nodes) return;
      var node = editing.nodes[memo.key];
      if (!node || node.disabled) return;
      node.focus();
      if (typeof memo.start === "number" && typeof node.setSelectionRange === "function") node.setSelectionRange(memo.start, memo.end);
    };

    /** Reuse, or build. Rebuilt only when the set of writable fields changes — a status can move,
     *  and `correctFrom` moves with it. */
    var editorFor = function (record, fields, can) {
      var keys = fields.map(function (f) { return f.key; }).join(",");
      // The record is replaced every time. What is reused is the FIELDS, not the baseline they are
      // compared against — against a stale record, a field somebody else corrected reads as
      // unchanged and is dropped from the write.
      editing.record = record;
      editing.can = can;
      editing.fields = fields;
      if (editing.node && editing.keys === keys) {
        syncEditor();
        return editing.node;
      }

      var box = el("div", "editor");
      editing.nodes = {};
      editing.keys = keys;
      fields.forEach(function (f) {
        var wrap = el("div", "field");
        wrap.appendChild(el("label", null, f.label));
        var node;
        if (f.kind === "text") {
          node = document.createElement("input");
          node.type = "text";
        } else {
          node = document.createElement("textarea");
          if (f.kind === "body") node.className = "body";
          else node.rows = 2;
        }
        node.value = editing.values[f.key] != null ? editing.values[f.key] : String(record[f.key] || "");
        node.oninput = function () { editing.values[f.key] = node.value; };
        editing.nodes[f.key] = node;
        wrap.appendChild(node);
        box.appendChild(wrap);
      });

      var actions = el("div", "actions");
      var save = el("button", "btn small", "Save");
      save.type = "button";
      var cancel = el("button", "btn ghost small", "Cancel");
      cancel.type = "button";
      actions.appendChild(save);
      actions.appendChild(cancel);
      box.appendChild(actions);
      var msg = el("p", "msg");
      box.appendChild(msg);

      editing.node = box;
      editing.saveBtn = save;
      editing.cancelBtn = cancel;
      editing.msgNode = msg;

      cancel.onclick = function () { editing = null; renderList(); };

      save.onclick = function () {
        var record = editing.record;
        var can = editing.can;
        // Only what changed. Sending everything rewrites fields nobody touched.
        var changed = {};
        var any = false;
        editing.fields.forEach(function (f) {
          var was = String(record[f.key] || "");
          var now = editing.values[f.key] != null ? editing.values[f.key] : was;
          if (now !== was) { changed[f.key] = now; any = true; }
        });
        if (!any) { editing.msg = "Nothing has changed."; editing.bad = false; syncEditor(); return; }

        var over = overLong(changed);
        if (over.length > 0) { editing.msg = overLongMessage(over); editing.bad = true; syncEditor(); return; }

        editing.saving = true;
        editing.msg = "";
        syncEditor();
        view.correct("articles", record.id, changed).then(function (res) {
          if (editing === null) return;
          if (res && res.ok) { editing = null; renderList(); return; }
          editing.saving = false;
          if (res && res.error === "cancelled") { editing.msg = ""; syncEditor(); return; }
          editing.msg = "Could not save: " + refusalNote(can, res && res.error) + ". Nothing was written.";
          editing.bad = true;
          syncEditor();
        });
      };

      syncEditor();
      return box;
    };

    // ---- The list ----
    var renderList = function () {
      var can = capOf();
      var all = rows();
      // Taken before anything is detached; put back after the editor is appended, at the end.
      var memo = focusMemo();
      list.replaceChildren();

      // The article being rewritten may be gone (its author deleted it).
      if (editing !== null && !all.some(function (r) { return r.id === editing.id; })) editing = null;

      // Clear the "are you sure?" of an article that no longer exists. Left behind, it reappears
      // open on whatever is published under that URL name next.
      var living = {};
      all.forEach(function (r) { living[r.id] = true; });
      Object.keys(arming).forEach(function (id) { if (living[id] !== true) delete arming[id]; });

      if (!all.length) {
        list.appendChild(el("p", "note", "Nothing published yet."));
        return;
      }

      // Say the third state out loud, not only in the code: while it holds, the controls are on
      // every row, which contradicts what the panel above promises.
      if (!isDesk() && mineIds() === null) {
        list.appendChild(el("p", "note", "The host has not yet said which of these are yours. Until it does the controls appear on every row, but the rules will refuse anything that is not your article."));
      }

      all.forEach(function (r) {
        var row = el("div", "row");
        var main = el("div");
        main.appendChild(el("div", "t", r.title || r.id));
        var bits = [];
        if (r.publishedAt) bits.push(when(r.publishedAt));
        bits.push(r.id);
        if (r.tags) bits.push(r.tags);
        main.appendChild(el("div", "m", bits.join("  ·  ")));
        row.appendChild(main);

        var side = el("div", "side");
        var reachable = reaches(r.id);
        var fields = reachable ? editableFields(can, r.status) : [];
        var open = editing !== null && editing.id === r.id;

        if (fields.length > 0) {
          var edit = el("button", "btn ghost small", open ? "Close" : "Rewrite");
          edit.type = "button";
          edit.onclick = function () {
            // One at a time. Two open editors are two half-written articles.
            editing = open ? null : { id: r.id, values: {}, saving: false, msg: "", bad: false };
            renderList();
          };
          side.appendChild(edit);
        }

        if (reachable && mayWithdraw(can, r.status)) {
          if (arming[r.id]) {
            side.appendChild(el("span", "confirm", "Deleting this cannot be undone. Sure?"));
            var yes = el("button", "btn danger small", "Delete");
            yes.type = "button";
            yes.onclick = function () {
              yes.disabled = true;
              view.withdraw("articles", r.id).then(function (res) {
                delete arming[r.id];
                if (!res || !res.ok) {
                  yes.disabled = false;
                  if (res && res.error === "cancelled") { renderList(); return; }
                  main.appendChild(el("div", "m", "Could not delete: " + refusalNote(can, res && res.error)));
                  return;
                }
                renderList();
              });
            };
            var no = el("button", "btn ghost small", "Keep");
            no.type = "button";
            no.onclick = function () { delete arming[r.id]; renderList(); };
            side.appendChild(yes);
            side.appendChild(no);
          } else {
            var del = el("button", "btn ghost small", "Delete");
            del.type = "button";
            del.onclick = function () { arming[r.id] = true; renderList(); };
            side.appendChild(del);
          }
        }

        row.appendChild(side);
        if (open) row.className = "row editing";
        list.appendChild(row);
        if (open) list.appendChild(editorFor(r, fields, can));
      });

      restoreFocus(memo);
    };

    if (!view) {
      composeNote.textContent = "This page only runs inside the host. Open it at /p/field-notes (whoever set the magazine up can also use /m/field-notes).";
      return;
    }

    view.onState(function (data, viewer) {
      latest = { data: data || {}, viewer: viewer || {} };
      renderCompose();
      renderList();
    });
    // OUTSIDE `onState`. Called from inside it, it is never called at all.
    view.ready();
  })();
</script>
```

## Why the shape is this way — the seven decisions

### 1. The owner has to demote themselves, and that is not a workaround

`members` gives the owner `"*": "owner"` **and** `"articles": "participant"`. It looks like a
mistake and it is the only shape that works. Three declarations chain:

- A role is resolved **per collection first**: `held[cid] ?? held["*"]`. So the entry under
  `articles` wins over the app-wide one, and on this collection the owner is a participant.
- `audience: "participant"` forces `submitOnly: true` — publish refuses the pair without it.
- `submitOnly` **closes the writer branch of the rules**. An owner or editor normally creates rows
  through that branch, bypassing the public-create path entirely. With it closed, the only way in
  is the public-create path, and that path checks `r == "participant"`.

So an owner who keeps `"*": "owner"` alone on this collection **cannot publish an article at all**.
Demoting themselves is what buys the byte caps: the caps are held by publish and by the host and by
no rule, which is worthless against a stranger and sufficient against people the owner invited by
name.

What it costs is real and worth stating in the app's own pages: **nobody can correct or delete
anybody else's article**, the owner included. If you want a chief editor, give one member
`"articles": "editor"` — `correctAny` and `withdrawAny` appear in `viewer.can`, and the pages here
already read both, so no page changes.

### 2. The index has a price, and publish knows the number

`limit` times the sum of the caps on **every field the article view draws** must stay under
1,000,000 bytes. Here: 10 × (200 + 800 + 60000 + 100) = 611,000.

**At least that**, not exactly. A rule cannot project a field away, so the index downloads whole
records — the slug, the status, the stamp and everything else rides along uncounted. And the body
is downloaded on the index **even though the index never draws it**.

Two things follow. Raising `limit` to 16 puts this declaration at 977,600 — under the ceiling, and
2% from being refused by the next cap somebody adds. And if you want a long-form body *and* a long
index, the only real answer is a second collection carrying title and summary alone; there is no
declaration that makes the index cheap.

### 3. `protocol` is `2.0.0` here and `1.0.0` in every other template

The floor says what a reader must understand to draw this app. Article views arrived in `2.0.0`,
so an app with one has to say so; every other shape here keeps `1.0.0` because declaring a newer
floor than you use makes older readers refuse an app they could have drawn perfectly well.

Do not copy this line into an app that has no `article` view.

### 4. The URL is the document id, so it is decided once

`idFrom: "slug"` means the writer names the document. The rules check the grammar — lowercase
letters, digits and hyphens, starting with a letter or digit, 64 characters — and then freeze it.
A link that resolved once must go on resolving, so **there is no rename**: an article that needs a
different address is a different article.

The consequence people meet first is the **duplicate**. Creating over an existing id is refused,
and what comes back is a bare `PERMISSION_DENIED` naming no field — indistinguishable, from the
page, from not being on the roster. The desk holds every article (they are public), so it checks
the name against the list *before sending* and says exactly that. Keep this if you copy the page:
the refusal is otherwise the most confusing thing in the app.

### 5. Two fields are the server's, and sending them is what breaks

`publishedAt` (`stampField`) and `byUid` (`uidField`) must be listed in `createFields` — the rules
refuse any key outside that list, and they require the record to carry the stamp — but **the page
and the agent must never put a value in either**. The host fills them in at submission. This is the
one part of the declaration that reads as though the writer should supply them, and both failures
are silent-looking: a submission carrying a stamp is refused with no field named.

Both are frozen afterwards, so `viewer.can.articles.frozen` lists them, and the desk builds its
edit form by subtracting `frozen` rather than by knowing which fields those are.

### 6. There is no draft, and no status can invent one

Every row of `articles` is readable by the world, and a Firestore rule cannot hide a field. So a
`status` of `draft` would not hide anything: the row is published the moment it exists. `status`
has exactly one value here for that reason, and the app's own words say where work in progress
goes — ordinary files, outside the app.

If drafts genuinely matter, they need a **second collection** that the public cannot read, and a
copy on publication. That is a different app, and a bigger one than it sounds.

### 7. A byline is a name, not an identity

`byline` is a string the writer types. No rule checks it, and `selfUpdate` lists it, so it can be
changed at any time to anything. Two things follow.

**Do not build a table of address to display name inside the page.** It is a second roster beside
`app.json`, kept by hand, and it can only pretend to give a guarantee that `selfUpdate` hands
straight back. Fill the field in from the signed-in address and let it be edited.

**Never let an email address reach this field.** Everything in this collection is drawn to the
whole world, forever. That is also why the publisher is recorded as `byUid` rather than through
`emailField`: a uid cannot be printed as a name, and an address must not be.

## Traps

- **`manageCollection`'s `putItems` cannot write here.** `stampField` and `idFrom` together are
  outside what it produces, and the refusal names no field. Creation is `useSharedApp`'s `submit`,
  correction is `correct`, removal is `withdraw`.
- **`viewer.mine` has three states, not two.** `null` means *nobody looked*, not *you have none* —
  read as "none" it takes the controls off the reader's own articles. Draw every row in that state,
  let the rules refuse, and say so on the page; the desk here does all three.
- **Do not rebuild an open editor.** State arrives whenever anybody publishes, which is
  indistinguishable from the middle of somebody's sentence. Keeping the typed text is not enough:
  `replaceChildren()` detaches the focused element, so the caret and the undo history go too.
- **`view.open` is the only way out of the frame.** The page is sandboxed with scripts and nothing
  else — a link does nothing, and so does a popup. The promise usually never settles, because the
  navigation destroys the document; **settling means it did not happen**, and only an explicit
  `opened === false` should be drawn as a failure.
- **`ready()` goes outside `onState`.** Inside it, nothing is ever sent and the page waits forever.
- **No `<form>`, no `alert` / `confirm` / `prompt`.** Both are absent from the sandbox and both
  fail by doing nothing at all. A destructive action asks its question by drawing it, as the
  delete confirmation here does.
- **`slug` must not be the schema's `primaryKey`.** Publish refuses it: the rules can pin a
  document id but not the value of a field. Keep `id` as the primary key and `slug` as an
  ordinary field that `idFrom` reads.
- **The index count is a page, not a total.** A public page is handed at most `limit` records and
  is never told how many exist, so "10 articles" in a footer is a claim the page cannot make.

## The order to build it in

1. `manageSharedApp` `action: "init"` with the name and the slug. It writes `app.json`, mints the
   `aid` and reserves the slug; never compose the declaration by hand.
2. Write `.claude/skills/articles/schema.json`, then the `collections`, `views` and `public` blocks
   above. Change `--hue` in both pages before you write anything else in them.
3. `manageSharedApp` `action: "check"` — it runs the same gate publish runs.
4. `manageSharedApp` `action: "preview"` for each page. It runs them in a real browser and reports
   what happened; it writes nothing.
5. `invite` each writer. A writer needs no repository and no account here — just the address on the
   roster and a link to `/p/{slug}`.
6. `publish`. The index is at `/a/{slug}`, an article at `/a/{slug}/{name}`, and the desk at
   `/m/{slug}` for the owner and `/p/{slug}` for a writer.
