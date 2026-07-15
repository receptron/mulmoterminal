import type { Express, Request } from "express";
import { spawn } from "node:child_process";
import path from "node:path";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

// A native "open file/folder" dialog per platform whose stdout is the selection's
// absolute path(s), newline-separated. Browsers can't hand the terminal a real
// filesystem path, but the local server can ask the OS. Fixed command + literal
// argv (the prompts are constants) — no shell, no input interpolation.
const FILE_PROMPT = "Select file(s)";
const DIR_PROMPT = "Select folder";

// macOS: `choose file` (multi) vs `choose folder` (single — a working directory is one dir).
function macArgs(directory: boolean): string[] {
  if (directory) return ["-e", `return POSIX path of (choose folder with prompt "${DIR_PROMPT}")`];
  return [
    "-e",
    `set chosen to choose file with prompt "${FILE_PROMPT}" with multiple selections allowed`,
    "-e",
    "set text item delimiters to linefeed",
    "-e",
    "set out to {}",
    "-e",
    "repeat with f in chosen",
    "-e",
    "set end of out to POSIX path of f",
    "-e",
    "end repeat",
    "-e",
    "return out as text",
  ];
}

function winArgs(directory: boolean): string[] {
  const dialog = directory
    ? "$d = New-Object System.Windows.Forms.FolderBrowserDialog; if ($d.ShowDialog() -eq 'OK') { $d.SelectedPath }"
    : "$d = New-Object System.Windows.Forms.OpenFileDialog; $d.Multiselect = $true; if ($d.ShowDialog() -eq 'OK') { $d.FileNames -join \"`n\" }";
  return ["-NoProfile", "-STA", "-Command", `Add-Type -AssemblyName System.Windows.Forms; ${dialog}`];
}

export function pickFileCommand(platform: NodeJS.Platform, directory = false): { cmd: string; args: string[] } {
  if (platform === "darwin") return { cmd: "osascript", args: macArgs(directory) };
  if (platform === "win32") return { cmd: "powershell", args: winArgs(directory) };
  const zenity = directory
    ? ["--file-selection", "--directory", `--title=${DIR_PROMPT}`]
    : ["--file-selection", "--multiple", "--separator=\n", `--title=${FILE_PROMPT}`];
  return { cmd: "zenity", args: zenity };
}

export function parsePickerOutput(stdout: string): string[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && path.isAbsolute(line));
}

interface PickFileOptions {
  isAllowedOrigin: (origin?: string) => boolean;
}

// POST /api/pick-file — open the OS file dialog and return the chosen absolute
// path(s). Body `{ directory: true }` opens a FOLDER picker instead (for the launcher's
// Working-directory field). A user cancel yields empty stdout, so the response is
// { paths: [] }. Same-origin guarded like the other local-action routes.
export function mountPickFileRoute(app: Express, { isAllowedOrigin }: PickFileOptions) {
  app.post("/api/pick-file", (req: Request, res) => {
    if (!isAllowedOrigin(req.headers.origin)) return res.status(403).json({ error: "forbidden origin" });
    const directory = isRecord(req.body) && req.body.directory === true;
    const { cmd, args } = pickFileCommand(process.platform, directory);
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.on("error", (e) => {
      if (!res.headersSent) res.status(500).json({ error: `file dialog unavailable: ${e.message}` });
    });
    child.on("close", () => {
      if (!res.headersSent) res.json({ paths: parsePickerOutput(Buffer.concat(out).toString()) });
    });
  });
}
