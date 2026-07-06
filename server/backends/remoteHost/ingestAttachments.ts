// Attachment ingest for remote chat (the phone → this host).
//
// The phone can't carry full-res attachment bytes over the Firestore command
// channel (a command doc caps at ~1 MiB), so it uploads each file to Firebase
// Storage at `users/{uid}/uploads/{storage_id}` and sends only the `storage_id`
// on startChat. This module — signed in as the same user — pulls each staged
// object, persists it into the workspace attachment store (data/attachments/…),
// deletes the Storage object (staging only), and returns a path-only Attachment
// per file for startChat to reference in the seeded prompt.
//
// Ported from MulmoClaude's server/remoteHost/handlers/ingestAttachments.ts.
// Factory (createIngestAttachments) keeps the flow unit-testable with the Storage
// + attachment-store deps stubbed.
import { deleteObject, getBytes, getMetadata, ref } from "firebase/storage";
import type { FirebaseStorage } from "firebase/storage";

// A workspace-relative file path handed to the spawned chat.
export interface Attachment {
  path: string;
  mimeType: string;
}

// `storage_id` is a bare UUID minted by the remote. Accept only a safe token so
// it can never reshape the Storage path (no `/`, no `..`) before it is
// interpolated into `users/{uid}/uploads/{storage_id}`. Simple char class — no
// backtracking risk.
const STORAGE_ID_RE = /^[A-Za-z0-9-]+$/;

// Belt-and-suspenders cap matching the remote's ~100 MiB upload rule, so a
// mis-sized object can't balloon host memory on download.
const MAX_DOWNLOAD_BYTES = 110 * 1024 * 1024;

export interface IngestDeps {
  uid: () => string | null;
  fetchObject: (storagePath: string) => Promise<{ base64: string; contentType: string }>;
  saveAttachment: (base64: string, mimeType: string) => Promise<{ relativePath: string; mimeType: string }>;
  deleteObject: (storagePath: string) => Promise<void>;
}

// storage_ids -> path-only Attachments, in order. Two phases:
//
//  1. Fetch + save EVERY attachment into the workspace. Rejects the whole batch
//     on the first hard failure (host not signed in, malformed id, or a
//     download/save that fails) — WITHOUT deleting any staged object. So a remote
//     retry with the same storage_ids still finds every upload: earlier files
//     aren't reaped just because a later one failed.
//  2. Only once all bytes are safely in the workspace, best-effort delete the
//     staged objects. A failed delete only logs and leaves an orphan for a
//     Storage TTL sweep — it never drops an already-ingested attachment.
export const createIngestAttachments =
  (deps: IngestDeps) =>
  async (storageIds: string[]): Promise<Attachment[]> => {
    if (storageIds.length === 0) return [];
    const uid = deps.uid();
    if (!uid) throw new Error("remote host is not signed in");

    // Phase 1 — fetch + save all. A failure here throws before any delete.
    const staged: Array<{ storagePath: string; attachment: Attachment }> = [];
    for (const storageId of storageIds) {
      if (!STORAGE_ID_RE.test(storageId)) throw new Error(`invalid storage_id: ${storageId}`);
      const storagePath = `users/${uid}/uploads/${storageId}`;
      const { base64, contentType } = await deps.fetchObject(storagePath);
      const saved = await deps.saveAttachment(base64, contentType);
      staged.push({ storagePath, attachment: { path: saved.relativePath, mimeType: saved.mimeType } });
    }

    // Phase 2 — every file is now in the workspace; best-effort clean up staging.
    for (const { storagePath } of staged) {
      try {
        await deps.deleteObject(storagePath);
      } catch (error) {
        console.warn("[remote-host] failed to delete staged upload after ingest; leaving orphan for TTL sweep", storagePath, String(error));
      }
    }
    return staged.map((entry) => entry.attachment);
  };

// Wire the real Firebase-Storage deps to createIngestAttachments. `getBytes`
// (not the browser-only `getBlob`) returns an ArrayBuffer that works on Node.
export interface StorageIngestDeps {
  storage: FirebaseStorage;
  uid: () => string | null;
  saveAttachment: (base64: string, mimeType: string) => Promise<{ relativePath: string; mimeType: string }>;
}

export function buildIngestAttachments(deps: StorageIngestDeps) {
  const fetchObject = async (storagePath: string) => {
    const objectRef = ref(deps.storage, storagePath);
    const [bytes, metadata] = await Promise.all([getBytes(objectRef, MAX_DOWNLOAD_BYTES), getMetadata(objectRef)]);
    return { base64: Buffer.from(bytes).toString("base64"), contentType: metadata.contentType ?? "application/octet-stream" };
  };
  return createIngestAttachments({
    uid: deps.uid,
    fetchObject,
    saveAttachment: deps.saveAttachment,
    deleteObject: (storagePath) => deleteObject(ref(deps.storage, storagePath)),
  });
}
