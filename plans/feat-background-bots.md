# Background Bots — implementation plan

## Agreed product

Bots are interactive agent CLI sessions running in tmux. They never appear as terminals in the grid, tabs, session pickers, or phone session lists. Users talk to their existing frontend agent; the bundled `bot` skill teaches that agent to list, create, send to, compact, and kill Bots. Bot replies arrive through MCP and wake the requesting frontend. No `-p` worker, dedicated Bot UI, new hosting service, or general workflow engine.

## First implementation

- Start with Claude interactive sessions, whose per-spawn hooks provide turn and blocked-state signals. Reject unsupported agents explicitly; keep the transport extensible.
- Persist Bot identities, request-to-frontend routing, and reply mailboxes under the host's own state directory. Share Bots across frontend terminals on the same server; scope each reply to the requesting frontend session. Derive the caller from MCP session context, never a model-supplied session id.
- Provide `manageBot` (list/create/compact/kill), `sendToBot`, `replyToFrontend`, and `readBotReplies` as host MCP tools. Bot sessions can reply only to their assigned requests; responses are bounded and correlated by request id.
- Reuse the existing interactive spawn, tmux, session input, MCP injection, and hook infrastructure. Bots have a separate durable marker; they must not be adopted into the grid or swept as short-lived scheduled workers.
- Queue work per Bot. Dispatch at known input-ready boundaries; compact is a queued CLI control operation, not a prompt and not a new session.
- Save replies before acknowledging them. Notify the frontend with host-generated text; the frontend retrieves the actual body with `readBotReplies` and continues the user's task. Coalesce wakeups and serialize delivery with frontend input.
- Never inject a wakeup into a permission/question dialog or a user's unfinished terminal draft. Inspect the current input/UI paths before selecting a conservative implementation. Unknown readiness means hold, not guess.
- Keep pending delivery through reload/restart. Reconcile surviving tmux sessions before sending; no blind replay of a request whose delivery is uncertain. Explicit errors and killed Bots return a reply to the frontend.

## Work sequence

1. Inspect spawn/MCP/session-list/input seams; finalize the delivery boundary.
2. Implement durable Bot service, lifecycle, queue, and mailbox with behavioral tests.
3. Wire host MCP tools, interactive runtime, hidden-session filters, and hook-driven delivery.
4. Ship the `bot` skill and concise English/Japanese documentation.
5. Verify lifecycle, reply-triggered frontend continuation, busy/blocked/draft holds, compact/kill, restart, and invisibility. Run formatting, lint, typecheck, tests, and build.

## Validation and status

Plan created before implementation. Initial implementation is present on `feat/background-bots` in `/private/tmp/mulmoterminal-bots` (uncommitted working changes).

### Implemented

- Durable Bot registry, per-Bot serial request queue, requester-scoped reply mailbox, idempotent replies, compact and kill.
- The four MCP operations, with caller identity supplied by the broker. Bots cannot call frontend management tools or spawn visible background chats. Existing translation-worker and tool-group gates remain enforced.
- Interactive Claude spawn with a persistent role, no `-p`, tmux required, no terminal viewer. Startup requires the CLI ready marker; it never falls back to submitting into a quiet trust/login screen. Unsent tasks whose readiness remains unknown for two minutes return an error.
- Fixed mailbox notices wake the owning frontend. The host waits for a CLI prompt-submit hook (PreCompact for compact) before acknowledging terminal delivery; missing acknowledgement is not counted as a successful wakeup. Replies remain retrievable through MCP.
- Conservative input lease: busy/blocked/unknown state and user drafts hold delivery; concurrent user input waits until the injected prompt is acknowledged. A partial send is not blindly retried.
- Durable hidden-session markers, including transcript ids issued by compact. Normal session/tmux/phone lists and WebSocket terminal admission exclude Bots. Internal Bot tools are absent from Canvas hints. Bots are exempt from ordinary detached/idle reaping.
- Bundled `bot` skill and English/Japanese usage documentation at `docs/background-bots.md`.

### Verification

- `yarn test --maxWorkers=6`: **895 files passed, 3 skipped; 13,198 tests passed, 50 skipped**. The final full run allowed localhost sockets; the initial sandboxed run could not bind ports for existing integration tests.
- `yarn lint`: passed.
- `yarn typecheck`: passed; final `yarn build` also includes typechecking and passed (existing bundle-size/dynamic-import warnings).
- `yarn format`: run. Unrelated baseline formatting in `docs/facts.json` was restored. Changed TypeScript/Vue files pass formatting through lint.
- `git diff --check`: passed.
- Added behavioral coverage for durable queues, ownership, duplicate replies, coalesced frontend wakeups, compact, kill, recovery, drafts, blocked/unknown states, submit acknowledgement, MCP protocol gates, hidden transcript markers, and the tmux picker. PTYs are simulated in these tests; MCP protocol tests use a real SDK client and an in-memory transport.
- Skill frontmatter validated using installed `js-yaml` and bundled-skill installation tests. The skill creator's Python validator could not run because PyYAML is not installed.

### Remaining validation and boundaries

- **Real Claude + tmux end-to-end verification has not been performed.** Before shipping, verify startup, task dispatch, MCP reply, frontend continuation, compact, and kill with isolated configuration. Verify CLI readiness markers and hooks against the installed Claude version. Do not disturb existing sessions or send external messages during that check.
- This version requires Claude on both sides and shares Bots across frontend terminals on the same server. Other CLI adapters and sharing across server instances/ports remain future work.
- Restart reconnects surviving Bot tmux sessions; the follow-up below restores readiness using lifecycle hooks or stable idle-screen captures. A reattached frontend draft is conservatively occupied until another user submission. Unread mailbox notifications are rearmed on host recovery; uncertain tasks are not replayed.
- Login/trust/permission dialogs require setup in an ordinary session; preserve the Bot and explain the problem, with termination/replacement only at the user's request. No hidden automatic approvals or Bot terminal are provided.
- Draft protection covers input routed through MulmoTerminal. Delivery is held while another tmux client is detected, but arbitrary typing directly into tmux is outside the input lease.
- Store retention/archiving and automatic compaction thresholds are not part of this first version; compaction is an explicit queued operation through the skill.

### Follow-up: sharing across terminals

User testing confirmed that the initial creator-only lookup prevented another terminal from finding or using a Bot. The revised model shares the Bot registry within one server, while recording a requester on every task/compact operation. Completion, question, failure, and kill notifications route per request. The Bot's creator remains metadata for creation limits; it no longer controls access. Version 1 records migrate to version 2 with each legacy request addressed to its original creator, preserving outstanding work and existing mailboxes.

Follow-up validation: 155 related tests passed across Bot service/host/MCP and bundled-skill installation tests; lint and build (including typecheck) passed. The MCP bridge integration tests were run outside the sandbox to allow localhost listeners. The development server on port 34568 was restarted with the fix. A read-only live MCP check from two different conversation ids returned the same two existing Bots, confirming persistence and shared discovery. Reply routing between terminals is covered by automated host/service tests; a real second-terminal LLM task remains for the user's interactive test. Existing Bots reported unknown readiness immediately after restart, subject to the recovery limitation above.

### Follow-up: stale ids, duplicate names, and idle recovery

The failed second-terminal send was `This Bot has ended.`, confirmed in the actual Claude tool result. Its cached mag2-bot id had been killed by the first frontend about two minutes earlier. That frontend had received a readiness timeout after the development server restart and followed our erroneous suggestion to kill/recreate both Bots. The second frontend then also recreated mag2-bot, leaving two live instances with the same name.

Fixes: reject duplicate running names across callers (include existing Bot details without modifying roles/context); include current same-name candidates in ended-id errors; remove automatic kill/recreate guidance from all errors, tool descriptions, and the bundled skill; preserve the actual CLI `error` field in failed-tool history. Existing duplicate Bots are retained. Stale ids are never silently redirected to a different context.

For surviving hidden Bots only, recovery checks the current tmux input box and footer twice across a settling interval. Empty input and dim suggestions are allowed; drafts, interrupt/cancel/confirm UI and unknown layouts remain held. Lifecycle events supersede screen recovery. Frontend drafts never use this fallback, and uncertain tasks are never replayed. Captures are read-only and do not expose Bot terminals.

Validation for this follow-up: 242 tests passed across 19 files (Bot service/host/input/recovery/MCP, MCP integration, bundled skills, tool history and hook routes). Lint, typecheck/build, changed-file formatting and diff checks passed. Restarted only the test server at port 34568. A read-only live MCP probe from two distinct callers returned the same three pre-existing Bots, all `ready`. Their Bot ids were checked against the pre-restart snapshot and remained unchanged; neither mag2-bot was killed, recreated, merged or sent a new task. Actual second-terminal task/reply routing is covered by host/service tests; the user's prior live replacement Bot also completed its task.

### Follow-up: durable CLI questions without a frontend

Requested: background Bots must handle CLI questions even while their requesting frontend is closed. Add a persistent prompt record, expose outstanding prompts in the shared Bot list/inspection, and allow another frontend to answer a recognized choice. Claim an answer durably before sending keys, reject concurrent/stale answers, and never replay an uncertain key submission after restart. Keep requests queued or in flight while waiting; a CLI question is not a completed task reply.

Automatically select summary only for the specifically recognized Claude resume dialog. Generic recognized menus require an explicit option through the frontend; unknown/login/free-text screens are recorded and reported without arbitrary keystrokes. Revalidate the current dialog before each navigation/submit and wait for lifecycle/idle evidence before resuming task delivery. Scan hidden Bot panes for dialogs before task submission, use notification hooks and delivery timeouts for otherwise unrecognized input waits, and persist notifications until the relevant frontend is available. Keep normal frontend input and all Bot terminal visibility rules unchanged. Tests must cover closed frontend, cross-terminal resolution, concurrent answers, changed screens, crash/restart during response, automatic summary, and task continuity.

Implemented: version 3 state adds durable CLI prompts and a per-Bot `resumePolicy` (default `summary`, optional `ask`). Existing state migrates in memory on load and is saved in the new format on the next mutation. `manageBot` now supports `inspect` and `respond`; shared lists expose waiting questions, while notices route to the requesting frontend. Questions hold outstanding tasks instead of completing them with an error. Answers are claimed before writing keys, uncertain submissions are never replayed, and answered dialogs remain held until their old screen clears, including across restart. Automatic summary requires a recognized dialog observed across a settling interval; arbitrary menus, multiselects, login and unknown screens never receive automatic approval.

Validation: the full suite passed with **898 files passed, 3 skipped; 13,241 tests passed, 50 skipped**. After the final delayed-screen-clear guard and parser refinements, all **63 Bot tests across 8 files** passed again. Final lint, typecheck/build, formatting and diff checks passed. Dialog tests use representative screen fixtures; the actual expired-cache Claude dialog has not yet been reproduced live.

Restarted only the test server on port 34568 with this implementation. HTTP returned 200. Two independent read-only MCP callers saw the same two existing Bots, both `ready`, with `summary` policy and no pending questions. Compared the live store with `/private/tmp/bots-before-prompts-upgrade.json`: Bot ids, tmux session ids and requests were preserved. No tasks or dialog answers were sent to the user's existing Bots during this verification.

### Follow-up: optional creation directory

Allow `manageBot create` to accept optional `cwd`. When omitted, keep the caller's working directory. Explicit values accept absolute paths and home-relative `~/...` paths, use the host's existing directory validation/canonicalization, and fail before registering or spawning a Bot if invalid. Keep the live-Claude capability check even when `cwd` is supplied. The selected directory is persisted and passed to spawn/recovery, so callers in other directories keep using the same Bot context. Update the bundled skill and bilingual docs, and verify actual host dispatch/spawn arguments, persistence/restart, omitted/tilde paths and invalid inputs without touching the user's Bots.

Validation: 127 Bot and bundled-skill tests passed across 9 files, including explicit/tilde cwd, inherited cwd, restart persistence, invalid directories and the live-Claude requirement with an override. Typecheck/build and formatting passed; final lint and diff checks run before commit.

### Follow-up: IDE context badge blocks queued delivery

Live inspection found the new project Bot idle with a styled `[⧉ In 22.md]` editor-context badge in the input box. The empty-input check treated that UI badge as a real draft, while lifecycle status remained ready, so the task stayed queued without a diagnostic. Recognize only the observed standalone styled badge in the hidden-Bot parser, continue rejecting unstyled lookalikes or additional draft text, and include queued work in the no-progress diagnostic. Verify the real pending request continues under the same Bot and request ids after deploying the fix.

Validation: all 80 Bot tests, lint, typecheck/build, formatting and diff checks passed. Updated only the test server, preserving Bot and request identities. The previously queued live request changed to sent and the existing Bot began reading its task inputs. No replacement Bot or duplicate request was created.
