import type { JsonObject } from "@mulmoclaude/core/remote-host";

// Same safe-token guard ingestAttachments applies before interpolating a
// storage_id into the Storage path (no `/`, no `..`).
export const STORAGE_ID_RE = /^[A-Za-z0-9-]+$/;

// Pull the staged storage_ids out of a command's `{ attachments: [{ storage_id }] }`
// params, skipping anything malformed. Absent / wrong-shaped ⇒ []. Accepts a
// missing params object too: an expired command doc may carry none, and destructuring
// `undefined` would throw a TypeError — breaking onExpire's never-throw contract.
export const stagedStorageIds = (params: JsonObject | null | undefined): string[] => {
  if (!params || typeof params !== "object") return [];
  const { attachments } = params;
  if (!Array.isArray(attachments)) return [];
  return attachments.flatMap((entry) => {
    const rawId = entry && typeof entry === "object" && !Array.isArray(entry) ? entry.storage_id : undefined;
    return typeof rawId === "string" && STORAGE_ID_RE.test(rawId) ? [rawId] : [];
  });
};
