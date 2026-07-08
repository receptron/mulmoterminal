// Dispatch a header action button. `input` types text into the running session; `open` opens a
// url / reveals a dir / opens the in-app file explorer or a view. `shell` (run an arbitrary command
// in the dir) needs a command-cell handoff and lands in a later phase; the server already drops shell
// buttons from /api/header, so the branch below is only a defensive fallback (no-op warn).
import { filesGotoIndex } from "./useFilesView";
import { prsGotoIndex } from "./usePrsView";
import { wikiGotoIndex } from "./useWikiBrowse";
import { browseGotoIndex } from "./useCollectionBrowse";
import { accountingViewOpen } from "./useAccountingView";
import { submitText } from "./useTerminalConnections";
import type { HeaderButton, OpenTarget } from "./useHeaderButtons";

const OPEN_URL_SCHEMES: ReadonlySet<string> = new Set(["http:", "https:"]);

function openUrl(url: string): void {
  try {
    if (OPEN_URL_SCHEMES.has(new URL(url).protocol)) window.open(url, "_blank", "noopener,noreferrer");
  } catch {
    // malformed url — ignore
  }
}

function revealDir(dirPath: string): void {
  fetch("/api/open-dir", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: dirPath }) }).catch(() => {});
}

function openView(view: string, cwd: string | null): void {
  if (view === "prs") prsGotoIndex();
  else if (view === "wiki") wikiGotoIndex();
  else if (view === "collections") browseGotoIndex("collection");
  else if (view === "accounting") accountingViewOpen();
  else filesGotoIndex(cwd); // "files" and (until a dedicated route) "diff"
}

function dispatchOpen(open: OpenTarget, cwd: string | null): void {
  if (open.url) openUrl(open.url);
  else if (open.reveal) revealDir(open.reveal);
  else if (open.files) filesGotoIndex(open.files);
  else if (open.view) openView(open.view, cwd);
}

export function runHeaderButton(button: HeaderButton, slotKey: string | null, cwd: string | null): void {
  if (button.run === "input" && button.text && slotKey) {
    submitText(slotKey, button.text);
    return;
  }
  if (button.run === "open" && button.open) {
    dispatchOpen(button.open, cwd);
    return;
  }
  // run === "shell": suppressed server-side until the command-cell phase (see plans/feat-header-toolbar-config.md);
  // this only fires if a shell button somehow reaches the client.
  console.warn(`[header] shell button "${button.id}" runs in a later update`);
}
