# feat: Library asks whether a check can enforce a rule before drafting it (#3595)

## Problem

The `mulmoterminal-library` skill turns a conversation, a repeated instruction or a memory into a
`CLAUDE.md` rule. Every destination it has is prose, and a `CLAUDE.md` gets skimmed more the longer
it grows. Nothing in the skill asks whether the mistake could be stopped by something that runs.

## Change

- `server/skills/mulmoterminal-library/SKILL.md` §2 gains **Before a rule: can something enforce it
  instead?** Before drafting a rule, from `promote rule`, `repeat rule` or a tidy-up's `move`, the
  skill asks what could hold it mechanically. Strongest first:
  - the structure itself;
  - a type;
  - a lint rule or CI check that says how to fix it;
  - a test;
  - the `CLAUDE.md` line, last.
- When a check can hold the rule, the first candidate is an `issue` (or `plan`) for that check. It
  names:
  - the check and where it goes;
  - the real mistake from the conversation that it must catch;
  - what it must still let through.

  The rule is offered only for what the check cannot hold, or as its short why.
- Tidy's `move` row points at the same section.
- `docs/guide/{en,ja}/features.md`: the Library entry says so.

## Decisions

- **The skill does not write the check itself.** It writes memories, rules, plans, issues and skills
  after approval. A lint rule or test is code in someone's repository, and belongs in the issue → plan
  → PR flow, so the candidate is an issue.
- **"Goes red on the real mistake" is the condition for done.** A check that has never failed on the
  thing it was written for is not known to catch it.
- **The rule can stay beside the check**, as its why, or for the part a check cannot express.
- The idea is pstack's `correct`: enforce a repeated mistake at the strongest level that works, with
  documentation last.

## Verify

Skill text and guides only. Run:

- `yarn test test/common/libraryPromote.spec.ts test/common/libraryRepeats.spec.ts`
- `test/server/infra/fs/install-bundled-skills.spec.ts`
- the docs specs
