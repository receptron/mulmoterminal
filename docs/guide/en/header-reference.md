---
title: Header reference — variables, when, chips
nav_title: Header reference
layout: default
parent: English
nav_order: 10.5
description: The page to look things up in while writing MulmoTerminal header config — all twelve ${variables} and when each is empty, every form of when (! / != / empty right-hand side / no parentheses), how global and project configs merge, the six chips that respond plus the three that don't, and .mulmoterminal.json recipes to paste.
---

# Header reference
{: .no_toc }

- TOC
{:toc}

This is the page to look things up in. The section numbers **continue** from §1–4 of
[the beginner's guide](header.html).

**If you haven't made a button yet**, read
[Customizing the header](header.html) first — in particular, starting to write without knowing that
[writing `buttons` replaces the defaults](header.html#replace) will break your header.

---

## 5. `${variables}` {#vars-when}

### The twelve of them {#vars}

Available in `text`, `cmd`, the `open` values, and a custom chip's `text`.

| Variable | What it holds | When it's empty |
|---|---|---|
| `${dir}` | absolute path of the cell's working directory | — |
| `${dirName}` | just the last segment (`mulmoterminal`) | — |
| `${branch}` | current branch name | **not a git repository** |
| `${repo}` | `owner/name`, from the GitHub remote | **no remote, or not GitHub** |
| `${remoteUrl}` | the remote URL itself | no remote |
| `${dirty}` | **number** of uncommitted changes | not a git repository (`0` is `0`, not empty) |
| `${ahead}` | commits ahead of upstream | no upstream |
| `${behind}` | commits behind upstream | same |
| `${agent}` | `claude` / `codex` / `antigravity` | — |
| `${model}` | the model in use | until the agent reports it |
| `${session}` | session id | — |
| `${task}` | the PR / issue this cell is on | not linked to one |

```json
{ "id": "files", "icon": "folder_open", "label": "Browse this project's files", "run": "open", "open": { "files": "${dir}" } }
```

> **Empty means the empty string** — `null` collapses to it. So `"https://github.com/${repo}"`
> becomes the dead link `https://github.com/` in a repository with no remote. Gate it with
> [`when`](#when).

#### A typo stays on screen {#unknown-vars}

An unknown variable name is **not blanked** — it is left exactly as written.

```text
${braneh}   →   ${braneh}        (a typo for ${branch})
```

That is deliberate: a visible `${...}` is easier to catch than a silently empty label. If you see
one in a button or a chip, check the spelling.

---

## 6. `when` — show it only sometimes {#when-section}

### The forms {#when}

A button whose condition fails is **not drawn at all** (better than a row of buttons that do
nothing). Chips take `when` too.

| Form | Meaning |
|---|---|
| `isGitRepo` | in a git repository |
| `!isGitRepo` | **not** in a git repository |
| `agent == claude` | this cell is Claude (also `codex` / `antigravity`) |
| `agent != claude` | anything **but** Claude |
| `repo == owner/name` | in that repository |
| **`repo != `** (empty right-hand side) | **`${repo}` resolves to something** |

Combine with `&&` and `||`. **`&&` binds tighter.**

```text
agent == claude && isGitRepo
```

> **There are no parentheses.** `(a || b) && c` cannot be written — split it into two buttons when a
> condition gets that complicated.

### "Is it a git repo" and "can I get a GitHub repo name" are different questions {#when-repo}

This is the one people get wrong. A button that opens GitHub, written like this:

```json
{ "id": "gh", "run": "open", "when": "isGitRepo", "open": { "url": "https://github.com/${repo}" } }
```

**shows up in repositories with no remote, and in ones whose remote isn't GitHub.** Both are still
git repositories. `${repo}` then resolves to nothing, and pressing the button opens
`https://github.com/`.

Gate on **the value resolving** instead:

```json
{
  "id": "gh",
  "icon": "open_in_new",
  "label": "Open this repo on GitHub",
  "run": "open",
  "when": "repo != ",
  "open": { "url": "https://github.com/${repo}" }
}
```

The right-hand side of `repo != ` is **left empty**: "`repo` is not empty" = "it resolves to
something". Every button that interpolates a `${variable}` into a URL or a command wants this shape.

> `when` is a **visibility filter, not a security boundary**. What authorizes a `run: "shell"` button
> is that the command is written in your own config file.

---

## 7. Ordering, and how the two files combine {#order-merge}

- **`order`** (a number) sorts them. Buttons without one go last, and equal values keep the order you wrote.
- **Global and project buttons merge by `id`.** Same `id` → the project wins; new `id` → it's added.
  So common buttons can live in the global config and only the project-specific ones in
  `.mulmoterminal.json`.
- The **built-in default set**, though, is replaced as soon as *either* file writes `buttons`
  (→ [the trap](header.html#replace)).
- `chips` do **not** merge. If the project has them, the project's list wins outright.
- The caps are 32 `buttons` and 16 `chips`.

---

## 8. Chips — putting information in the header {#chips}

`chips` reorders and hides the info display on row 1, and adds your own. Omit it and the default set
stays.

```json
{ "chips": ["git", "ctx", { "label": "Which environment this project deploys to", "text": "env staging" }] }
```

### Only six of them actually respond {#builtin-chips}

| id | Shows | |
|---|---|---|
| `git` | branch and unsaved count (`⎇ main ●1`) | ✅ you control it |
| `work` | the PR / issue this cell is on (`#977 → #966`) | ✅ |
| `diff` | the worktree diff badge (`+2 ●5`) | ✅ [worktree cells with changes only](worktree.html#diff-badge) |
| `ctx` | model and context usage | ✅ once the agent reports it |
| `usage` | rate-limit consumption | ✅ same |
| `env` | the values this working tree was reserved — a port shows as a clickable `:3010`, anything else as its text | ✅ [only where the project declares `worktreeEnv`](config.html#worktree-env) |
| `dir` / `status` / `tools` | project badge / status dot / tool timeline | ❌ **structural — listing them does nothing, omitting them hides nothing** |

Writing `dir` / `status` / `tools` is not an error; it is silently ignored.

### Custom chips {#custom-chips}

`{ "label": …, "text": …, "when": … }` adds a read-only piece of text.

**What's displayed is `text`; `label` is again the tooltip** — same rule as buttons. `${variables}`
expand inside `text`.

The `env staging` on the right-hand cell of the screenshot above is exactly this.

> **Once you write `chips`, list everything you want.** The list you write becomes the whole set, so
> dropping `work` also drops the PR / issue display.

---

## 9. Filtering the Skill menu {#skills}

The header's **⚡ Skill** lists the skills available in that directory (the project's
`.claude/skills` first, then `~/.claude/skills`; alphabetical within each group, and a project
skill shadows a user one of the same slug). Picking one runs it **in the current session**
(`/<slug>` for Claude, `Use the "<slug>" skill.` for the other agents).

![The Skill menu](../images/header-skill-menu.png)

When the list grows unwieldy, `skills` in the project's `.mulmoterminal.json` turns it into an
allow-list showing **only those slugs, in that order**.

```json
{ "skills": ["review-diff", "commit-msg"] }
```

- Omit it and **everything** shows.
- A slug that matches nothing is ignored.
- **This is a per-project setting.** It cannot be written in the global `config.json`.

---

---

## 10. Recipes {#recipes}

Paste and adjust. Remember that **writing `buttons` replaces the built-in set**, so include
[the two defaults](header.html#replace) if you want them.

### A whole `.mulmoterminal.json` {#recipe-full}

For a Node project: the two defaults kept, plus build, test and GitHub.

```json
{
  "buttons": [
    { "id": "pick-file", "icon": "attach_file", "label": "Insert a file path", "run": "open", "open": { "pickFile": true }, "order": 1 },
    { "id": "pr", "icon": "merge", "label": "Open this branch's PR", "run": "open", "when": "isGitRepo", "open": { "pr": true }, "order": 2 },
    { "id": "build", "icon": "build", "label": "yarn build", "run": "shell", "cmd": "yarn build", "order": 10 },
    { "id": "test", "icon": "science", "label": "yarn test", "run": "shell", "cmd": "yarn test", "order": 11 },
    { "id": "gh", "icon": "open_in_new", "label": "Open this repo on GitHub", "run": "open", "when": "repo != ", "open": { "url": "https://github.com/${repo}" }, "order": 20 },
    { "id": "compact", "icon": "compress", "label": "Compact this conversation", "run": "input", "text": "/compact", "when": "agent == claude", "order": 30 }
  ],
  "chips": ["git", "work", "ctx", "usage"]
}
```

### Snippets {#recipe-snippets}

**Compare this branch on GitHub** — needs `${repo}`, so gate on the value, not on `isGitRepo`.

```json
{ "id": "compare", "icon": "compare_arrows", "label": "Compare this branch on GitHub", "run": "open", "when": "repo != ", "open": { "url": "https://github.com/${repo}/compare/${branch}" } }
```

**`/compact`, on Claude cells only** — it won't appear on a `codex` cell.

```json
{ "id": "compact", "icon": "compress", "label": "Compact this conversation", "run": "input", "text": "/compact", "when": "agent == claude" }
```

**Offer `git init` only where there is no repository** — what `!` is for.

```json
{ "id": "init", "icon": "add_circle", "label": "git init here", "run": "shell", "cmd": "git init", "when": "!isGitRepo" }
```

**Restart the agent in this cell** — [it costs a resume](header.html#run-action).

```json
{ "id": "restart", "icon": "restart_alt", "label": "Restart the agent", "run": "action", "action": "restart" }
```

**Keep "commits behind upstream" on screen as a chip**

```json
{ "label": "How far behind upstream this branch is", "text": "↓${behind}", "when": "isGitRepo" }
```

---

## See also {#related}

- [Customizing the header](header.html) — the beginner's guide, from the first button
- [Configuration → customizing the header](config.html#header) — the full field reference
- [Configuration → per-project settings](config.html#per-dir) — colours, names, ordering: the other keys in the same file
- [worktree](worktree.html) — the `diff` chip and `worktreeEnv`
- The `/mulmoterminal-header` skill — if you'd rather have it written for you
