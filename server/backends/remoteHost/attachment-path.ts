// Pure path/naming rules for the workspace attachment store: the extension a MIME maps to, and
// the UTC YYYY/MM partition an upload lands in. Split out of attachmentStore's file I/O so both
// can be tested without touching disk — a mis-cased extension or an off-by-one month partition is
// invisible once the bytes are already written.

export const ATTACHMENTS_DIR = "data/attachments";

// MIME → extension. Narrow on purpose (covers phone photos + PDFs + a few text types); anything
// unmapped falls back to `.bin` so we never guess. Case-insensitive so "IMAGE/PNG" maps the same
// as "image/png".
const MIME_EXT: Readonly<Record<string, string>> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/heic": ".heic", // iOS default capture format
  "image/heif": ".heif",
  "image/tiff": ".tif",
  "application/pdf": ".pdf",
  "text/plain": ".txt",
  "text/markdown": ".md",
  "text/csv": ".csv",
};

export const extensionForMime = (mimeType: string): string => MIME_EXT[mimeType.toLowerCase()] ?? ".bin";

// UTC YYYY/MM partition so a workspace with many uploads stays browsable. getUTCMonth is
// 0-indexed, hence +1; zero-padded to two digits. UTC (not local) so the partition a file lands
// in doesn't drift with the server's timezone.
export const yearMonthUtc = (when: Date): string => `${when.getUTCFullYear()}/${String(when.getUTCMonth() + 1).padStart(2, "0")}`;
