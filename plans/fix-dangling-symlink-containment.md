# fix: a dangling symlink inside the project passes containment (#3303)

## Problem

`realContainedWithin` (`server/files/pathContainment.ts`) splits a path into the part that exists,
which it resolves through symlinks, and the not-yet-created rest. It asked "does this exist" with
`fs.existsSync`, which follows a link. So a link whose target is missing counted as absent: the
check resolved only its parent, appended the link's name, and found it inside the project. A save
through `PUT /api/files/browse/write` then followed the link and created its target outside.

Once the target existed, the same path was refused. The result depended on whether the target
existed, and the one case it let through was the one that created the target.

## Change

- The existing part is found with `lstat`, so a link is an entry whether or not its target exists.
- When that entry is a link that cannot be resolved to the end, its target is walked one component
  at a time from the folder the link REALLY is in, as the OS walks it: a link met on the way is
  followed before a later `..` applies (`hop/../x` with `hop` pointing out leads out; `path.resolve`
  would cancel `hop/..` on paper). The rest of the path is then appended.
- The walk goes on only from a folder that exists: a target that continues past a file (ENOTDIR)
  or past a missing component (ENOENT; this covers `missing/../x` and a trailing `/` or `/.`) is
  refused.
- On Windows a dangling link is refused, not walked. Windows cancels a relative target's `..` on
  paper before following anything and has target forms of its own (`C:foo`, `\\?\`); the walk
  disagreed with it in CI. Refusing costs only creating a file through a link whose target is not
  there yet. `realContainedWithin` takes the platform, as `resolveContained` already did, so this is
  tested on any OS.
- One budget of `MAX_LINK_HOPS` follows covers the whole resolution, nested links included, so a
  cycle or a long chain is refused and crafted targets cannot multiply the work.
- A link removed or swapped while it is being read makes `lstat`/`readlink` throw; that is a refusal,
  not an exception out of the gate.
- A path with no such link on it resolves exactly as before.
- A junction on Windows: Node reports it as a symbolic link, so it takes the same path. A
  Windows-only spec pins a dangling junction out being refused.

Every caller of `realContainedWithin` gets this: `resolveContained` (the browse, raw, git-status
and pane-tool routes), `tree-ops.ts` (its parent check) and `thumbnailStore.ts`. A dangling link
out is now a symlink escape, so the 403 from the browse routes carries `escape: "symlink"` as for
any other link out (#3301).

A dangling link that stays inside resolves to the file it would create, as a link to an existing
file inside resolves to that file.

## Not changed

- The gap between the check and the file operation, which a path swapped for a link in between
  escapes, predates this and applies to every path: #3306.

## Verification

- `yarn test`: dangling links out (absolute and relative target, a folder, a chain, a cycle) are
  refused; one inside is accepted; `/browse/write` refuses the save and creates nothing outside.
  The new cases fail against the code before this change.
- Old and new `realContainedWithin` run side by side over generated trees of folders, files and
  links (inside, outside, missing; absolute and relative): every difference has a dangling link on
  the path. For every path the new check accepts, a write to it creates or changes nothing outside
  the project, and lands at the path the check answered. That property stays as a spec with fixed
  seeds; it fails against the previous code, against reading a relative target from the spelled
  folder, and against cancelling `..` on paper.
