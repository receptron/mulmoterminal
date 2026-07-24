---
title: GitHub — cross-repo PRs & Issues
layout: default
parent: English
nav_order: 7
---

# GitHub — cross-repo PRs & Issues
{: .no_toc }

- TOC
{:toc}

**See open Pull Requests and Issues across several repositories on one screen.** Which repo has
something waiting for review, whether CI is red — all at a glance, without hopping between sessions.
You choose which repos show up by **registering** them (just a list of `owner/repo`).

- A full-screen view opened from the toolbar's **Pull requests** button (`call_merge` icon).
- Shows **both open PRs and Issues**, grouped **per repository**.
- Data comes through the **GitHub CLI (`gh`)** — it **uses your `gh` login**, so no token is stored in the app.

---

## 1. Register the repos you want to see

Only the repos you **register** appear (nothing is auto-added from worktrees or sessions). Two ways,
both effective **immediately** (no restart).

### From the Settings modal (recommended)

1. Open **⚙ (Settings) → Pull request repos**.
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

→ See [Configuration](config.html) for the full key list.

## 2. Open the view and read it

Click **Pull requests** (`call_merge`) in the toolbar to open the **PRs & Issues** view (it sits
between **Accounting** and **Wiki**).

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

An Issue row shows only **#number · title · author · relative time**.

> Up to **100 PRs / 20 Issues per repo**. Beyond that, a "there are more" note appears with a link to GitHub.

## Prerequisite: sign in to the GitHub CLI

The view runs the **`gh`** command behind the scenes. On the machine running the server:

```bash
gh auth login
```

- The app stores/reads no token — it works with **your `gh` login**.
- Repos always come from **server-side config** (never from the request).
- Each repo is fetched **in parallel**; only a **failing repo** shows its error (the others still load).

## If nothing shows up

- **"No repositories configured…"** → nothing registered yet. Add `owner/repo` under **⚙ → Pull request repos**.
- **"gh not found…"** → install the GitHub CLI and run `gh auth login`.
- **One repo errors** → check the spelling (`owner/repo`) and your **`gh` access** to it (private repos need permission).
- **A PR you just opened is missing** → there's no auto-refresh, so hit **↻ Reload**. Still missing? Confirm it's open and the `owner/repo` is right.
- **Counts are capped** → the limits are 100 PRs / 20 Issues per repo; see the rest via the GitHub links.

---

← [Feature reference](features.html) / [Configuration](config.html) / [English guide index](index.html)
