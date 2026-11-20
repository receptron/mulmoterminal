// The files a Library conversation changed (#3330): the list, and one version of one file. Read only.
//
// Neither route reads a path the request names. The file is picked by its tracking path out of the
// transcript's own records, and a kept copy is read from that session's file-history directory under
// the name the transcript gave it — so the request can only ever reach what the conversation tracked.
import path from "node:path";
import type { Express, Request, Response } from "express";
import { NOW_VERSION } from "../../common/libraryFiles.js";
import { agentHome } from "../agents/agent-homes.js";
import { trackedFileOf, type FileHistoryEntry } from "../backends/library/file-history.js";
import { readBoundedText, readFileHistory, readKeptCopy } from "../backends/library/file-history-read.js";
import type { LibraryCaller, LibraryTranscript } from "../backends/library/library-service.js";
import { isRecord } from "../../common/isRecord.js";
import { answer, isMarkableId } from "./library-routes.js";

/** Beside the transcripts the index reads: `<claude home>/file-history/<session>/`. */
export const claudeFileHistoryRoot = (): string => path.join(agentHome("claude"), "file-history");

const isTranscript = (value: unknown): value is LibraryTranscript =>
  isRecord(value) && typeof value.path === "string" && (value.cwd === null || typeof value.cwd === "string");

const cwdOf = (req: Request): string => (typeof req.query.cwd === "string" ? req.query.cwd : "");

/** The conversation's session id and tracked files, or undefined once the response has been sent. */
async function trackedFiles(req: Request, res: Response, call: LibraryCaller): Promise<{ id: string; files: FileHistoryEntry[] } | undefined> {
  const id = typeof req.params.id === "string" ? req.params.id : "";
  if (!isMarkableId(id)) {
    res.status(400).json({ error: "not a conversation id" });
    return undefined;
  }
  const transcript = await answer(res, call, "transcript", [id, cwdOf(req)]);
  if (transcript === undefined) return undefined;
  if (!isTranscript(transcript)) {
    res.status(404).json({ error: "conversation not found" });
    return undefined;
  }
  try {
    return { id, files: await readFileHistory(transcript.path, transcript.cwd) };
  } catch {
    res.status(500).json({ error: "the conversation's file history could not be read" }); // the error names the file
    return undefined;
  }
}

/** `version`: a kept version's number, or `now`. */
const versionOf = (value: unknown): number | typeof NOW_VERSION | null => {
  if (value === NOW_VERSION) return NOW_VERSION;
  return typeof value === "string" && /^[1-9]\d{0,5}$/.test(value) ? Number(value) : null;
};

export function mountFileRoutes(app: Express, call: LibraryCaller, fileHistoryRoot: string): void {
  app.get("/api/library/conversations/:id/files", async (req, res) => {
    const tracked = await trackedFiles(req, res, call);
    if (tracked !== undefined) res.json({ files: tracked.files.map(trackedFileOf) });
  });
  app.get("/api/library/conversations/:id/file", async (req, res) => {
    const version = versionOf(req.query.version);
    if (version === null || typeof req.query.file !== "string") {
      res.status(400).json({ error: "file and version (a number, or now) are required" });
      return;
    }
    const tracked = await trackedFiles(req, res, call);
    if (tracked === undefined) return;
    const entry = tracked.files.find((file) => file.trackingPath === req.query.file);
    const backup = version === NOW_VERSION ? null : entry?.backups.find((kept) => kept.version === version);
    if (entry === undefined || backup === undefined) {
      res.status(404).json({ error: "this conversation did not keep that file or version" });
      return;
    }
    if (backup !== null) res.json(await readKeptCopy(fileHistoryRoot, tracked.id, backup.backupFileName));
    else res.json(entry.path === null ? { text: null, reason: "unreadable" } : await readBoundedText(entry.path));
  });
}
