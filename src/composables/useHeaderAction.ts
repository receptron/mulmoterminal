// Dispatch a header action button. `input` types text into the running session; `open` opens a
// url / reveals a dir / opens the in-app file explorer or a view; `action` acts on the CELL this
// terminal is in (restart its agent, open one of its panes, …). `shell` is handled upstream in Terminal.vue (it emits `run`
// to open a command cell), so it never reaches here — the branch below is only a defensive no-op
// warn.
import { filesGotoIndex } from "./useFilesView";
import { githubGotoIndex } from "./useGithubView";
import { wikiGotoIndex } from "./useWikiBrowse";
import { browseGotoIndex } from "./useCollectionBrowse";
import { accountingViewOpen } from "./useAccountingView";
import { submitText, insertText } from "./useTerminalConnections";
import { requestGridCellAction } from "./useGridCellAction";
import { isCellAction, type CellAction } from "../../common/headerActions";
import { isAppAction } from "../../common/appActions";
import { runAppAction } from "./runAppAction";
import { openTerminalAt } from "./useNewTerminal";
import { toInsertText } from "../components/dropPaths";
import type { HeaderButton, OpenTarget } from "./useHeaderButtons";
import { pickPaths } from "./pickPaths";
import { isRemoteServer, REMOTE_SERVER_DECLINE_EN } from "./remoteServer";
import { jsonBody } from "../jsonBody";
import { fetchWithTimeout } from "../utils/fetchWithTimeout";

const OPEN_URL_SCHEMES: ReadonlySet<string> = new Set(["http:", "https:"]);

/** Where a failed action explains itself — the cell's own banner, supplied by Terminal.vue. */
export type ReportProblem = (message: string) => void;

// Open the OS file dialog (server-side, since the browser can't read a real path) and insert the chosen
// path(s) at the session's cursor. slotKey identifies which terminal receives the text. Exported for
// the cell's path menu, so its item and a user's own `pickFile` button cannot drift apart.
export async function pickFileInto(slotKey: string | null, report: ReportProblem): Promise<void> {
  if (!slotKey) return;
  const { paths, error } = await pickPaths();
  if (error) return report(error);
  insertText(slotKey, toInsertText(paths));
}

function openUrl(url: string): void {
  try {
    if (OPEN_URL_SCHEMES.has(new URL(url).protocol)) window.open(url, "_blank", "noopener,noreferrer");
  } catch {
    // malformed url — ignore
  }
}

// Reveal a directory in the OS file manager. The route answers only once the opener has actually
// started, so a host that has none (a bare Linux box with no `xdg-open`) reports it rather than
// leaving the button looking broken (#1447).
export async function revealDir(dirPath: string, report: ReportProblem): Promise<void> {
  if (isRemoteServer()) return report(REMOTE_SERVER_DECLINE_EN); // it would open on the server's screen (#2669)
  try {
    const res = await fetchWithTimeout("/api/open-dir", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: dirPath }),
    });
    if (!res.ok) report(revealFailureText(await jsonBody(res), res.status));
  } catch (e) {
    report(`Could not open the folder: ${e instanceof Error ? e.message : String(e)}`);
  }
}

const revealFailureText = (body: Record<string, unknown>, status: number): string =>
  typeof body.error === "string" && body.error.length > 0 ? body.error : `Could not open the folder (HTTP ${status}).`;

function openView(view: string, cwd: string | null): void {
  // `"prs"` is the value users have written in their own header configs (documented in both
  // guides and the -header skill), so it stays what it is. Only the view it opens was renamed.
  if (view === "prs") githubGotoIndex();
  else if (view === "wiki") wikiGotoIndex();
  else if (view === "collections") browseGotoIndex("collection");
  else if (view === "accounting") accountingViewOpen();
  else filesGotoIndex(cwd); // "files" and (until a dedicated route) "diff"
}

function dispatchOpen(open: OpenTarget, cwd: string | null, slotKey: string | null, report: ReportProblem): void {
  if (open.url) openUrl(open.url);
  else if (open.reveal) void revealDir(open.reveal, report);
  else if (open.files) filesGotoIndex(open.files);
  else if (open.view) openView(open.view, cwd);
  else if (open.terminal) openTerminalAt(open.terminal, slotKey);
  else if (open.pickFile) void pickFileInto(slotKey, report);
}

// Why a grid cell declined. Anything not listed can only fail by the terminal not being a grid cell
// (the single view), which is the fallback.
const DECLINED_EN: Partial<Record<CellAction, string>> = {
  "terminal-restart": "There is no agent running in this terminal to restart.",
  "terminal-timeline": "The activity timeline is only for a Claude session.",
  "terminal-talk": "There is no other terminal to talk to.",
  "terminal-park": "Only a running agent terminal can be set aside.",
  "terminal-copy-code": "There is no session in this terminal to copy from yet.",
  "terminal-insert-path": "This terminal has not started yet.",
  "terminal-reveal": "This terminal has not started yet.",
  "terminal-voice": "Voice input is not available here.",
  "terminal-diff": "This terminal has no changes to show.",
  "terminal-note": "A note needs a running session in this terminal.",
  "terminal-send-turn": "Sending or bringing a turn needs a running agent session in this terminal.",
  "terminal-send-since": "Sending or bringing a turn needs a running agent session in this terminal.",
  "terminal-bring-turn": "Sending or bringing a turn needs a running agent session in this terminal.",
  "terminal-bring-since": "Sending or bringing a turn needs a running agent session in this terminal.",
  "terminal-move-prev": "Moving a terminal needs manual order.",
  "terminal-move-next": "Moving a terminal needs manual order.",
};
const OUTSIDE_GRID_EN = "This button acts on a terminal in the grid.";
// A toolbar operation declines only for a screen that is not set up, or a view / order with no grid.
const APP_DECLINED_EN = "That is not available here — it is not set up, or needs the terminal grid.";

const logProblem: ReportProblem = (message) => console.warn(`[header] ${message}`);

export function runHeaderButton(button: HeaderButton, slotKey: string | null, cwd: string | null, report: ReportProblem = logProblem): void {
  if (button.run === "input" && button.text && slotKey) {
    submitText(slotKey, button.text);
    return;
  }
  if (button.run === "open" && button.open) {
    dispatchOpen(button.open, cwd, slotKey, report);
    return;
  }
  if (button.run === "action") {
    const action = button.action;
    if (isAppAction(action)) {
      if (!runAppAction(action)) report(APP_DECLINED_EN);
    } else if (isCellAction(action) && !requestGridCellAction(slotKey, action)) report(DECLINED_EN[action] ?? OUTSIDE_GRID_EN);
    return;
  }
  // run === "shell" is dispatched by Terminal.vue (emits `run` → command cell); reaching here is a bug.
  console.warn(`[header] shell button "${button.id}" should be handled by Terminal.vue`);
}
