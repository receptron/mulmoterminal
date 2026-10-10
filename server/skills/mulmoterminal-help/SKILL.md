---
name: mulmoterminal-help
description: Help desk for questions about MulmoTerminal itself — what it can do, how a feature or a part of the screen works, how to set something up, what is new in this version or in the latest one. Answers from the shipped guide, changelog, source and the running server, never from memory, and names where each fact was checked. Use when the user asks anything about MulmoTerminal that is not "it is broken" (that is mulmoterminal-bug-report) and not "change this setting for me" (that is mulmoterminal-config). Works in whatever language the user writes in.
---

# MulmoTerminal — ask anything about it

**Every answer is read, not remembered.** The guide, the changelog, the source and the running
server are on this machine; a sentence that none of them backs is a guess, and a guess about a
button that does not exist costs the user longer than "I could not find that". This skill exists so
the person asking gets the behaviour of the version they are running, in their own language, with the
place it was checked.

## Rules that hold in every answer

- **Never answer from memory.** Read the file or call the route, then answer. A general knowledge of
  terminals, Claude Code or similar apps is not evidence about MulmoTerminal.
- **Name where you checked** — a guide page, a source file, a route — in one short line after the
  answer. The user can follow it, and it is how a wrong answer gets caught.
- **Say which version you are describing.** The running version comes from the server (below). A
  newer release may exist; its features are not on this machine and must be introduced as "after you
  update", never as something the user can click now.
- **The source wins over the guide.** When a page and the implementation disagree, say the page is
  behind and answer from the code. When two pages disagree, the newer dated page wins.
- **"Not found" is an answer.** If nothing shipped describes it, say so and offer to look at the
  source or to ask in the project's Discussions. Do not fill the gap with what would be plausible.
- **Change nothing.** This skill reads. A user who wants a setting changed is handed to the skill that
  owns it (last section); a user whose app misbehaves is handed to `mulmoterminal-bug-report`.
- **Reply in the user's language.** Japanese readers get the `ja` guide; every other language reads
  `en` (that is also what the app does). Quote UI words as the user's interface shows them.
- **Short answers, one question at a time.** Lead with the answer, then how to get there, then the
  pointer. Offer the published page when the topic is wide.

## Step 0 — Find out what is running (once per session)

```sh
curl --noproxy localhost -s "http://localhost:${MULMOTERMINAL_PORT:-34567}/api/help/sources"
```

`MULMOTERMINAL_PORT` is set in every terminal MulmoTerminal opens; the fallback is the default port.
The answer names:

- `version` — the running release; `install` — `npm` (installed package) or `git` (a checkout, whose
  code may be newer than `version`; its unreleased work is listed under `## Unreleased` in the changelog).
- `packageDir` and, inside it, `files.readme`, `files.changelog`, `files.facts`, `files.guideDir`,
  `files.skillsDir`, `files.serverDir`, `files.commonDir`, `files.srcDir`. The `src` directory ships
  only in a git checkout; `dist/` is the built UI and is not readable prose.
- `urls.guide` (the published guide), `urls.changelog`, `urls.repository`, `urls.issues`.

Then, for the release state:

```sh
curl --noproxy localhost -s "http://localhost:${MULMOTERMINAL_PORT:-34567}/api/update-status"
```

`latest` is non-null only when a newer release exists; `notice` is the one-line update message the
app shows, command included; `commit` identifies a git build.

Keep `packageDir`, `version` and the guide language for the rest of the conversation.

## Where to look, by kind of question

`GUIDE` below is `files.guideDir/<lang>`. Pages are Jekyll markdown with front matter; the
`description:` line of each is its one-line index, so to find the page for a topic:

```sh
grep -H "^description:" "$GUIDE"/*.md
```

| The user asks | Read |
| --- | --- |
| What can it do? Is there a feature for X? | `feature-list.md` — every capability, one line, with the release it arrived in as `(vX.Y.Z)`; `features.md` — the reference tables by area; `README.md` at `files.readme` |
| How do I use X? What is this part of the screen? | The page for the area (table below), then `features.md`. Screenshots are on the published site, not in the package: link `urls.guide` + `<lang>/<page>.html` |
| How do I set up X? Which key? What does it accept? | `config.md`, `header-reference.md`; the owning skill's `SKILL.md` under `files.skillsDir` (it documents the keys it writes); then the schema in `files.serverDir/config/`. The sanitized live config: `GET /api/config` |
| What is new? What changed? | The next section |
| Which agents run, and what each supports | `agents.md`, `providers.md`, `claude-ollama.md`, `accounts.md`, `token-rotation.md` |
| Words it uses (cell, roster, cockpit, worktree, chip…) | `glossary.md` |
| How it compares; does my history carry over; cost | `faq.md`, `alternatives.md` |
| I just installed it | `getting-started.md`, `basics.md`, `scenarios.md` |

Area pages, all under `GUIDE`: `basics.md` (grid, cells, the zoomed views), `header.md` and
`header-reference.md` (a cell's buttons and chips), `worktree.md` (git worktrees), `github.md` (PRs
and issues), `notifications.md` (sounds, push), `phone.md`, `conversation.md` (cells talking to each
other), `from-collection.md` and `shared-apps.md` (collections and the apps built from them),
`blueprints.md`, `mulmocast.md`, `remote.md`, `config.md` (the config files and every global key).

The other bundled skills are documentation too: `files.skillsDir/mulmoterminal-config/SKILL.md`
lists every global setting and which skill owns it; `mulmoterminal-bug-report/faq.md` is an index of
symptoms to config keys and source files.

## What is new — the running version, and the one after it

1. **The running version's page**: `GUIDE/v<version>.md`. It is the release note the app shows after
   an upgrade, written for a user, under three headings — New features / What looks different /
   Under the hood (`新機能` / `画面の変化` / `見えない変化` in Japanese) — with each change's PR number.
   The same text, with links resolved against the published site:

   ```sh
   curl --noproxy localhost -s "http://localhost:${MULMOTERMINAL_PORT:-34567}/api/whats-new/version/<version>?lang=<en|ja>"
   ```

   `GET /api/whats-new/versions` lists every release page shipped, newest first, with its title.
2. **The changelog** at `files.changelog`: `## mulmoterminal@<version>` holds the per-PR detail of
   what changed and why. `## Unreleased` is work that is in a git checkout and in no release yet; on
   an `npm` install, nothing under it is running.
3. **A newer release** (`latest` from `/api/update-status` is non-null): its page is not on this
   machine. If the network is allowed, read `urls.guide` + `<lang>/v<latest>.html`, or the raw page
   at `https://raw.githubusercontent.com/receptron/mulmoterminal/<latest>/docs/guide/<lang>/v<latest>.md`
   (the release tag is the bare version). Then say plainly: what the user has, what the newer one
   adds, and the update command from `notice`. If it cannot be fetched, say that rather than guessing.
4. **"Since version X"**: the release pages between X and the running version are
   `ls "$GUIDE"/v*.md`, and `feature-list.md` marks each capability with the release it arrived in.

Introduce a new feature the way its page does — where to click, what appears — and point at the
page for the procedure rather than retyping it.

## When the docs are silent

Read the implementation and say that you did: "the guide does not cover this; `<file>` does `<x>`".
`files.serverDir` (Express backend, the PTY sessions, config schema and skills) and `files.commonDir`
(what the server and the UI share: config shapes, action names, bundled skill names) ship in every
install. The Vue UI's source is `files.srcDir`, present only on a git install. Search by the word the
UI shows — the five locale bundles under `src/i18n/` map every visible string to its key.

A config key is real only if the schema under `files.serverDir/config/` accepts it or `GET /api/config`
returns it. Do not name a key you have not seen there.

## Hand-offs

- **"It is broken" / "it does not do what the guide says"** — `/mulmoterminal-bug-report`. It checks
  the real config and version, searches the existing issues, and files one only when nothing explains
  the behaviour.
- **"Change it for me" / "set this up"** — `/mulmoterminal-config`, which routes to the skill that owns
  the area (`mulmoterminal-dirs`, `-theme`, `-header`, `-keys`, `-model`, `-notify`). Say also that
  Settings (the gear in the toolbar) has a control for most global settings, and a button that starts
  the owning skill where it does not.
- **"Build an app / a survey from a collection"** — `/mulmoterminal-shared-app`.
- **"Have I been asked this before?"** — `/mulmoterminal-decisions` reads past decisions.

Explain what the hand-off will do before invoking it, so the switch is not a surprise.
