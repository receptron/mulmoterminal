// The FILE a Canvas card is about, as one absolute path — the string card identity is built from.
//
// A deck reaches the Canvas under more than one spelling. The plugin addresses it on the wire as
// `stories/<tail>` plus a root id, and which root answers depends on what this server happened to
// register: with only the workspace registered a deck is `W\0stories/proj/decks/x.json`, and
// registering `…/proj` as a preset makes the SAME file `P\0stories/decks/x.json`. Identity built
// from the wire spelling therefore moves when the user adds a directory and restarts — one deck,
// two cards, and the second one supersedes nothing (#1976).
//
// So the spelling is resolved back to the file before anything is compared. Everything needed is
// already on the card and in `/api/config`: a root id names a canonical directory, and the tail is
// the same relative path either way, so both spellings above resolve to
// `/Users/me/w/proj/decks/x.json` — the same string a card built from that absolute path carries.
//
// LEXICAL, like the gate in canvasOpenFile.ts and for the same reason: a browser cannot realpath.
// What it sees through is the several spellings of a ROOT — the server resolved those once, at
// boot, and says which one that is. What it cannot see through is a symlink in a path nobody
// resolved: below a root, or inside an absolute `filePath`, which the plugin echoes as the CALLER
// spelled it (`locate` in the package's core hands `byPath` the path it was given). Those stay two
// identities. So is a path rooted on a Windows drive the spelling does not carry (`\deck.json`, or
// `/deck.json` on a Windows host) — see `windowsSpelled` below. Closing all of it means putting the
// server's own resolved path on the card payload — both sides already compute one — and it is
// deliberately not in this change.
import { dirPathKey, isRootedPath } from "../../common/dirPathKey";

/** The plugin's wire prefix for a story. Minted by `storyWirePath`, parsed here — one constant, so
 *  the two cannot drift into disagreeing about what a story path looks like. */
export const STORY_WIRE_PREFIX = "stories/";

/** Where the DEFAULT root's stories live, under the workspace. Both halves are fixed by the
 *  plugin: the artifacts area is its only file capability, and `stories/` is its wire prefix. */
export const STORY_DIR = "artifacts/stories";

/** The directories a card's wire path is resolved against, as this server registered them. */
export interface StoryRootDirs {
  /** The workspace, canonically spelled: the base of the root addressed WITHOUT an id. Null until
   *  `/api/config` lands — which reads as "cannot resolve", never as "the workspace is `/`". */
  workspace: string | null;
  /** Canonical directory per registered root id. A card naming an id that is absent — a root from
   *  another machine, or one whose preset was removed — resolves to nothing rather than to a guess. */
  byId: Readonly<Record<string, string>>;
}

/** What the browser knows before the config arrives: nothing resolves, so every card keeps the
 *  identity it had before this rule existed. */
export const NO_STORY_ROOTS: StoryRootDirs = { workspace: null, byId: {} };

/**
 * The resolution table, from what `/api/config` reports.
 *
 * The FIRST entry is the workspace — the server registers it first, and that is the contract
 * `storiesRootsFrom` already reads the same array by (#1951). `canonical` is the server's own
 * realpathed spelling, never re-derived here: a browser cannot realpath, and a rule that guessed
 * which of a root's spellings was the resolved one would resolve one card differently from the next.
 */
export const storyRootDirsFrom = (registered: ReadonlyArray<{ id: string; canonical?: string }>): StoryRootDirs => ({
  workspace: registered[0]?.canonical ?? null,
  byId: Object.fromEntries(registered.flatMap((root) => (root.canonical ? [[root.id, root.canonical] as const] : []))),
});

/** Drive-qualified or a UNC share: the two spellings that name a file on a WINDOWS host without
 *  depending on which drive the process happens to be on. */
const DRIVE_OR_SHARE = /^([a-zA-Z]:[/\\]|[/\\]{2})/;

/**
 * Whether this SERVER spells its own directories with a drive letter.
 *
 * Read off the roots it registered, never off `navigator`: the page can be open on a phone while
 * the files live on a Windows machine, so the browser's own platform says nothing about theirs.
 * Unknown (no roots yet) reads as POSIX, which is the spelling every other host uses.
 */
const windowsSpelled = (dirs: StoryRootDirs): boolean => {
  const dir = dirs.workspace ?? Object.values(dirs.byId)[0];
  return dir !== undefined && /^[a-zA-Z]:[/\\]/.test(dir);
};

/** No join helper: `dirPathKey` folds a doubled separator, so a root directory (`/`, `C:/`) that
 *  already ends in one costs nothing. */
const defaultStoriesDir = (workspace: string | null): string | null => (workspace === null ? null : `${workspace}/${STORY_DIR}`);

/**
 * The absolute path `filePath` names, or null when this browser cannot say.
 *
 * Null is the important answer: an unregistered root, a config that has not arrived, a relative
 * path belonging to some other tool's addressing. The caller keeps its old identity for those, so
 * nothing that used to fold apart starts folding together on a guess.
 */
export function canonicalCardPath(filePath: string, root: string | null, dirs: StoryRootDirs): string | null {
  // Already the answer, whoever minted it. Keyed all the same, so `/w/./x.json` and `/w/x.json` are
  // one card.
  //
  // Except on a Windows host, where `/deck.json` means what `\deck.json` does — rooted on the
  // process's CURRENT DRIVE, which the spelling does not carry (Codex P2 on #1976). `isRootedPath`
  // cannot refuse that form, since on every other host it is THE absolute spelling; only the
  // server's own roots say which host this is. Refused there, the card keeps its legacy identity
  // rather than being keyed into something `C:\deck.json` cannot match. What closes it properly is
  // the server putting its resolved path on the card — see the header.
  if (isRootedPath(filePath)) return windowsSpelled(dirs) && !DRIVE_OR_SHARE.test(filePath.trim()) ? null : dirPathKey(filePath);
  if (!filePath.startsWith(STORY_WIRE_PREFIX)) return null;
  const tail = filePath.slice(STORY_WIRE_PREFIX.length);
  const base = root === null ? defaultStoriesDir(dirs.workspace) : (dirs.byId[root] ?? null);
  // A bare `stories/` names the directory, not a card in it.
  if (base === null || tail === "") return null;
  return dirPathKey(`${base}/${tail}`);
}
