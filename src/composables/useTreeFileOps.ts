// The tree's file operations from the row menu (#2578): a new file or folder, a rename, and a move to
// the Trash. The server does the work and keeps it inside the pane's root (files-tree-routes.ts);
// this end asks for the name, keeps the tabs on what moved, and reads the folder again.
//
// A tab on a renamed entry stays open under the new name; a tab on a trashed one closes. The file in
// front is saved and put down first when it is the one moving, so no buffer is left pointing at a
// path that is gone, and it comes back up afterwards — at its new name, or its neighbour.
import { nextTick, onMounted, ref, watch, type Ref } from "vue";
import type { FilesRowAction } from "../components/filesRowActions";
import { browseQuery } from "../components/filesPaneApi";
import { isUnder, renamedIn, withoutEntry, type TabStrip } from "../components/filesTabs";
import { treeOp, trashAvailable, type TreeOpOutcome } from "../components/treeFileOpsApi";
import type { FilesTabs } from "./useFilesTabs";
import type { FilesTree } from "./useFilesTree";
import type { OpenFile } from "./useOpenFile";

export type TreeOpAction = Extract<FilesRowAction, { id: "new-file" | "new-folder" | "rename" | "trash" }>;

export const isTreeOpAction = (action: FilesRowAction): action is TreeOpAction =>
  action.id === "new-file" || action.id === "new-folder" || action.id === "rename" || action.id === "trash";

export interface TreeFileOpsDeps {
  cwd: () => string | null;
  /** The remote host the root is on; absent or null for this machine. */
  host?: () => string | null;
  tree: Pick<FilesTree, "refresh" | "findNode" | "toggleDir">;
  tabs: Pick<FilesTabs, "strip" | "current" | "restore" | "open">;
  file: Pick<OpenFile, "close" | "fileError">;
  t: (key: string, params?: Record<string, string>) => string;
  /** Put the keyboard on a tree row — `""` for the first — and say whether there was one: the menu that
   *  asked is gone, and so, after a rename or a Trash, may be the row it was opened on. */
  focusRow: (pathRel: string) => boolean;
  /** Something on disk changed — the git marks are read again, and an open gallery follows (#3079). */
  changed: (action: TreeOpAction) => void;
  /** The browser's own dialogs by default; a spec drives the flows with its own. */
  ask?: (message: string, value: string) => string | null;
  confirm?: (message: string) => boolean;
}

export interface TreeFileOps {
  /** Whether the server has a Trash to move entries to; without one the menu offers no delete. */
  trash: Ref<boolean>;
  run: (action: TreeOpAction) => Promise<void>;
}

const parentOf = (pathRel: string): string => (pathRel.includes("/") ? pathRel.slice(0, pathRel.lastIndexOf("/")) : "");
const nameOf = (pathRel: string): string => pathRel.slice(pathRel.lastIndexOf("/") + 1);

/** The deps with the dialogs settled, and the folder the pane was on when the operation was asked
 *  for: `moved()` is true once the pane is on another, and then nothing more of this one is applied. */
type Ctx = TreeFileOpsDeps & {
  ask: NonNullable<TreeFileOpsDeps["ask"]>;
  confirm: NonNullable<TreeFileOpsDeps["confirm"]>;
  root: string | null;
  rootHost: string | null;
  moved: () => boolean;
};

const hostOf = (deps: TreeFileOpsDeps): string | null => deps.host?.() ?? null;

/** Where an operation leaves the keyboard, or null when the pane moved to another folder while the
 *  request was out — nothing of this one is applied to that folder's tree or tabs then. */
type Landing = string | null;

/** Said after the tabs settle: reopening the front file clears the pane's error line. */
function report(ctx: Ctx, outcome: TreeOpOutcome): void {
  if (!outcome.ok) ctx.file.fileError.value = outcome.message;
}

async function create(ctx: Ctx, action: { dirRel: string; rowRel: string }, kind: "file" | "dir"): Promise<Landing> {
  const name = ctx.ask(ctx.t(kind === "file" ? "fileOps.newFile" : "fileOps.newFolder"), "")?.trim();
  if (!name) return action.rowRel;
  const outcome = await treeOp(ctx.rootHost, "create", browseQuery(ctx.root, action.dirRel), { name, kind });
  if (ctx.moved()) return null;
  if (!outcome.ok || !outcome.path) {
    report(ctx, outcome);
    return action.rowRel;
  }
  // Read again first — a folder opened once and collapsed keeps its old listing — then opened, so
  // the new entry is in sight.
  await ctx.tree.refresh(action.dirRel);
  const dir = action.dirRel === "" ? null : ctx.tree.findNode(action.dirRel);
  if (!ctx.moved() && dir?.dir && !dir.expanded) await ctx.tree.toggleDir(dir);
  if (ctx.moved()) return null;
  // On its editor whatever view the pane carries: a file just made is there to be written.
  if (kind === "file") await ctx.tabs.open(outcome.path, false, { path: outcome.path });
  return ctx.moved() ? null : outcome.path;
}

/** Put the front file down when it is on the moving entry. False when it could not be (a save that
 *  lost to another writer): the operation does not happen then. */
async function releaseFront(ctx: Ctx, entry: string): Promise<boolean> {
  const front = ctx.tabs.strip.value.activePath;
  return front === null || !isUnder(front, entry) || ctx.file.close();
}

/** The strip after the operation, shown: the change applied to the strip as it is NOW, so a tab opened
 *  while the request was out is kept. The front file is reopened only when it moved AND the reader is
 *  still on it — a file they turned to meanwhile stays in front (#2694). */
async function settle(ctx: Ctx, before: TabStrip, change: (strip: TabStrip) => TabStrip, frontMoved: boolean): Promise<void> {
  const now = ctx.tabs.current();
  if (frontMoved && now.activePath === before.activePath) await ctx.tabs.restore(change(withFrontFrom(before, now)), () => true);
  else ctx.tabs.strip.value = change(now);
}

/** `now` with the front tab as it was in `before`: the front file was put down before the move, and
 *  only `before` still holds where the reader was in it (Preview or not, the caret, the scroll). */
function withFrontFrom(before: TabStrip, now: TabStrip): TabStrip {
  const front = before.tabs.find((tab) => tab.path === before.activePath);
  return front ? { ...now, tabs: now.tabs.map((tab) => (tab.path === front.path ? front : tab)) } : now;
}

interface EntryMove {
  route: "rename" | "trash";
  body: Record<string, unknown>;
  change: (strip: TabStrip, outcome: TreeOpOutcome) => TabStrip;
}

/** Rename or Trash `pathRel`, and settle the tree and the tabs around it. */
async function moveEntry(ctx: Ctx, pathRel: string, move: EntryMove): Promise<Landing> {
  const before = ctx.tabs.current();
  const frontMoved = before.activePath !== null && isUnder(before.activePath, pathRel);
  if (!(await releaseFront(ctx, pathRel))) return pathRel;
  // The save that put the front file down is a round trip: the pane may have moved on meanwhile, and
  // the same relative path in another folder is another entry.
  if (ctx.moved()) return null;
  const outcome = await treeOp(ctx.rootHost, move.route, browseQuery(ctx.root, pathRel), move.body);
  if (ctx.moved()) return null;
  await ctx.tree.refresh(parentOf(pathRel));
  if (ctx.moved()) return null;
  await settle(ctx, before, (strip) => move.change(strip, outcome), frontMoved);
  if (ctx.moved()) return null;
  report(ctx, outcome);
  if (!outcome.ok) return pathRel;
  return move.route === "rename" && outcome.path ? outcome.path : parentOf(pathRel);
}

function rename(ctx: Ctx, pathRel: string): Promise<Landing> {
  const name = ctx.ask(ctx.t("fileOps.rename"), nameOf(pathRel))?.trim();
  if (!name || name === nameOf(pathRel)) return Promise.resolve(pathRel);
  return moveEntry(ctx, pathRel, {
    route: "rename",
    body: { name },
    change: (strip, outcome) => (outcome.ok && outcome.path ? renamedIn(strip, pathRel, outcome.path) : strip),
  });
}

function moveToTrash(ctx: Ctx, pathRel: string): Promise<Landing> {
  if (!ctx.confirm(ctx.t("fileOps.trashConfirm", { name: nameOf(pathRel) }))) return Promise.resolve(pathRel);
  return moveEntry(ctx, pathRel, { route: "trash", body: {}, change: (strip, outcome) => (outcome.ok ? withoutEntry(strip, pathRel) : strip) });
}

function landingOf(ctx: Ctx, action: TreeOpAction): Promise<Landing> {
  if ("dirRel" in action) return create(ctx, action, action.id === "new-file" ? "file" : "dir");
  return action.id === "rename" ? rename(ctx, action.pathRel) : moveToTrash(ctx, action.pathRel);
}

export function useTreeFileOps(deps: TreeFileOpsDeps): TreeFileOps {
  const trash = ref(false);
  // Asked again when the pane moves to another machine's folder: the Trash is that machine's.
  let trashAsk = 0;
  async function askTrash(): Promise<void> {
    const ask = ++trashAsk;
    const available = await trashAvailable(hostOf(deps));
    if (ask === trashAsk) trash.value = available;
  }
  onMounted(() => void askTrash());
  watch(
    () => hostOf(deps),
    () => void askTrash(),
  );
  const dialogs = {
    ask: deps.ask ?? ((message: string, value: string) => window.prompt(message, value)),
    confirm: deps.confirm ?? ((message: string) => window.confirm(message)),
  };

  async function run(action: TreeOpAction): Promise<void> {
    const root = deps.cwd();
    const rootHost = hostOf(deps);
    const ctx: Ctx = { ...deps, ...dialogs, root, rootHost, moved: () => deps.cwd() !== root || hostOf(deps) !== rootHost };
    const landing = await landingOf(ctx, action);
    if (landing === null) return;
    deps.changed(action);
    await nextTick();
    // The landing row, else the row the menu was opened on, else the first row: never the page.
    const opener = "rowRel" in action ? action.rowRel : action.pathRel;
    if (!deps.focusRow(landing) && !deps.focusRow(opener)) deps.focusRow("");
  }

  return { trash, run };
}
