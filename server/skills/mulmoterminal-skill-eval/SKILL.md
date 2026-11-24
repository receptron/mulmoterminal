---
name: mulmoterminal-skill-eval
description: Set up a check of whether one skill actually helps — draft a few small test tasks for it, each with a pass/fail check, show them to the user in plain words, and after they approve, save them where MulmoTerminal's Skills screen can run them with and without the skill and compare. Use when the user asks to evaluate, test, benchmark or measure a skill, asks "does this skill work?", "is this skill worth keeping?", or presses Evaluate in the Skills screen. Also edits an existing set of test tasks. Writes only under ~/.mulmoterminal/skill-evals/. Works in whatever language the user writes in.
---

# Set up an evaluation of one skill

The user wants to know whether a skill earns its place. MulmoTerminal answers that by running small
tasks twice — once with the skill available, once without — three times each, and comparing how
often each passes. Your job is the part only a person can approve: **which tasks, and what counts as
passing.** You do not run anything here. The user presses **Measure** in the Skills screen for that.

The user may not be an engineer. Talk about tasks and results, not about JSON or shells, unless they
ask.

## 1. Find the skill and read it

The request names the skill (for example `weekly-report`, or `plugin:slug` for a plugin's skill),
where its `SKILL.md` is, and the folder to save the evaluation in. Read the `SKILL.md` and any files
next to it. Work out what it is FOR: the kind of request it should
change, and what a good result looks like. If you cannot find it, say so and stop.

If `cases.json` already exists in that folder, read it: the user may want to change it rather than
start again. Use exactly the folder the request gives: a folder's skill has a folder name of its own,
so two projects with a skill of the same name keep separate evaluations.

## 2. Draft the tasks

Draft **3 to 5 "use" tasks** and **exactly 1 "avoid" task**.

- **use** — a request the skill should make better. Real, small, finishable in a few minutes by an
  agent working alone in an empty folder. Vary them: an easy one, a typical one, an awkward one.
- **avoid** — a request that looks a little like the skill's area but where using the skill would be
  wrong. It catches a skill that fires on everything.

Each task runs in a fresh, empty folder with only the files you give it. The agent has no access to
the user's projects, no other skills, and no `CLAUDE.md`. It may create and edit files there. Beyond
that it may run only the commands you list in `allowedTools` — only add ones the task truly needs, and
tell the user what each one allows — plus whatever the skill itself grants in its own `allowed-tools`,
exactly as it would when the user runs it. If the skill grants tools, say so to the user.

Do NOT write the task so that it only makes sense with the skill ("follow the weekly-report format").
Write what a person would actually ask. The skill's job is to make that request turn out better.

## 3. Decide how each task is judged

Each task gets one check, and the result is pass or fail — never a score.

- **command** — when the result can be checked mechanically: a file exists, contains a line, a JSON
  file parses, a number is right. The command runs in the task's folder with `/bin/sh -c`; exit 0 is a
  pass. Keep it short and test it in your head against a good and a bad result.
- **rubric** — when it takes reading: tone, whether a summary is faithful, whether the three headings
  make sense. Write 2 to 5 short items, each one a yes/no question about the RESULT that a careful
  reader could answer from the files. Another AI checks every item against the files; all must hold.

Prefer a command where one is honest. A rubric item like "is good" is not a check.

## 4. Show the user, in plain words

Before writing anything, show the draft as a short list, one task per entry:

- what the agent is asked (the request, quoted)
- what counts as a pass, in a sentence
- for "avoid": why using the skill there would be wrong

Then say what a run will cost to do: the number of runs is (use tasks × 2 + avoid tasks) × 3, and
MulmoTerminal shows the price limit before it starts. Ask them to approve, change, add or drop tasks.
**Do not write the file until they approve.**

## 5. Write the file

Write `cases.json` in the folder the request gave:

```json
{
  "version": 1,
  "skill": "weekly-report",
  "model": "haiku",
  "repeats": 3,
  "cases": [
    {
      "id": "plain-notes",
      "title": "Turn a week of notes into a report",
      "kind": "use",
      "prompt": "Here are my notes for this week in notes.md. Write my weekly report to report.md.",
      "check": { "type": "command", "command": "test -s report.md && grep -qi 'next' report.md" }
    },
    {
      "id": "faithful",
      "title": "Does not invent work",
      "kind": "use",
      "prompt": "Write my weekly report to report.md from notes.md.",
      "check": { "type": "rubric", "items": ["Every task in report.md appears in notes.md", "report.md has a section for what comes next"] }
    },
    {
      "id": "not-a-report",
      "title": "A plain question about the notes",
      "kind": "avoid",
      "prompt": "How many meetings are in notes.md? Just tell me the number.",
      "check": { "type": "rubric", "items": ["The answer gives the number of meetings in notes.md"] }
    }
  ]
}
```

- `skill` must be exactly the skill's name (`plugin:slug` for a plugin's).
- `id`: lowercase letters, digits and `-`, unique.
- Optional: `model` (default `haiku`), `judgeModel` (the model that checks rubric items, default
  `haiku`), `repeats` (default 3, at most 5), `maxBudgetUsdPerAttempt` (default 0.5),
  `allowedTools` (for example `["Bash(python3 *)"]`). At most 20 tasks.
- A task's starting files go in `files/<id>/` in that folder — they are copied
  into the empty folder before the task runs. Write them yourself; keep them small and made up, never
  copied from the user's real files.

Then tell the user it is saved, and that **Measure** on the skill in the Skills screen runs it. Say
that with only a handful of tasks, a small difference will read as "no evidence of a difference" —
that is the honest answer, not a failure.
