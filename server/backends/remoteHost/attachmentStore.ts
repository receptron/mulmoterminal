// Persist a chat attachment (a photo / PDF the phone staged to Firebase Storage)
// into the workspace at data/attachments/YYYY/MM/<id>.<ext>, so the spawned
// `claude` session can Read it by path.
//
// A lean port of MulmoClaude's server/utils/files/attachment-store.ts — no hooks,
// companions, or loaders (the terminal only needs the bytes on disk at a
// referenceable workspace-relative path). Writes atomically (temp + rename), the
// same pattern the other MulmoTerminal backends use.
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { ATTACHMENTS_DIR, extensionForMime, yearMonthUtc } from "./attachment-path.js";

export interface SavedAttachment {
  relativePath: string;
  mimeType: string;
}

// A saver bound to the workspace root. `now` is injected so a test gets a stable
// partition directory.
export function createSaveAttachment(workspaceRoot: string, now: () => Date = () => new Date()) {
  return async function saveAttachment(base64Data: string, mimeType: string): Promise<SavedAttachment> {
    const partition = yearMonthUtc(now());
    const filename = `${randomUUID().slice(0, 8)}${extensionForMime(mimeType)}`;
    const relativePath = path.posix.join(ATTACHMENTS_DIR, partition, filename);
    const absPath = path.join(workspaceRoot, ATTACHMENTS_DIR, partition, filename);
    await mkdir(path.dirname(absPath), { recursive: true });
    const tmp = `${absPath}.${randomUUID()}.tmp`;
    try {
      await writeFile(tmp, Buffer.from(base64Data, "base64"));
      await rename(tmp, absPath);
    } catch (err) {
      await rm(tmp, { force: true }).catch(() => undefined);
      throw err;
    }
    return { relativePath, mimeType };
  };
}
