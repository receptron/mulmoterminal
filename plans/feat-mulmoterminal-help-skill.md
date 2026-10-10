# feat: `mulmoterminal-help` — a bundled help desk, launched from a toolbar help icon

Issue: #2984

## What exists today

- Two conversational entry points ship: `mulmoterminal-config` (routes to the writing skills and
  reports how things are configured) and `mulmoterminal-bug-report` (is it broken, or configuration,
  or by design). Neither owns "how do I use X", "what does this part of the screen do" or "what
  changed in the latest version".
- Settings' Help section is two links to the published guide (`HelpSection.vue` → `GuideLinks.vue`).
- The npm package ships README and the dated release pages (`docs/guide/{en,ja}/v*.md`) and nothing
  else from `docs/`: no feature pages, no feature list, no `docs/ChangeLog.md`. `src/` ships only as
  `dist/`. Nothing tells a skill where the installed package is.
- Every PTY gets `MULMOTERMINAL_PORT` (`server/session/pty/pty-spawn.ts`), so a skill can always
  reach the server that launched it.
- A Settings skill button is confirmed (`SkillLaunchConfirm`, #1564) and then `GridView.launchSkill`
  starts a chat through `startCollectionChat(skillSeed(skill, …))` — the workspace when no
  collection is open.

## Decisions

1. **One skill, `mulmoterminal-help`.** It answers questions about MulmoTerminal — features, the UI,
   how to set something up, what is new — from the docs, the source and the running server, never
   from memory. Every answer names where it was checked. It hands "it is broken" to
   `mulmoterminal-bug-report` and "change it for me" to `mulmoterminal-config` (which routes on).
2. **`GET /api/help/sources`** answers what the skill needs to start reading: the running version,
   the install kind, the package directory, where the guide / changelog / README / bundled skills are
   inside it, and the public URLs (guide site, changelog on GitHub, repository). Computed from the
   package directory the server already resolves itself from; a pure builder makes it testable.
3. **The docs ship in the package.** `files` grows to every `docs/guide/{en,ja}/*.md`,
   `docs/ChangeLog.md` and `docs/facts.json`, so the skill reads the pages that match the running
   version, offline. Chosen over fetching the version tag from GitHub (user's call: exactness and no
   network dependency over package size).
4. **One click launches it.** The toolbar icon (next to the gear) and the button in Settings → Help
   both start the session immediately — no confirmation (user's call). The confirm dialog exists to
   warn before an agent edits config; this skill edits nothing, and the button's own hint says a
   terminal opens. `SkillLaunchButton` therefore takes an optional `hint`, since its default sentence
   promises config edits.
5. **The session starts in the workspace** (`project: null`), whatever collection is on screen: the
   question is about the app, not about the project the user happens to be looking at. The agent is
   the Launch agent picker's current choice, seeded through `skillSeed` so codex gets the sentence
   form.
6. **Pointers in SKILL.md are checked by a spec**, the way `faqEntries.ts` checks the FAQ: every repo
   path and every `/api/…` route the skill names must exist, so a rename fails CI instead of sending
   a user to a file that is not there.

## Out of scope (deliberately)

- A keymap action / palette row for help: Settings' Help tab already has a palette row.
- A launch button in the empty-grid footer.
- The feature list entry: written at release time (`as_of` is pinned to `package.json`).

## Files

- `common/bundledSkills.ts` — add the name.
- `server/skills/mulmoterminal-help/SKILL.md` — the skill.
- `server/help/help-sources.ts` (pure), `server/help/routes.ts`, mounted from `server/routes/app-routes.ts`.
- `package.json` — `files`.
- `src/components/helpChat.ts` — `openHelpChat()`; `AppToolbar.vue`, `settings/HelpSection.vue`,
  `SettingsModal.vue`, `SkillLaunchButton.vue`; five locale bundles + five tip bundles.
- Specs: `test/server/help/*.spec.ts`, `test/server/skills/help-skill-pointers.spec.ts`,
  `test/src/components/helpChat.spec.ts`, and the existing toolbar / Settings / installer specs.
- Docs: README, `docs/guide/{en,ja}/features.md`, `docs/guide/{en,ja}/getting-started.md`,
  `docs/ChangeLog.md` (Unreleased).

## Verification

- `yarn format` → `yarn lint` → `yarn build` → `yarn typecheck` → `yarn test`.
- `npm pack --dry-run --ignore-scripts` lists the guide pages, the changelog and `facts.json`.
- Run the app: press the toolbar help icon, see a cell open in the workspace with `/mulmoterminal-help`
  sent; ask "what is new in this version" and check the answer cites the running version's page.
- `curl http://localhost:<port>/api/help/sources` answers the package directory this checkout runs from.
