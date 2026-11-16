# fix: media behind a symlink out of the project shows in the pane (#3301)

## Problem

A path like `data/media/clip.mp4` is inside the project by its spelling, so a click hands it to the
Files pane. `data/media` is a symlink to a folder outside the project, so the project-scoped routes
(`/api/files/browse/*`, `/api/files/raw`) refuse it with 403, as they must. The pane showed the
server's sentence, `path escapes the project root`, and nothing else.

## Change

- The browse routes' 403 says when a symlink is what leads out: `{ error, escape: "symlink" }`
  (`common/symlinkEscape.ts`). `escapesThroughSymlink` in `server/files/pathContainment.ts` decides
  it: contained by spelling, not contained by real location. A climb by `..`, an absolute path, a
  tilde out and a Windows device name get no field.
- The pane, for a picture, PDF, video or sound refused that way, asks for the one-file URL a click on
  an outside file already gets (`/api/files/grant`) and shows the file through it
  (`src/composables/symlinkedMedia.ts`, `useOpenFile.ts`). The decision reads the field, never the
  sentence.
- A text file refused that way, or a grant that fails, says why in the UI language
  (`outsideFile.symlinkNotShown`, and the existing `outsideFile.missing`).

## Not changed

- `/api/files/raw` and the browse routes still refuse every escape. The grant serves one file and
  nothing beside it, and could already be asked for any file by the app's own pages.
- A page (`.html`) behind such a link: the pane previews pages through the project's page route,
  which a grant does not stand in for.
- A file opened through a grant has no version, so the pane does not reload it when it changes on
  disk.
- `resolveContained` accepts a dangling symlink (it reads as a file not yet created). This is older
  than this change and is not touched here.

## Verification

- `yarn test`: the field is set for a symlink escape on `/browse/version` and `/browse/text` and for
  no other refusal; `escapesThroughSymlink` agrees with `resolveContained`; the pane asks for a grant
  only for that refusal and that kind, says why otherwise, and goes back to the raw route for the
  next file.
- In Chromium and WebKit, against a scratch-HOME server built from this branch, `/files` opened a
  real H.264 file behind a symlink out of the project and played it through the granted URL; one
  inside played through the raw route; a text file and a missing file behind the link showed their
  reasons.
