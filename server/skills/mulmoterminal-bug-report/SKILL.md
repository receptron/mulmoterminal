---
name: mulmoterminal-bug-report
description: Help desk for "MulmoTerminal is broken". Hears out the symptom, then checks whether the behaviour is actually configuration or by design — reading the real config, schema and version rather than guessing — searches the existing issues, and only files a GitHub issue for what survives all of that, with the environment and repro details collected and masked. Use when the user says MulmoTerminal is broken / weird / not working, wants to report a bug or file an issue about it, or asks why MulmoTerminal behaves the way it does. Works in whatever language the user writes in.
---

# MulmoTerminal — is it a bug?

**The goal is that the user ends up unblocked, not that an issue gets filed.** An issue is what's
left after the other three steps fail to explain the behaviour.

Work the steps in order. Stop the moment the user is unblocked.

## Rules that hold in every step

- **Never assert "that's by design" from memory.** Say it only with a reason attached: a config key,
  an implementation file, a guide page. `faq.md` is an index of where to look — it deliberately
  contains no values.
- **Read the real thing.** Current and default values come from the user's actual config file, the
  schema in the source, or the running server — never from this file, and never from recollection.
- **"I don't know" is an allowed answer.** If a step cannot decide, say so and go to the next one.
  Never close the conversation by guessing.
- **Nothing leaves the machine before the user has seen it in full** and said yes.
- Reply in the language the user writes in.

## Step 1 — Hear the symptom (collect nothing yet)

Ask with `AskUserQuestion`, options first — a user who is already frustrated should be picking, not
composing. Up to 4 questions per call; two calls cover this comfortably.

- **What kind** — display looks wrong / input doesn't work / a session died or won't connect /
  won't start at all / phone features / something else
- **Where** — a grid cell / the zoomed view / the single view / the file browser / settings / phone
- **Which agent** — claude / codex / shell / a launcher cell / a command cell
- **How often** — every time / sometimes / once
- **Since when** — after an update / it always did this / not sure

Then, in prose: **what did you expect, and what happened instead?** Those two sentences are what the
next step is judged against, so get them before touching anything else.

## Step 2 — Is it configuration, or by design? (this is the actual job)

1. Read `faq.md` (next to this file) and find the entry closest to the symptom.
2. Follow its pointers to the **real values**:
   - global config: `~/.mulmoterminal/config.json`
   - directory config: `<the directory in question>/.mulmoterminal.json`
   - the running server: `curl -s http://localhost:34567/api/config` (34567 is the default port;
     if the user changed it, it's the port in their browser's address bar). `/api/update-status`,
     `/api/sessions`, `/api/git-status?cwd=<dir>` and `/api/dir-config?cwd=<dir>` answer too.
   - the source files named by the entry, when the question is about accepted values or behaviour
3. If that explains the gap between expected and actual, **say why, show the fix, and stop.**
   - If the fix is a `.mulmoterminal.json`, hand off to `/mulmoterminal-config` instead of dictating
     JSON — it knows the schema and validates.
4. If nothing explains it, or the explanation is a guess, go to Step 3. Do not stretch the FAQ to
   cover a symptom it doesn't cover.

Solved here? Offer to post it as an **FAQ issue** (see the last section) — but only if someone else
would plausibly hit the same wall.

## Step 3 — Is it already known?

```bash
gh issue list --repo receptron/mulmoterminal --state all --limit 20 --search "<symptom keywords>"
```

No `gh`? Hand over the search URL instead:
`https://github.com/receptron/mulmoterminal/issues?q=<keywords>`

- **Closed and fixed** → compare the user's version against the release that fixed it. If they're
  simply behind, tell them to update and stop. (Version: the package's `package.json`;
  `/api/update-status` says whether a newer one exists.)
- **Open** → do not open a second one. Offer to add this user's environment and repro steps as a
  comment — a second reproduction is worth more than a duplicate.
- **Nothing found** → Step 4.

## Step 4 — File it

Only now collect details.

```bash
node -p "require('<install dir>/package.json').version"   # or the version in the web header
node -v && uname -sm && echo "$SHELL"
tmux -V; gh --version | head -1; claude --version; codex --version    # each may be absent
curl -s http://localhost:34567/api/update-status
curl -s http://localhost:34567/api/sessions      # summarize: cell count, agents, live vs tmux-only
curl -s "http://localhost:34567/api/git-status?cwd=<dir>"
cat ~/.mulmoterminal/config.json                  # mask before quoting
cat <dir>/.mulmoterminal.json                     # mask before quoting
```

Ask the user for what the host cannot see: the browser and its version, any red errors in the
browser console, and a screenshot if the symptom is visual.

**Masking, before anything is written into a report:**

- Anything key-shaped — `*_KEY`, `*_TOKEN`, `Authorization`, provider credentials — is reported as
  the key name with `***` for the value. Never the value, not even partially.
- Shorten the home directory to `~` in every path.
- A terminal screenshot can carry prompt text and internal paths — say so before it's attached.

**Report body:**

```markdown
## What happened
## What I expected
## Steps to reproduce
1.
## Environment
- mulmoterminal / Node / OS / browser
- tmux / gh / claude / codex
- how it was started (npx, local dev)
## Attachments
```

Show the whole thing, get an explicit yes, then:

```bash
gh issue create --repo receptron/mulmoterminal --title "<title>" --body-file <file>
```

No `gh`? Print the markdown for copy-paste plus
`https://github.com/receptron/mulmoterminal/issues/new`.

## FAQ issues (when Step 2 resolved it)

A question that took a human to answer is a signal about the product, so it's worth recording — but
only with the user's agreement, and never as an authoritative answer.

- Title: the question as the user asked it. Body: what was asked, what the answer turned out to be,
  and **where it was checked** (config key / file).
- Open the body with a line saying the answer came from this skill and is **awaiting maintainer
  review** — the answer here is a draft, not documentation.
- If an FAQ issue for the same question already exists, comment there instead of opening another.
- Never edit `faq.md` yourself. A maintainer reviews the issue and folds it into the repo; this
  skill only posts.
