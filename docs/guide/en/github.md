---
title: From a GitHub issue to a running agent in one click
nav_title: GitHub
layout: default
parent: English
nav_order: 15
description: See every registered repository's open PRs and issues in one full-screen cross-repo view.
---

# GitHub — cross-repo PRs & Issues
{: .no_toc }

- TOC
{:toc}

**See open Pull Requests and Issues across several repositories on one screen.** Which repo has
something waiting for review, whether CI is red — all at a glance, without hopping between sessions.
You choose which repos show up by **registering** them (just a list of `owner/repo`).

- A **full-screen view** from the toolbar's **Pull requests** button (the GitHub mark).
- Shows **both open PRs and Issues**, grouped **per repository**.
- Data comes through the **GitHub CLI (`gh`)** — it **uses your `gh` login**, so no token is stored in the app.

The **▶** on an issue row goes one step further: it creates a worktree for that issue and starts an
agent in it, in one click.

![The GitHub view: open PRs grouped by repository on top, Issues below, and a ▶ button at the right end of each issue row (Japanese UI)](../images/github-view-ja.png)

## Reading the screen

From the top of the screenshot down:

| Where | What it is |
|---|---|
| **Top line** | The title "GitHub pull requests & issues" and the **↻ (reload)** button. The **✕** at the far right closes the view (so does Esc) |
| **Start issues in** | The agent (Claude, Codex, …) that **▶** starts. Picking anything but Claude puts an amber warning under it ([why](#start-from-issue)) |
| **PR list** | One heading per registered repository (`owner/repo` and a count), with its open PRs below. A repo with none says "No open PRs" |
| **ISSUES** | The same, for open issues |
| **● at the left of a row** | The PR's CI state (green = passing / red = failing / amber = running / dim = no checks) |
| **Right side of a row** | Author and last update (e.g. `isamu · 5h ago`) |
| **▶ on an issue row** | Start work on this issue: make a worktree and start an agent in it as a grid cell |

Clicking the row itself (its number or title) **opens it on GitHub in a new browser tab**.

## Getting started in three steps

1. **Run `gh auth login` on the machine running the server** — the view runs the GitHub CLI (`gh`)
   behind the scenes. The app holds no token; it uses your `gh` login as it is.
2. **Register the repositories you want to see** — type an `owner/repo` into
   **Settings → Pull request repos** and add it. [Details](#register)
3. **Click the GitHub mark (Pull requests) in the grid's toolbar** — the button appears once at least
   one repository is registered, among the grid's own controls shown while the grid is on screen.

From there, [the ▶ on an issue row](#start-from-issue) starts the work.

---

## 1. Register the repos you want to see {#register}

Only the repos you **register** appear (nothing is auto-added from worktrees or sessions). Two ways;
a repo added in Settings takes effect **immediately** (no restart).

### From the Settings modal (recommended)

1. Open **Settings → Pull request repos**.
2. Type an **`owner/repo`** (e.g. `receptron/mulmoterminal`) and click **Add**.
3. Added repos are listed; remove any with its **✕**.

> The format is `owner/repo` only (no spaces, paths, or `https://…`). The value is passed straight
> to `gh --repo`, so only a bare `owner/repo` slug is valid.

### By editing the config file

Add to **`prRepos`** (an array of `"owner/repo"` strings) in `~/.mulmoterminal/config.json`:

```json
{
  "prRepos": ["acme/web", "acme/api"]
}
```

After a hand edit, press **Settings → Reload config file** or restart the server to apply it.

GitLab projects can be listed too. → [Using GitLab](#gitlab)

→ See [Configuration](config.html) for the full key list.

## 2. Open the view and read it {#read-the-view}

- A **Pull requests** section on top, an **Issues** section below. Both are grouped **per repository**
  (an `owner/repo` heading with a count).
- Only **open** items are shown. Order is your registration order (repos) and whatever `gh` returns (items).
- **Clicking a row opens it on GitHub in a new tab** (nothing opens in-app).
- **↻ (Reload)** at the top re-fetches. **There is no auto-refresh** — it loads once when you open the
  view, then only on Reload.

### What a PR row shows

| Element | Meaning |
|---|---|
| **● CI dot** | green = checks passing / red = failing / amber = running / dim = no checks |
| **#number · title** | the PR number and title |
| **draft** | shown for draft PRs |
| **approved / changes requested / review required** | review state |
| **author · relative time** | e.g. `alice · 2h ago` (last updated) |

An Issue row shows **#number · title · author · relative time**, plus a **▶ start** button on the
right — see below.

> Up to **100 PRs / 20 Issues per repo**. Beyond that, a "there are more" note appears with a link to GitHub.

## 3. Start work on an issue from its row {#start-from-issue}

The **▶** button at the end of an issue row does the whole setup in one click:

1. reads the issue (title and body),
2. creates a **`issue/<number>-<slug>` worktree** in your clone of that repo, forked from a freshly
   fetched `origin/<base>`,
3. starts **Claude** in that worktree as a grid cell, with the issue **already typed into the input
   box** — and **not sent**. You read it, edit it if you like, and press Enter yourself.

**Choosing the agent.** The **Start issues in** menu above the list picks which agent that is — Claude
by default (or your `defaultAgent`), remembered in this browser. For Claude or Codex with
[accounts](config.html#accounts) configured, an **Account** menu beside it picks the login. An agent that is
not installed here is listed but disabled. **Every agent but Claude runs the issue text as soon as it
starts** — it has no input box to leave a draft in — and all but Codex also approve their own tools,
so the view keeps a warning on screen while one of them is picked. An issue that already has a
session resumes it as the agent and login it was started with, whatever the menu says.

Because the branch carries the issue number, everything downstream follows without being told again:
the ⧉ Open PR button writes `Fixes #<number>` into the PR body, and the header's work-item chip, the
issue work comment and the merge-time auto-close all read the same number.

**If you keep several clones of one repo**, the button asks which one the first time and remembers
your answer (`repoDirs` in the config); after that it is one click. **If you have no clone of that
repo**, the button is disabled and says so — register the directory in Settings → directory presets
to enable it.

**Pressing it again for the same issue does not make a second worktree.** One issue has one
worktree: the existing one opens, along with the session left in it if there is one. If that
session is still open in another terminal, nothing happens and the button says so — the same
[one-session-per-worktree rule](worktree.html#one-session) as everywhere else.

> The issue body is text written by whoever opened the issue, which is often not you. That is why it
> is left in the input box rather than sent: the Enter is yours. A **resumed** session gets nothing
> typed into it — it already has a conversation of its own.

## The board (experimental) {#board}

**Open the board (experimental)**, above the list, opens a board with one card per piece of work in
the columns **To do / Implementing / In review / Ready (QA) / Merged**. A card carries the issue, the
PR that closes it, the branch, and the terminals open on that branch.

**Only work with an open terminal**, in the board's header, is **on from the start**. While it is on,
only the cards with a terminal open are shown, and columns and repositories with no card are hidden.
A merged card still shows while a terminal is left on it, so you notice what is left to tidy. Turn it
off to see everything, the unstarted issues included. This browser remembers the choice.

- A terminal open in a clone of a GitHub repository you have not added under **Pull request repos** shows too (when `gh` can read that repository; otherwise it is left out with no error), with that repository tagged **not registered**. It is listed after the registered ones, only while the switch is on, and leaves with its last terminal.
- A terminal on the default branch (`main` and so on) is on no card, so it is not shown.
- A terminal you close leaves its card at once. One you open shows a few seconds later, when the board reads itself again — wherever it was opened, the phone included.
- A terminal whose browser went away stays on its card while the server still runs it, until it is reaped.
- GitHub repositories only.

## Using GitLab {#gitlab}

An entry may also name its host — `"gitlab.com/group/project"`. **GitLab projects are read too**,
with `glab` in the same role `gh` plays for GitHub: the list, starting work from an issue, work
comments, and opening a merge request all work. GitLab groups nest, so
`gitlab.com/group/sub/project` is fine. A bare `owner/repo` still means github.com, so nothing you
already have changes.

An entry on any OTHER host shows a row naming that host, rather than silently contributing nothing.

One difference worth knowing: a GitLab row's CI dot is usually blank, because GitLab's
merge-request list carries no pipeline status and reading it costs one call per merge request. A
cell watching a single branch does read it, so the phase pill in the cockpit is accurate.

### A GitLab of your own (self-hosted)

`gitlab.example.com` cannot be recognised from its address — nothing in the name says whether that
host runs GitLab, Gitea or a wiki. So you say so once, in the same file:

```json
{
  "gitlabHosts": ["gitlab.example.com"],
  "prRepos": ["gitlab.example.com/group/project"]
}
```

You can also add the host without editing the file: **Settings → GitHub and GitLab → Self-hosted GitLab**,
which takes effect at once, with no restart.

A declared host then behaves **exactly like gitlab.com**: the list, starting work from an issue,
work comments, and opening a merge request. Two things it needs:

1. **`glab` logged in to that host** — `glab auth login --hostname gitlab.example.com`. This app
   stores no token of its own; it runs your `glab`, the same arrangement as `gh`.
2. **Reload config file** in Settings, or a server restart, after editing `config.json` by hand —
   the same as `prRepos` written by hand. (Adding the host in Settings needs neither.)

Until the host is declared, its row says so and names the key to add. Not covered yet: a port in
the host name (`gitlab.example.com:8443`), an http-only instance, and GitHub Enterprise.

## Behind the scenes

- The app stores/reads no token — it works with **your `gh` login**.
- Repos always come from **server-side config** (never from the request).
- Each repo is fetched **in parallel**; only a **failing repo** shows its error (the others still load).

## If nothing shows up

- **No GitHub mark in the toolbar** → no repository is registered yet, or a view other than the grid is on screen.
- **"No repositories configured…"** → nothing registered yet. Add `owner/repo` under **Settings → Pull request repos**.
- **"gh not found…"** → install the GitHub CLI and run `gh auth login`.
- **One repo errors** → check the spelling (`owner/repo`) and your **`gh` access** to it (private repos need permission).
- **A PR you just opened is missing** → there's no auto-refresh, so hit **↻ Reload**. Still missing? Confirm it's open and the `owner/repo` is right.
- **Counts are capped** → the limits are 100 PRs / 20 Issues per repo; see the rest via the GitHub links.

---

← [Feature reference](features.html) / [Configuration](config.html) / [English guide index](index.html)
