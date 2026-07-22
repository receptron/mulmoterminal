// Raw workspace-file serving — GET /api/files/raw?path=<workspace-relative>.
//
// Consumers: the collection plugin's image/file fields (the binding's imageSrc maps
// here) and its custom views, whose LLM-authored HTML builds
// `<img src="<origin>/api/files/raw?path=...">` for poster/thumbnail fields. Mirrors
// MulmoClaude's server/api/routes/files.ts GET /files/raw (the path the gallery view
// hardcodes), trimmed to what MulmoTerminal needs.
//
// Security (this serves arbitrary workspace files):
//   - Path containment: the resolved absolute path must stay within the workspace
//     root — reject traversal / absolute escapes (the only real attack surface on a
//     loopback server).
//   - `Content-Security-Policy: sandbox` + `X-Content-Type-Options: nosniff` so an
//     `.svg`/`.html` with embedded JS can't run in the app origin via direct
//     navigation or <iframe>; PDFs skip the sandbox CSP (WebKit refuses to render
//     sandbox-opaque PDFs) but keep nosniff. Matches MulmoClaude's RAW_SECURITY_HEADERS.
import path from "node:path";
import { createReadStream } from "node:fs";
import type { Express, Request, Response } from "express";
import { statFileOr404 } from "./statFileOr404.js";
import { parseByteRange } from "./byte-range.js";

const MAX_RAW_BYTES = 25 * 1024 * 1024; // images / text / generic
const MAX_MEDIA_BYTES = 500 * 1024 * 1024; // audio / video (streamed via Range)

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".pdf": "application/pdf",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
};

function isMedia(mime: string): boolean {
  return mime.startsWith("audio/") || mime.startsWith("video/");
}

export function mountFilesRoutes(app: Express, deps: { workspace: string }): void {
  const root = path.resolve(deps.workspace);

  app.get("/api/files/raw", (req: Request, res: Response) => {
    const rel = typeof req.query.path === "string" ? req.query.path : "";
    if (!rel) {
      res.status(400).json({ error: "`path` query is required" });
      return;
    }
    // Containment: resolve against the workspace root and reject anything that
    // escapes it (absolute input, `..`, symlink-free check on the resolved string).
    const abs = path.resolve(root, rel);
    if (abs !== root && !abs.startsWith(root + path.sep)) {
      res.status(403).json({ error: "path escapes the workspace root" });
      return;
    }
    const stat = statFileOr404(res, abs);
    if (!stat) return;

    const ext = path.extname(abs).toLowerCase();
    const mime = MIME_BY_EXT[ext] ?? "application/octet-stream";
    const cap = isMedia(mime) ? MAX_MEDIA_BYTES : MAX_RAW_BYTES;
    if (stat.size > cap) {
      res.status(413).json({ error: `file too large (${stat.size} bytes, limit ${cap})` });
      return;
    }

    res.setHeader("Content-Type", mime);
    res.setHeader("X-Content-Type-Options", "nosniff");
    // Sandbox the response so an SVG/HTML with embedded JS can't escape into the app
    // origin. PDFs skip it (WebKit won't render sandbox-opaque PDFs).
    if (mime !== "application/pdf") res.setHeader("Content-Security-Policy", "sandbox");
    res.setHeader("Accept-Ranges", "bytes");

    // Range support (required for <video>/<audio> seeking in Safari).
    const rangeHeader = req.headers.range;
    if (rangeHeader) {
      const range = parseByteRange(rangeHeader, stat.size);
      if (!range) {
        res.status(416).setHeader("Content-Range", `bytes */${stat.size}`);
        res.json({ error: "invalid range" });
        return;
      }
      res.status(206);
      res.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${stat.size}`);
      res.setHeader("Content-Length", String(range.end - range.start + 1));
      createReadStream(abs, { start: range.start, end: range.end }).pipe(res);
      return;
    }

    res.setHeader("Content-Length", String(stat.size));
    createReadStream(abs).pipe(res);
  });
}
