# What the phone can ask this host (developer reference)

The companion phone client is a **separate app in a separate repo** —
[receptron/mulmoserver](https://github.com/receptron/mulmoserver), deployed at
<https://mulmoserver.web.app>. It talks to MulmoTerminal over Firestore command docs, not HTTP,
so nothing in `README.md`'s `/api/*` table describes it.

This page is the contract between the two: **every command the host answers, the shapes it
answers with, and the rules that decide what belongs on which side.** Written because three
features in a row (#830, #831, #832) each had to re-derive them by reading the handlers.

> Adding or changing a command? Update this page in the same commit, and file the matching
> issue on `receptron/mulmoserver` — the phone ignores a field it was never taught about, so a
> host-only change ships as silence rather than as a feature.

## Transport

`@mulmoclaude/core/remote-host/server` owns it. The host signs in with the user's Firebase
account, subscribes to a per-user command channel, and answers each doc it sees.

- `HOST_ID = "mulmoterminal"` (`server/backends/remoteHost/index.ts`) — distinct from
  MulmoClaude's, so both can be registered to one account.
- The subscription is wrapped in **`resilientRunner`** (#823): core gives up on its listener
  permanently, so the wrapper re-subscribes and gives up on TIME rather than a retry count.
  `GET /api/remote-host/status` reports `health` (`online` / `reconnecting` / `offline`).
- A handler that **throws** turns into the phone's error message. That is the intended way to
  refuse — the phone shows the sentence, so write it for a person.

## Commands

Handlers live in `server/backends/remoteHost/handlers/`, one file per command (the same layout
MulmoClaude uses); `handlers/index.ts` is the table that names them all, and the terminal ones are
grouped in `handlers/terminalSession.ts`.

| Command | Params | Answers |
|---|---|---|
| `listTerminalSessions` | — | `{ sessions: TerminalSessionSummary[], icons: Record<string, string> }` |
| `getTerminalScreen` | `sessionId` | `SessionScreen` |
| `getTerminalTranscript` | `sessionId` | `TranscriptView` |
| `listPastSessions` | `sessionId` | `{ cwd, sessions: PastSessionRow[] }` — that session's directory's past sessions |
| `getPastTranscript` | `sessionId`, `pastSessionId`, `before?` | `TranscriptPage` |
| `sendTerminalInput` | `sessionId`, `text` | `{ sent: true }` |
| `launchTerminal` | `agent`, `sessionId` | `{ ok: true }` |
| `startChat` | `message`, `attachments?` | `{ started: true, chatId }` |
| `listIssues` | — | `{ repos: RepoIssueRows[] }` |
| `startIssueWork` | `repo`, `issue`, `run?`, `agent?` | `{ started: true, sessionId, branch, issue, outcome, ran }` |
| `listFeeds` | `project?` | `{ feeds }` |
| `getFeed` | `slug`, `project?`, `offset?`, `limit?` | the feed page |
| `listCollectionProjects` | — | `{ projects: { id, label }[] }` — workspace first |
| `listCollections` | `project?` | `{ collections }` (feed-backed ones excluded) |
| `getCollection` | `slug`, `project?`, `offset?`, `limit?` | one page of the collection's items |
| `listShortcuts` | — | `{ shortcuts }` |
| `listSkills` | `project?`, `sessionId?` | `{ skills }` (collection slugs excluded). With a claude session's `sessionId`: that session's directory's skills plus its enabled plugins' `plugin:skill` ids; another agent's session gets the plain list |
| `listAccountingBooks` | — | `{ books: { id, name }[] }` |
| `getRemoteView` | `slug`, `viewId`, `project?`, `locale?` | `{ view, srcdoc, bytes }` |
| `getRemoteViewItems` | `slug`, `viewId`, `project?`, `offset?`, `limit?`, `fields?` | `{ page, inlined, omitted }` |
| `mutateRemoteViewItem` | `slug`, `viewId`, `project?`, `op`, `id`, `patch?` | `{ op, item }` / `{ op, id }` |
| `listMobileFileProjects` | — | `{ projects: { id, label }[] }` — only projects that declare `mobileFiles` |
| `listMobileFiles` | `project?`, `offset?`, `limit?` | `MobileFileListing` |
| `getMobileFile` | `project?`, `path` | `MobileFileContent` |

### Which project a command means (`project`)

A collection lives in a **directory**, and the host serves several: its own workspace plus every
directory the user has saved. Every command above that reads collections, feeds or skills accepts
an optional **`project`**, and `listCollectionProjects` is how the phone learns the ids to put in
it.

Three rules, and they are the contract rather than this host's preference:

1. **The value is an OPAQUE ID, never a path.** The phone is a genuinely remote client — an
   absolute root in a command or an artifact publishes the user's home directory over the wire.
   Ids come from `listCollectionProjects` and are resolved host-side against the list the host
   owns; a path is refused even when it names a real project.
2. **Omitting it means the host's own workspace**, which is what every command meant before this
   parameter existed. A phone that never sends it behaves exactly as it always did.
3. **An id the host cannot resolve is an ERROR, not a fallback.** Serving the workspace's records
   to a request that named a project would be the same slug, the same shape and different records,
   with nothing saying so. Re-fetch the list and retry rather than treating the answer as the
   project's.

The ids are derived from the directory, not stored, so they survive a host restart — but they are
not a name: a project the user removes stops resolving, which is the error in (3).

The three `*RemoteView*` commands serve a collection's **mobile custom views**. The host wraps
each view into its sandboxed `srcdoc` (CSP + postMessage bootstrap) and the phone renders that
verbatim, so the view's own code never runs with the phone's privileges. A write is authorized
**host-side** against the view's declared surface (`editableFields` / `allowDelete`) — the
sandboxed view is not trusted to police itself. `mutateRemoteViewItem` answers
`{ applied: true, warning }` rather than throwing when the write landed but its response blew
the byte budget, so a successful edit is never shown as a failure (#747).

Image fields are **not** inlined by this host (there is no thumbnail store yet): they come back
as workspace paths, unrenderable on the phone, and count toward `omitted`.

### Starting work on an issue (#1184)

`listIssues` is the phone's half of the `/prs` issue list: the open issues of the repos in
Settings' `prRepos`, capped per repo, no bodies. Each repo row carries what
`GET /api/issues` answers with (`repo`, `issues[]`, `truncated?`, `url?`, `error?`) plus:

```ts
{ canStart: boolean; startBlocked?: string }   // the sentence only when canStart is false
```

`startIssueWork` then reads the issue, cuts its `issue/<N>-<slug>` worktree off the fetched
mainline, and spawns a session there seeded with the issue. It answers
`{ started: true, sessionId, branch, issue: { number, title }, outcome, ran }`; `sessionId` is the
id `getTerminalScreen` takes, so the phone can watch what it just started.

**An issue has ONE worktree, so a second call for it does not start a second thing** (#1219).
`outcome` says which of three happened:

| `outcome` | what happened | was the issue typed into it? |
|---|---|---|
| `created` | the worktree was cut and a session seeded in it | yes |
| `reused` | the worktree was already there and empty; the session is new | yes |
| `resumed` | the worktree's own session opened — nothing was spawned | **no** — it has its own history |

A fourth case is a refusal rather than an answer: the worktree's session is **open in another
terminal**, and the sentence says to close it there first. One working tree runs one agent
(#1207), and that rule is not suspended because the request came from the phone.

### `run` — start it, don't just type it (#1253)

By default the seed is **typed and not submitted**: the text was written by whoever opened the
issue, so the Enter is the user's. That is right on the desktop and wrong on a phone, which has no
Enter key — the work simply stops there. **`run: true`** submits it instead.

**Only the host can do this.** The seed is typed once the TUI's input box has painted
(`server/session/spawn/draft-injection.ts`), so an Enter sent from the phone would race the injection,
and nothing outside this process knows when it landed. `sendTerminalInput` cannot send a bare Enter
either (empty text is rejected), and a one-character workaround would be cleared by the
before-paste Ctrl-C. So this is a parameter here rather than a sequence the phone performs.

**Auto-running is accepted, not made safe, by what the seed says.** `issueSeedPrompt` ends with
*"Read it through first and confirm the approach with me before implementing"*, which asks the
agent to stop for a decision before it writes anything. It does not bind it: the issue text may be
anyone's, and the session runs under that agent's usual tool approval — auto-approval for cursor,
copilot, antigravity, grok and muse. That risk was accepted on #2234, and a caller that lets a
person pick a non-Claude agent is to say so before starting (#2226).

`agent` picks which agent starts (#2228): any hosted agent, absent meaning `claude`, anything else
refused. Only Claude can hold the seed as a draft; every other agent runs it at once, whatever
`run` says.

`ran` is not an echo of `run` — it is the spawner's answer for whether the seed runs, and false
whenever nothing was seeded:

| | `run: true` | `run` absent / `false` |
|---|---|---|
| `created` / `reused`, Claude | `ran: true` — typed and submitted | `ran: false` — typed, waiting for Enter |
| `created` / `reused`, any other agent | `ran: true` | `ran: true` — it has no draft to wait in |
| `resumed` | **`ran: false`** — nothing was typed, so there is nothing to submit | `ran: false` |

`resumed` never runs, whatever was asked: that session has its own history and **nothing was typed
into it**, so submitting would send whatever the user left in its box, or an empty line. Anything
other than `true` is read as `false`, which leaves the behaviour every caller had before this
option existed.

**`ran: true` means the session was started to run its seed, not that a keystroke has landed.** The
reply is sent as soon as the session exists; the seed is typed — and submitted — afterwards, once
the TUI's input box has painted. So the phone should word it as *started*, not as *the agent has
answered*, and read the session itself (`getTerminalScreen`) for the latter.

**The desktop keeps the draft.** `POST /api/issues/start` takes no `run` — there, the person who
opened the issue and the person about to run it are often not the same, and the reviewing Enter is
the point. It does take the same `agent`, and for anything but Claude there is no draft to keep.

**It takes no `dir`, by rule** (see "The phone never sends a path" below). The work starts in the
clone recorded for that repo — or in the only one, when the repo has exactly one here. When
several clones could host it and none has been recorded, the command **refuses** and says to
choose once on the desktop. Picking for the user is not a smaller decision than it looks: an
agent runs where it is started, that cannot be undone, and the phone has no way to show which
tree it landed in. `canStart` exists so the phone learns this before the tap rather than after.

**It has no open-tab prerequisite**, unlike `launchTerminal` below. The spawn is the host's own,
and the session is marked *unplaced* (`server/session/registry.ts`), which is how a session
nobody's browser asked for gets a cell: a desktop grid that is already on screen adopts it within
the moment, and one that isn't picks it up the next time it loads.

The same mark is what puts the session in **`listTerminalSessions`** before any of that happens.
That list is the grid's cells, and a session joins that set on a browser attach and in no other
way — so until #1184 a session the phone had just started was absent from the phone's own list,
and the work it began was findable only by holding on to the returned `sessionId`. It now answers
with cells **and** the sessions on their way to being one, which is the same set one moment later.
This covers `startChat` too, which had the same hole.

### `TerminalSessionSummary`

```ts
{ id: string; title: string; cwd: string; live: boolean; agent: "claude" | "codex" | "shell" | null; iconId?: string; prompt?: string }
```

`title` is the memo, the AI title or the recorded title. A live row with none of those is named
from disk instead — the transcript's `ai-title`, the agent's own title, the latest prompt, the first
user message — then `<project> · <agent>`, and only then its `id` (#2210). A `/clear`ed session
reads nothing off disk. `prompt` is the latest prompt on one line, absent when there is none or when
it only repeats `title`.

`live: false` means the session exists only in tmux — it outlived a restart. Still viewable
(`capture-pane` doesn't need our process) but **not writable**, and `agent` is then `null`
because the process that knew what it was launched with is gone.

The list is filtered to **grid cells, plus the sessions waiting to become one** — a chat or an
issue the phone started that no browser has adopted yet (`isPhoneListableSession`). A tmux shell
that was never a cell and that nobody spawned for one is excluded, even while live.

### `icons` — the directory images, beside the list (#1556)

The picture a project marks its cells with (`icon` in `.mulmoterminal.json`, or its detected
favicon) travels **inside the reply**: the browser fetches `/api/dir-icon?cwd=…`, and the phone
has no route to this host at all. An `http(s)` or `data:` icon is passed through as written; a
file inside the project is read and inlined as `data:<mime>;base64,…`.

A row names its image by `iconId`, which is a **content hash** — the six clones of one repository
send those bytes once between them. Absent means the phone draws what it drew before: no icon
configured, a file that could not be read, or the budget below.

Two caps, and the second is the one that matters. A single image over **48 KiB** is left out (the
largest real favicon measured on the author's machine was 25.9 KB). And the `icons` table stops at
**256 KiB** of src — because the reply is a Firestore command doc, which rejects the WHOLE
document over 1 MiB, so an unbounded pile would empty the phone's list rather than dim one row
(the #1042 failure). Icons are packed in the order the phone shows the rows, so a budget that runs
out costs the bottom of the list.

### `SessionScreen`

```ts
{
  screen: string;            // the rendered terminal, trailing blank lines trimmed
  suggestion: string;        // the agent's dim ghost text, "" when none (#563)
  quickCommands: { label, text }[];   // the user's saved phrases for THIS session (#830)
  cwd?: string;              // ─┐
  branch?: string;           //  │ absent when the host cannot answer —
  memo?: string;             //  │ see "absent vs empty" below (#786)
  summary?: string;          //  │
  prompt?: string;           //  │
  icon?: string;             //  │ the dir's image as an <img src> (#1556)
  githubUrl?: string;        // ─┘ the repository ROOT, never /tree/<branch> (#832)
  mobileFilesProject?: string; // the opaque project id to pass to listMobileFiles (#2915)
}
```

`mobileFilesProject` is set only when the DEEPEST project containing the session's directory
declares `mobileFiles` — a registered sub-project that shares nothing does not fall back to the
enclosing workspace's files. It is an id, never a path, the same one `listMobileFileProjects`
returns.

`icon` is the src itself, not an `iconId`: one screen carries one image, so there is nothing to
deduplicate it against. Same two sources and the same per-image cap as the list above.

**`memo` and `summary` are two different sentences, not two spellings of one** (#1110). `memo` is
the one line the user typed about the session (#1084); `summary` is what the AI called it. The
picker's `title` carries the memo *instead of* the AI title because a row there is a single line
and the user's words win — but a header has room for both, so here they arrive as their own fields
and the memo is drawn above. Putting a handwritten note into a row labelled as the AI's summary
would mislabel it.

### `TranscriptView`

What `getTerminalTranscript` answers (#1751, extended to a second agent in #1822). The screen above
is **one pane**, and an agent cell runs on the alternate screen with no scrollback —
`capture-pane -S -300` clamps to what exists, so it returns the pane's 30-41 rows and nothing older.
This reads the agent's own transcript instead, which is the conversation the model saw.

```ts
type TranscriptView =
  | { status: "ok"; turns: TranscriptTurn[]; truncated: boolean }
  | { status: "none" }          // nothing written, or nothing this host can find
  | { status: "cleared" }       // the conversation was ended with /clear; the file is frozen
  | { status: "too-large" }     // widened to 32 MB without finding a turn boundary
  | { status: "not-supported" }; // this agent keeps a conversation no reader here reads YET

interface TranscriptTurn {
  at: string | null;          // the prompt record's own timestamp, null when it is not a string
  rows: TranscriptRow[];
}

interface TranscriptRow {
  kind: "user" | "assistant" | "tool" | "unknown";
  text: string;               // may contain newlines: wrapping is the phone's, not the host's
  clipped?: boolean;          // THIS row's text was cut
}
```

**A union rather than `readable: boolean`.** "Nothing written yet", "you ended this conversation"
and "too big to read" are three different things to tell a person, and one boolean makes all three
the same blank view. A host too old to know the command answers nothing at all, which the phone
reads as `none`; the fallback for every status but `ok` is the screen.

**WHICH AGENTS ANSWER, and why the agent is never asked to choose the reader.** Claude, codex,
cursor and copilot are read today. Each source is asked whether IT holds this session, in order, and
the first that does answers — what is on disk is a fact and the agent is a guess. The order is by
cost: claude joins one path, codex scans a day tree, cursor walks every project directory asking each
what it stands for (its slug is a truncated-and-hashed path that cannot be reconstructed), copilot
opens sqlite. Specifically: a claude session that
outlived a server restart reports its agent as `shell`, because a claude pane's
`pane_current_command` is a version string that `agentFromPaneCommand` has no entry for, so a reader
picked by `agentOfSession` would lose the view on exactly those cells.

**Three of the four keep a FILE and one keeps a TABLE.** A file source is located from the session
key and read as a byte window off the tail; copilot has no file, and its window is `ORDER BY
turn_index DESC LIMIT n` against its own machine-global store. The two kinds meet at the SCAN — the
line budget, the byte cap and the eviction rule below are applied to both by the same code, not
reimplemented per agent. One duty is the query kind's alone: because that store is machine-global, the
read is scoped to the working directory inside the SQL, or a session id from another project would be
readable here by hand-editing the request.

**`not-supported` is not `none`, and the difference is a sentence and a to-do.** `none` means
nothing was written or nothing was found; `not-supported` means this session's agent DOES keep a
conversation and no reader here reads it yet — grok, muse and antigravity today. It is
answered only after every source has missed, which is the one place the agent may safely be asked.
A **shell** cell never gets it: a shell has no conversation and never will, so the screen is its
content rather than a fallback from something missing.

A phone that does not know the status falls back to `none` (`parseTranscriptView` keeps a closed
list), so a host may answer `not-supported` before the phone has a sentence for it — the view
degrades exactly as it does today, and the phone side can follow at its own pace.

**`truncated` and `clipped` are different facts, and mixing them up draws the wrong mark.**
`truncated` sits on the VIEW and means turns are missing — evicted by the 250-logical-line budget,
evicted by the 256 KB byte cap, or simply older than the tail that was read. The phone shows it once,
at the top: *there is more before this*. `clipped` sits on a ROW and means that row's own text was
cut — a tool result past its first 6 lines, or the byte cap biting inside the newest turn. The phone
shows it at the end of that row.

**A cursor turn shows no tool RESULTS, and a copilot turn shows no tools AT ALL.** Both are the
agent's own file rather than a gap in the reader, and both were measured over the whole store on this
machine rather than sampled:

- cursor — zero `tool_result` parts and zero result records. A cursor turn carries what was asked,
  what was said, and WHICH tools ran, and never what they answered.
- copilot — its `turns` table holds only `user_message` and `assistant_response`, and
  `forge_trajectory_events` (the table whose columns are `tool_call_id`, `command`, `output`,
  `exit_code`) is EMPTY, including for sessions that demonstrably ran tools. So a copilot turn
  carries what was asked and what was said, and nothing about what ran. `session_files` is not the
  missing half: `UNIQUE(session_id, file_path)` makes it a deduped per-session index, so rendering it
  per turn would under-report and mis-attribute.

**What the rows are made of.** One row per content block, in the content's own order, never merged.
An assistant answer is passed through whole, and a tool RESULT is its **first 6 lines** (tool output
needs its head — the start of a file, the first match of a grep), the same cap for every agent.

A tool CALL differs by agent, because what is worth showing does:

| agent | a tool call reads | why |
|---|---|---|
| claude | the **name only** | claude's `tool_use` carries the arguments as a block of their own, and they are what make a call long |
| codex | the name **plus the head of its arguments**, capped at 200 characters | `function_call` / `custom_tool_call` carry a name that is often just `exec`, so the name alone says nothing about what ran |
| cursor | the name **plus the head of its serialised `input`**, same cap | cursor's `input` is an object (`{ command, description }`), and `Shell` alone has the same problem |
| copilot | **no tool row exists** | copilot records no tool call anywhere in its store — see above |

`thinking` renders nothing today because its text measured 0 characters on disk in every transcript
sampled, and codex's `reasoning` is the same — `summary: []` with the body encrypted. A block type
the host does not know becomes `{ kind: "unknown", text: "[unknown block: <type>]" }` — the same row
from the same function for every agent — and **draw it**, faintly if you like, because that row is
how a format change becomes visible instead of a view that quietly thins out.

**Known gaps, accepted deliberately.** A transcript's `type:"user"` records are not the set of
things a person typed: an instruction sent WHILE a turn was running does not appear there at all,
and text a skill injected does. This view shows the conversation the model saw, which is what it is
for; "what did I ask for" is a different question (`PromptsPane`, desktop only).

**Sub-agents are not expanded.** They live in `<sessionId>/subagents/agent-*.jsonl`, one file each,
and range from 284 to 20,614 lines — far past any budget. The `Task` tool's own `tool_result` in the
main file IS the sub-agent's final report, so its opening lines appear in the flow anyway.

### `PastSessionRow` / `TranscriptPage` — a directory's past sessions (#2999)

`listPastSessions` lists the earlier sessions of the directory the named session runs in — every
hosted agent's, the rows the grid's "or resume here" picker reads — merged newest first and capped.
The phone names an open session, never a directory, as with `launchTerminal`.

```ts
interface PastSessionRow {
  id: string;
  title: string;
  mtime: number;       // epoch ms
  agent: "claude" | "codex" | "antigravity" | "grok" | "muse" | "copilot" | "cursor";
  readable: boolean;   // false: listed, but no reader here yet — getPastTranscript answers not-supported
  account?: string;    // the second login it lives under; absent for the default one
}

interface TranscriptPage {
  view: TranscriptView;  // as above
  older: string | null;  // opaque; send back as `before` for the page before this one
}
```

`getPastTranscript` reads one page, newest first: omit `before` for the newest page, then hand back
`older` until it is null. A `pastSessionId` that is not in that directory's list is refused (thrown),
and so is a malformed cursor. The cursor is an opaque position, not a capability: it is only ever read inside the session the list already allowed.

### `MobileFileListing` / `MobileFileContent`

What the phone may open of a project (#2911). Types in `common/mobileFiles.ts`.

```ts
interface MobileFileListing {
  configured: boolean;          // false: the project declares no `mobileFiles` — say how to add it
  files: { path: string; kind: "markdown" | "html" | "pdf" | "image"; bytes: number; modifiedAt: string }[];
  total: number; offset: number; limit: number;
  truncated: boolean;           // the walk stopped at its budget; older files may be missing
}

type MobileFileContent =
  | { delivery: "inline"; kind: "markdown" | "html"; path: string; text: string; omittedImages: number }
  | { delivery: "storage"; kind: MobileFileKind; path: string; storagePath: string;
      contentType: string; bytes: number; expiresAt: string; omittedImages: number };
```

- **Declared, never discovered.** A project shares nothing until its `.mulmoterminal.json` has
  `mobileFiles: { dirs, extensions }`; the workspace is no exception. `path` is relative to the
  project root and is re-checked against the declaration on every `getMobileFile` — a listing is
  not a capability.
- **`inline`** carries the document whole. `html` is already wrapped: a CSP meta leads the
  document (`connect-src 'none'`, `img-src data: blob:`), so show it in a sandboxed iframe
  (`sandbox="allow-scripts"`, no `allow-same-origin`) as it is. Markdown arrives raw — render it
  through the phone's sanitising renderer. Relative images inside a declared directory are already
  `data:` URLs; `omittedImages` counts the ones that were not.
- **`storage`** names an object under `downloads/{uid}/`. Read it with the signed-in user's
  own credentials (`getBlob`) — **never `getDownloadURL`**, whose token URL anyone holding it can
  open. The host deletes it at `expiresAt` (an hour), sweeps leftovers when the phone next lists or
  opens, and the bucket's lifecycle rule removes anything older than a day.

## The rules that keep coming up

**`SessionScreen` is the wire shape.** A field added to it reaches the phone without touching
the handler — that is stated in the handler's own comment and is the intended extension
point. Adding a command is the exception, not the rule.

**The host decides; the phone renders.** `quickCommands` is filtered to the session's kind
host-side and the `agents` scope is stripped, so the phone needs no notion of session kinds.
Same shape as `githubUrl`: the phone's whole rule is "render it if it's there."

**Absent vs empty is load-bearing.** `definedScreenMeta` drops a meta field the host can't
answer, key and all: a Firestore command doc rejects `undefined`, and the phone renders each
field it receives as its own labelled row, so `""` would read as "this session has no branch"
rather than "not known". **It calls `.trim()` on every value, so only strings may live in
`SessionScreenMeta`** — `quickCommands` is an array and sits on `SessionScreen` directly,
always present, `[]` when nothing applies.

**The phone never sends a path.** `launchTerminal` takes a session id and the host looks the
directory up (`ptys.get(id)?.cwd`). `startIssueWork` takes `owner/repo` and the host looks up the
clone recorded for it. A path parameter would let a remote client choose where a process starts.
Apply this to anything new that touches the filesystem — including when the host would then have
to refuse, which is the honest answer and not a gap to close by accepting the path.

**Authorization is the connected Firebase account, with no per-command gate.**
`sendTerminalInput` already types arbitrary text into a Claude session, which can run anything,
so a command that acts within a session the phone can already drive is not an escalation. A
command that reaches *outside* one would be, and needs its own thinking.

## `launchTerminal` has a prerequisite the others don't

The grid is **browser state**. `markDevTerminalSession()` is reached only from
`server/routes/ws-routes.ts` — "the single choke point for every grid attach" — so the host
cannot open a cell itself. It publishes to the `launch-terminal` pub/sub channel and a
connected browser opens it through the ordinary path.

Consequences the phone has to live with:

- **A MulmoTerminal tab must be open on the desktop.** With none subscribed the host refuses
  with `no MulmoTerminal browser is open — the grid opens the terminal, so a tab must be
  connected`. It does not fail silently.
- Delivery goes to **one** subscriber (`publishToOne`), not the room: a broadcast would open a
  terminal per open tab.
- `agent` is `"shell" | "claude" | "codex"` (`common/launchAgent.ts`) — deliberately not the
  user's configured `launchers`, which are arbitrary commands.

This is about opening a cell for a session that already exists, not about starting one: a command
that SPAWNS can mark its session unplaced and let a grid adopt it later, which is what
`startChat` and `startIssueWork` do. Nothing has to be open for those.

## Where the pieces are

| Concern | File |
|---|---|
| Command handlers | `server/backends/remoteHost/handlers/` (one file per command; `index.ts` is the table) |
| Session list + screen assembly | `server/backends/remoteHost/terminalScreen.ts` |
| Typing into a session (sanitize, bracketed paste, Enter timing) | `server/backends/remoteHost/terminalInput.ts` |
| Quick-command scoping | `server/backends/remoteHost/quickCommands.ts` |
| Launch validation | `server/backends/remoteHost/launchTerminal.ts` |
| Issue work (list, refuse, start) | `server/backends/remoteHost/handlers/issueWork.ts`, `server/git/issue-work.ts` |
| Whether the seed is typed or typed-and-run | `server/session/spawn/issue-spawn-options.ts` |
| Which clone a repo starts in | `server/git/repo-dirs.ts`, `common/issueStartPlan.ts` |
| Reconnect + health | `server/backends/remoteHost/resilientRunner.ts`, `healthNotice.ts` |
| Wiring (PTY table, pub/sub, config) | `server/index.ts` |
| Shared with the UI | `common/sessionAgent.ts`, `common/quickCommands.ts`, `common/launchAgent.ts` |

## Related

`docs/spawn-architecture.md` (how a session is spawned), `docs/terminal-notes.md` (the terminal
stack). Issues: #435, #445, #563, #572, #781, #786, #823, #830, #831, #832, #1184.
