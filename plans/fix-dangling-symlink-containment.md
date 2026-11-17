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
- When that entry is a link that cannot be resolved to the end, it is followed one step
  (`readlink`, a relative target read from the folder the link REALLY is in, since the spelling may
  have reached that folder through another link) and the result is resolved again,
  the rest appended. A chain longer than `MAX_LINK_HOPS`, or a cycle, is refused.
- A path with no such link on it resolves exactly as before.

Every caller of `realContainedWithin` gets this: `resolveContained` (the browse, raw, git-status
and pane-tool routes), `tree-ops.ts` (its parent check) and `thumbnailStore.ts`. A dangling link
out is now a symlink escape, so the 403 from the browse routes carries `escape: "symlink"` as for
any other link out (#3301).

A dangling link that stays inside resolves to the file it would create, as a link to an existing
file inside resolves to that file.

## Verification

- `yarn test`: dangling links out (absolute and relative target, a folder, a chain, a cycle) are
  refused; one inside is accepted; `/browse/write` refuses the save and creates nothing outside.
  The new cases fail against the code before this change.
- Old and new `realContainedWithin` run side by side over generated trees of folders, files and
  links (inside, outside, missing; absolute and relative): every difference has a dangling link on
  the path. For every path the new check accepts, a write to it creates or changes nothing outside
  the project. That property stays as a spec with fixed seeds.
