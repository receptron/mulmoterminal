---
name: mulmoterminal-keys
description: Bind keyboard shortcuts and fix keyboard/clipboard behaviour in MulmoTerminal. **Writes `keymap`**, which Settings cannot set at all — its Keyboard shortcuts section is read-only, listing every action bound or not plus a `send` row. **Explains `copyOnSelect`, `questionPaneEnabled` and `terminalSubmit`**, which have their own Settings controls (two checkboxes and a picker) — point the user at those, and write the key yourself only when they have no browser to hand. Covers zooming a cell, jumping to whichever agent is waiting for you, opening and closing terminals, copy/paste, sending raw bytes to the terminal so a key the shell understands can be reached from a key your keyboard has (Cmd+Right for end-of-line), copying by selecting with no key pressed, and the Enter-vs-newline binding. Use when the user wants a shortcut or hotkey, wants to switch cells or reach a waiting agent without the mouse, wants selecting text to copy it, or reports that Shift+Enter submits their prompt instead of adding a line, that Enter drops to a new line instead of sending, that Ctrl+C stopped interrupting, that a shortcut does nothing, or that on a Mac Cmd+Left / Cmd+Right / Cmd+Delete behave as though the Cmd were ignored — moving or deleting one character, the same as the unmodified key.
---

# Keyboard, shortcuts and clipboard

These settings all live in **`~/.mulmoterminal/config.json`**, and each write is a **partial
`POST /api/config` merge** — write only the key you are changing, so the user's other settings
survive.

**"Partial" means per TOP-LEVEL key, and `keymap` is replaced WHOLE.** The merge is
`body[key] !== undefined ? sanitize(body[key]) : current` (`server/config/app-config.ts`), so
posting

```json
{ "keymap": { "send": [ … ] } }
```

does not add a `send` to the keymap — it **makes that the entire keymap**, deleting every action
binding the user had. Nothing warns, and the reply is a success.

So a keymap write always sends the **complete** keymap: what step 1 read, plus the change. Read it,
merge in memory, post the whole thing. Every `keymap` example below shows one setting on its own for
readability — none of them is a body to post as-is unless the user genuinely has nothing else bound.

Settings has a **Keyboard shortcuts** section, but it is **read-only** — it lists every action and
its current binding, plus a `send` row: one per configured entry, or a single "Not set" placeholder
when there are none. Point the user at it after writing, as the check.

## Open with a proposal, not a question — **on the keymap path only**

**First, check which path you are on.** This skill answers two different arrivals, and the flow
below belongs to one of them:

| the user said | go to |
|---|---|
| nothing specific, or arrived via **Set up shortcuts…** | this section |
| "selecting text doesn't copy" | [`copyOnSelect`](#copyonselect--copy-just-by-selecting) |
| anything about the question pane | [`questionPaneEnabled`](#questionpaneenabled--answer-a-question-from-a-side-pane) |
| "Shift+Enter submits", "Enter makes a newline" | [`terminalSubmit`](#terminalsubmit--enter-vs-newline) |
| "Ctrl+C stopped interrupting" | **the diagnostic below — not this section, and not `terminalSubmit`** |

### "Ctrl+C stopped interrupting" — diagnose, do not propose

**Skip the proposal flow entirely.** This user has one binding too many, not too few; offering them
a starter set would add more keys taken from the terminal, which the rule below forbids. The job is
to find the claim, show it, and remove or move it once they agree.

Read the whole keymap and find **everything** claiming that keystroke, not just one entry:

| what is on `Ctrl+C` | what it does to the interrupt |
|---|---|
| an action other than `copy` / `paste` | takes it **always** — the grid claims the key in the capture phase before the terminal sees it |
| `paste` | takes it **always** — not through the grid (`gridShortcutFor` skips terminal-scoped actions) but inside the terminal, ahead of `send` |
| `copy` | takes it **only while something is selected** — `clipboardActionFor` returns null with no selection, so the key falls through |
| a `send` entry | replaces it with those bytes — **and it is what fires** when `copy` is on the same key with nothing selected |

So "it works sometimes" points at `copy` plus a selection sitting in that cell, and "it never works"
points at one of the others. `terminalSubmit` is not involved either way, and changing it would be
debugging the wrong setting.

Report every claim you found, say which one explains what they are seeing, and change **only that
one** — after they confirm. Remember the whole-keymap write rule above: post the complete map with
that single entry removed or moved, never a map containing only your change.

**Named `copyOnSelect`, the question pane, or the Enter/newline symptom? Skip this whole section**
and go straight to that setting's own one below. Ctrl+C has its own branch just above. Only the
first row — no specific request, or the **Set up shortcuts…** button — belongs here. Proposing
shortcuts to someone who came about Enter is both an unwanted detour and a real cost: every binding
takes a key away from the program in their terminal, and the rule below says never to add one the
user did not request.

Most people who DO land here reach you from the **Set up shortcuts…** button in Settings, which they
pressed without a specific binding in mind — the screen told them the feature exists and they want to know
what it is good for. "What would you like to bind?" hands that question straight back, and it is
the one they came to have answered.

So look first, then offer:

1. **Read what is already there** — `~/.mulmoterminal/config.json`. Say what is bound now (or that
   nothing is), so the proposal is about what is missing.

   **Reading it is not enough — check it against what you are about to offer.** There are two ways
   a proposed `send` can be accepted by the user and then never fire, and both are silent:

   | what is already on the keystroke | what happens | what to do |
   |---|---|---|
   | an action other than `copy` / `paste` | it wins — the grid claims the key in the capture phase | say so, and ask whether to move the action |
   | `paste` | it wins — decided inside the terminal, before `send` | same |
   | `copy` | it wins **only while something is selected**; with none, `clipboardActionFor` returns null and **your `send` fires** | say which behaviour they get when, and let them choose |
   | an existing **`send`** | the **earlier entry** wins, because `sendBytesFor` takes the first match | update that entry, never append a second |

   So before offering the macOS set, look for **both kinds** on `Cmd+ArrowLeft`, `Cmd+ArrowRight`
   and `Cmd+Backspace`. Validation only *warns* about a duplicate claim, so nothing downstream
   will stop you.
2. **Guess the platform, and say the guess out loud.** `uname` tells you the machine the SERVER
   runs on — but the keys are pressed in a **browser**, which may be somewhere else: a Mac
   connecting to a Linux host still has a Cmd key, and a Linux desktop pointed at a Mac host does
   not. Nothing in this app reports the browser's platform, so `uname` is a guess that is right for
   the usual same-machine setup and wrong for a remote one.

   So do not branch silently. Open with the assumption stated — *"You're on a Mac, so…"* — and a
   user who is not corrects you in one word. Asking costs a round trip every time; a wrong guess
   costs a sentence, and only for the people it is wrong about.

   The platform decides what is worth offering: on macOS, `F1`–`F12` arrive only if the user holds
   `Fn` or has changed the function-key setting (so do not propose them unprompted — see the trap
   list below), `Option`+letter never matches at all, and the Cmd line-editing set below only makes
   sense on a Mac keyboard.
3. **Offer concrete sets rather than a blank question**, and what you offer depends on step 2:
   - **Always** one from the action starter sets — **on macOS, the Up/Down subset of Arrows**, for
     the reason in that set's own row. Name what each key will do in the terminal they are sitting
     in, including what it stops doing.
   - **On macOS, also the `send` line-editing set.**
   - **Off macOS (as guessed in step 2) there is no `send` set to offer, and that is not an omission** — see the reason
     under the `send` starter set. Say the mechanism exists and what it is for, then build an entry
     from the `bytes` table only if they name a key that is not doing what they want.
4. **Write only what they pick.** The rule below still holds: every binding takes a key away from
   the program inside the terminal, so nothing goes in unasked.

**On macOS, lead with the `send` line-editing set.** Cmd+Left / Cmd+Right / Cmd+Delete are what a
Mac user presses out of habit in every other text field; in a terminal the Cmd is dropped and the
unmodified key gets through — the **bare arrow** for `Cmd+Left` and `Cmd+Right`, the **bare Delete**
for `Cmd+Delete`, deleting one character instead of the line. So the key appears to half-work rather than to
be unbound, which is harder to diagnose than silence (#1858). If they have not mentioned it, ask whether it bothers them.

## `keymap` — shortcuts

**There are no defaults.** With no `keymap`, nothing is bound and no key is intercepted. Every
binding you add is a key the program inside the terminal (Claude Code, `vim`, `less`, the shell)
**stops receiving**. So ask before binding, and never add one the user did not request.

```json
{ "keymap": { "zoom-next": "PageDown", "zoom-prev": "PageUp" } }
```

| Action | What it does | Needs a zoomed cell |
|---|---|---|
| `zoom-toggle` | Enlarge / collapse — the only action that does; it enlarges whichever terminal the cursor is in | no |
| `zoom-next` / `zoom-prev` | Move the enlargement along the on-screen order | **yes** |
| `next-attention` | Go to the next terminal awaiting input, then finished-unreviewed, then idle — skipping cells mid-turn. Never enlarges or collapses | no |
| `terminal-new` | Open the launch panel on the default workspace (the toolbar's `＋`) | no |
| `terminal-new-here` | Open the launch panel on the current terminal's directory | no |
| `terminal-new-adjacent` | Start a **shell** in the current terminal's directory, straight away — no form | **yes** |
| `terminal-close` | Close the current terminal | **yes** |
| `terminal-restart` | Restart the agent in the current terminal — same cell, same directory, same conversation | **yes** |
| `files-find` | Open a file BY NAME in the Files pane beside the current terminal: a fuzzy search over every file in that project, opening what is picked with the tree expanded to it. Opens the pane first if it is closed | **yes** |
| `copy` | Copy the terminal's selection. Acts **only** when something is selected, so `Ctrl+C` stays usable as interrupt — with no selection the key reaches the program untouched | no |
| `paste` | Paste into the terminal | no |

The three above are easy to confuse. `terminal-new` and `terminal-new-here` open the same panel —
the launch form, at the right edge, over whatever the grid is showing — and differ only in which
directory it starts on. Neither needs a zoomed cell; with no terminal in view `terminal-new-here`
falls back to the workspace rather than doing nothing. `terminal-new-adjacent` is the odd one out:
it starts a shell immediately and shows no form at all, which is why it still needs a current cell.

Neither panel action has to be bound to be reachable: the toolbar's `＋` and the `＋` on every
terminal's header do the same two things.

**Always bind `zoom-toggle` or `next-attention`.** Everything marked "yes" needs something already
enlarged, so a keymap without one of those two can't be used without a mouse click first. Offer
`next-attention` to anyone running several agents — it is the "take me to whoever called" key.

### Starter sets — offer one of these rather than inventing keys

Each is checked against the traps below. The guide documents them at
[Configuration → Keyboard shortcuts](https://receptron.github.io/mulmoterminal/guide/en/config.html#keymap).

| Set | Keys | Suits |
|---|---|---|
| Minimal | `zoom-toggle: F8`, `next-attention: F9` | Anyone starting out — the two that open the feature up |
| Arrows | `Alt+ArrowUp/Left/Right/Down` | The safe cross-platform default, and the only ACTION set to offer a Mac user unprompted — **but on macOS bind the UP/DOWN pair only.** `Alt+Left` / `Alt+Right` usually carry word motion in a Mac terminal, and an action claims the keystroke in the capture phase before the terminal sees it, so binding those two takes word motion away. Map the pair you keep to `zoom-toggle` and `next-attention`, which is what the "always bind one of these two" rule needs anyway |
| tmux-flavoured | `Alt+z / n / p / a / c / x` | tmux muscle memory — but **not** on macOS |
| iTerm2-flavoured | `Cmd+Enter`, `Cmd+[` / `]`, `Cmd+d` | Mac users who think in iTerm2 panes |

### Syntax, and what cannot be bound

`Modifier+Modifier+Key`. Modifiers: `Shift` / `Ctrl` (`Control`) / `Alt` (`Option`) / `Cmd`
(`Command`, `Meta`), case-insensitive. The key is matched against the browser's
`KeyboardEvent.key` — `PageDown`, `Home`, `ArrowUp`, `a` — and is **case-sensitive for letters**.

- **A malformed binding stops the server from starting**, naming the entry. Validate before writing:
  a stray `+`, a lone `Shift`, or an unknown modifier costs the user the whole app until they fix
  the file. Never guess a spelling — if unsure, ask them to press the key and read it off the
  devtools console (`addEventListener("keydown", e => console.log(e.key), true)`).
- **Modifiers match exactly.** Binding `PageDown` leaves `Shift+PageDown` with the terminal, which
  is how xterm's scrollback keeps working. Say this when proposing `PageUp`/`PageDown`.
- **No `F1`–`F12` on a Mac.** macOS delivers no keydown for them by default (they are media keys),
  so the binding looks broken for reasons the user cannot see. If they insist: `Fn`+the key, or
  System Settings → Keyboard → Keyboard Shortcuts → Function Keys.
- **No `Option`+letter on a Mac** — `KeyboardEvent.key` reports the composed character, not the
  letter, so it never matches. `Option`+a non-printing key (`Alt+ArrowDown`) is fine.
- **Never `Cmd`/`Ctrl` + `W` / `T` / `N`** — the browser reserves them; the binding silently does
  nothing.
- Two actions on one keystroke only fires the first. The startup check warns; don't write one.
- **`terminal-close` ends the session with no confirmation.** Only bind it if asked, and suggest a
  combination they won't hit by accident.
- **`terminal-restart` also acts with no confirmation, and costs a resume.** It kills the agent
  mid-turn if it is working, and the conversation is then read back from its transcript — real
  tokens, not a free reload. Offer it only to someone who says they change MCP servers, config or
  plugins while sessions are open, and put it somewhere deliberate for the same reason as
  `terminal-close`.
- **`files-find` is reachable without a binding** — the Files pane's header has a search button that
  opens the same panel. So it is safe to leave unbound, and worth saying so rather than spending a
  key on it by default. If they ask for the VS Code key: `Cmd+P` is Print in a browser and cannot be
  taken, and `Ctrl+P` is the shell's history-back inside the terminal. `Ctrl+Alt+P` or a function
  key is the honest answer.

### `keymap.send` — raw bytes to the terminal

The actions above drive MulmoTerminal. `send` does the opposite: it puts **bytes straight into the
terminal**, so a key the shell or agent already understands can be reached from a key the keyboard
has. The motivating request was `Cmd+Right` for end-of-line on a Mac.

```json
{
  "keymap": {
    "send": [
      { "key": "Cmd+ArrowRight", "bytes": "\u0005" },
      { "key": "Cmd+ArrowLeft", "bytes": "\u0001" }
    ]
  }
}
```

A **list**, unlike the actions, because each entry carries its own payload. Control characters are
written the way JSON writes them (`\uXXXX`) and are **not** re-interpreted — the value reaches the
program exactly as written.

#### Starter set — the one to offer unprompted

The actions have starter sets and `send` did not, so `send` was only ever reached by someone who
already knew it existed. There is exactly **one** worth proposing on its own, and padding the list
would be worse than a short one — every other combination either already works or is reserved:

| Set | Entries | Suits |
|---|---|---|
| **macOS line editing** | `Cmd+ArrowLeft` → `\u0001`, `Cmd+ArrowRight` → `\u0005`, `Cmd+Backspace` → `\u0015` | **The one to lead with on a Mac.** Start of line, end of line, delete to start of line — the habit every other macOS text field has trained. `Cmd+Backspace` is the Mac Delete key; `\u0015` is `Ctrl+U` |

It is the one `send` set to offer a Mac user unprompted, pairing with the Up/Down subset of
**Arrows** on the action side above — the two halves of a macOS proposal claim different keys, which
is what makes offering both at once safe — and **there is no non-macOS equivalent, on purpose.** `send` exists to reach a key the shell
already understands from a key the keyboard has; on Linux and Windows `Ctrl+A` and `Ctrl+E` are
directly typeable, so there is no gap to close unprompted. Off macOS, mention `send` and wait for a
key they name.

**It is a change, not a free addition** — say so before writing it. Those three keystrokes are not
dead today: the Cmd is dropped and the **bare** arrow or Delete gets through, so `Cmd+Left` moves
one character and `Cmd+Delete` erases one. The binding replaces that with line motion, which is the
point, and is also why the user confirms first.

What makes it safe to *offer* unprompted is that **the replaced behaviour stays reachable**: plain
`Left`, `Right` and `Delete` still move and erase one character, so the binding adds line motion on
a modifier rather than removing anything from the keyboard. And what it replaces is the behaviour
the user came to complain about.

**Provided nothing is already on those three keystrokes**, neither an action nor an earlier `send`
(step 1); either one wins and the new entry would never fire.

**Two that look like obvious additions and are not:**

- **`Alt+ArrowLeft` / `Alt+ArrowRight` for word motion.** On macOS these usually work already —
  the terminal receives the Option and moves by words. A `send` binding would replace working
  behaviour with a fixed `\u001bb` / `\u001bf`, which is the same thing right up until a program
  wanted the original. Check what the user's terminal does before offering it.
- **`Cmd+k` for kill-to-end.** The browser takes it (`Cmd`/`Ctrl`+`K` focuses the address bar), so
  the binding silently does nothing — the trap the syntax section lists for `W` / `T` / `N`. And
  `Ctrl+K` is already typeable on every keyboard, so there is nothing to reach.

For anything else, build the entry from the `bytes` table below rather than from a set.

| Want | `bytes` | Is |
|---|---|---|
| Start / end of line | `\u0001` / `\u0005` | `Ctrl+A` / `Ctrl+E` |
| Back / forward one word | `\u001bb` / `\u001bf` | `Alt+B` / `Alt+F` |
| Delete to end of line | `\u000b` | `Ctrl+K` |
| Escape | `\u001b` | `Esc` |

- **An action beats a `send` on the same keystroke — except `copy` with nothing selected.** Most
  actions are claimed by the grid in the capture phase, and `paste` inside the terminal, both ahead
  of `send`, so the `send` silently never fires. `copy` is the exception: `clipboardActionFor`
  returns null with no selection, and the `send` fires then. The server warns at startup about the
  collision, and **its message names the action as the winner even in that case** — so read it as
  "these two collide", not as a verdict.
- **Empty `"bytes"` is refused** and stops the server: it would take the key from the terminal and
  put nothing back.

### After writing a keymap

The browser reads it **on page load — reload the tab.** A hand-edit made while the server is running
also needs a server restart before it reaches the page. Then check Settings → Keyboard shortcuts.

## `copyOnSelect` — copy just by selecting

For the PuTTY / iTerm2 behaviour (`copyOnSelect` in Windows Terminal): a mouse selection reaches the
clipboard **without pressing anything**. Off unless written.

```json
{ "copyOnSelect": true }
```

- **Only write it if asked.** It changes the clipboard when the user may have meant only to
  highlight something while reading, which is why it ships off.
- **Not** a replacement for the `copy` action, and they coexist — someone who selects with the
  keyboard still wants `copy` bound.
- **Over plain `http://` the browser gives the page no clipboard access at all** (the API is
  `https://`- and `localhost`-only). There is a fallback, but it needs the terminal to still hold
  keyboard focus. If the user reaches MulmoTerminal at `http://<ip>:PORT` and says dragging doesn't
  copy, **check this before the setting**.
- Whitespace-only selections, and a repeat of the last copied text, are deliberately **not** copied
  so an accidental drag doesn't destroy the clipboard. Say so if they report "it didn't copy".
- **Settings → Terminal keys has a checkbox for it**, applied immediately. Point at that when the
  user only wants it turned on; write the key when they are setting up a machine without a browser.

## `questionPaneEnabled` — answer a question from a side pane

When a Claude session stops to ask something (its `AskUserQuestion` dialog, the one you answer with
the arrow keys), offer the same choices as buttons in a pane beside the enlarged terminal. Off
unless written.

```json
{ "questionPaneEnabled": true }
```

- **The dialog does not go away, and this does not replace it.** Picking in the pane presses the
  arrow keys and Enter in the real dialog the terminal is showing, so whichever end answers first
  wins. Someone who prefers the keyboard notices nothing.
- **Only write it if asked.** It lets a pane type into the terminal on the user's behalf, which is
  not something to switch on for someone who did not ask for it.
- **Claude sessions only.** The choices arrive on Claude Code's own tool hooks; a codex or shell
  cell has nothing to publish, so the pane never opens there.
- **This is the pane, not the phone.** MulmoTerminal on a phone answers the same questions whether
  this is on or off — the switch exists because a pane types into the terminal you are sitting at,
  and on the phone nobody is at that keyboard.
- The pane opens **by itself** on the enlarged cell when that session asks something, and drops its
  buttons as soon as the question is answered — in the terminal, in the pane, or with Esc.
- **Settings → Terminal keys has a checkbox for it**, applied immediately. Point at that when the
  user only wants it turned on; write the key when they are setting up a machine without a browser.

## `terminalSubmit` — Enter vs. newline

Reach for this when the user says **"Shift+Enter submits my prompt instead of adding a line"** (or
equivalently, "a bare Enter drops to a new line instead of sending"). That is the tell-tale sign
their Claude Code is on the reversed binding, and it also makes the phone remote view's *send*
button type the text without submitting it.

```jsonc
{ "terminalSubmit": "cr" }      // default: Enter submits, Shift+Enter makes a newline
{ "terminalSubmit": "esc-cr" }  // reversed: Enter submits with ESC+CR, Shift+Enter makes a newline
```

- **Do not set this speculatively.** `cr` is correct for almost everyone. Only write `esc-cr` after
  the user confirms the symptom — setting it wrongly breaks Enter the other way.
- The *meaning* is identical in both modes (Enter submits, Shift/Option+Enter makes a newline); only
  which bytes carry it differs, because that is what their Claude Code was rebound to.
- **Claude sessions only.** A shell, codex, or command cell always submits with a plain `\r` even in
  `esc-cr`, so a reversed setting never rewrites a shell's Enter. Say so if asked.
- An invalid value falls back to `cr`, so a typo cannot leave Enter broken.
- **Settings → Terminal keys offers both modes**, worded as behaviour rather than as byte names.
  Confirm the symptom first either way — the control makes it easy to set wrongly too.
- Takes effect after a **tab reload** (keyboard) and a **server restart** (phone remote view).
