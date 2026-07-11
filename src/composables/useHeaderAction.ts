// Dispatch a header action button. `input` types text into the running session; `open` opens a
// url / reveals a dir / opens the in-app file explorer or a view. `shell` is handled upstream in
// Terminal.vue (it emits `run` to open a command cell), so it never reaches here — the branch below
// is only a defensive no-op warn.
import { filesGotoIndex } from "./useFilesView";
import { prsGotoIndex } from "./usePrsView";
import { wikiGotoIndex } from "./useWikiBrowse";
import { browseGotoIndex } from "./useCollectionBrowse";
import { accountingViewOpen } from "./useAccountingView";
import { submitText, insertText } from "./useTerminalConnections";
import { toInsertText } from "../components/dropPaths";
import type { HeaderButton, OpenTarget } from "./useHeaderButtons";

const OPEN_URL_SCHEMES: ReadonlySet<string> = new Set(["http:", "https:"]);

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

// Open the OS file dialog (server-side, since the browser can't read a real path) and insert the chosen
// path(s) at the session's cursor. slotKey identifies which terminal receives the text.
async function pickFileInto(slotKey: string | null): Promise<void> {
  if (!slotKey) return;
  try {
    const res = await fetch("/api/pick-file", { method: "POST", headers: { "content-type": "application/json" } });
    if (!res.ok) return;
    const data: unknown = await res.json();
    const paths = isRecord(data) && Array.isArray(data.paths) ? data.paths.filter((p): p is string => typeof p === "string") : [];
    insertText(slotKey, toInsertText(paths));
  } catch {
    // best-effort — the native dialog is unavailable or the user canceled
  }
}

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

function dispatchOpen(open: OpenTarget, cwd: string | null, slotKey: string | null): void {
  if (open.url) openUrl(open.url);
  else if (open.reveal) revealDir(open.reveal);
  else if (open.files) filesGotoIndex(open.files);
  else if (open.view) openView(open.view, cwd);
  else if (open.pickFile) void pickFileInto(slotKey);
}

export function runHeaderButton(button: HeaderButton, slotKey: string | null, cwd: string | null): void {
  if (button.run === "input" && button.text && slotKey) {
    submitText(slotKey, button.text);
    return;
  }
  if (button.run === "open" && button.open) {
    dispatchOpen(button.open, cwd, slotKey);
    return;
  }
  // run === "shell" is dispatched by Terminal.vue (emits `run` → command cell); reaching here is a bug.
  console.warn(`[header] shell button "${button.id}" should be handled by Terminal.vue`);
}
