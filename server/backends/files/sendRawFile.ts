// The bytes of one file the caller has already authorised: its type, the sandbox, the name a save
// gets, and Range. Shared by the raw route and the one-file grants, so a granted file is served
// exactly as the raw route would serve it. `rel` is what the save name is taken from.
import fs from "node:fs";
import type { Request, Response } from "express";
import { statFileOr404 } from "./statFileOr404.js";
import { parseByteRange } from "./byte-range.js";
// Named export: 3.x is ESM and ships its own types. Express uses this same package for
// `res.attachment()`, so the RFC 6266 escaping is the one the rest of the stack already trusts.
import { create as contentDisposition } from "content-disposition";
import { rawServingPlan } from "./rawServingPlan.js";
import { servedFileName } from "./servedFileName.js";
import { streamFileToResponse } from "./streamFile.js";
import { openVerifiedForRead } from "../../files/verifiedRead.js";
import type { Recheck } from "../../files/verifiedWrite.js";

/** The served file: its size, and the descriptor to read when one was opened. */
type ServedFile = { abs: string; rel: string; size: number; fd?: number };

/** `recheck` is the containment check the caller passed `abs` through, asked again once the file is
 *  open (#3306); without one (a granted file has no root to stay inside) the file is read by name. */
export function sendRawFile(req: Request, res: Response, abs: string, rel: string, recheck?: Recheck): void {
  const stat = statFileOr404(res, abs);
  if (!stat) return;
  if (!recheck) {
    sendBytes(req, res, { abs, rel, size: stat.size });
    return;
  }
  const fd = openVerifiedOr4xx(res, abs, recheck);
  if (fd === null) return;
  const handedToStream = { done: false };
  try {
    handedToStream.done = sendBytes(req, res, { abs, rel, size: fs.fstatSync(fd).size, fd });
  } finally {
    if (!handedToStream.done) fs.closeSync(fd);
  }
}

function openVerifiedOr4xx(res: Response, abs: string, recheck: Recheck): number | null {
  const fd = openOrMissing(abs, recheck);
  if (fd === "missing") res.status(404).json({ error: "not found" });
  else if (fd === null) res.status(403).json({ error: "path escapes the serving root" });
  return fd === "missing" ? null : fd;
}

const openOrMissing = (abs: string, recheck: Recheck): number | null | "missing" => {
  try {
    return openVerifiedForRead(abs, recheck);
  } catch {
    return "missing";
  }
};

/** The response for `file`; true once a stream has taken over its descriptor. */
function sendBytes(req: Request, res: Response, file: ServedFile): boolean {
  const { abs, rel, size, fd } = file;
  const plan = rawServingPlan(abs, size);
  if (plan.tooLarge) {
    res.status(413).json({ error: `file too large (${size} bytes)` });
    return false;
  }

  res.setHeader("Content-Type", plan.contentType);
  res.setHeader("X-Content-Type-Options", "nosniff");
  // An SVG/HTML with embedded JS must not escape into the app origin; PDFs and audio/video are
  // the exceptions (a browser cannot show them sandboxed). See rawServingPlan.
  if (plan.sandbox) res.setHeader("Content-Security-Policy", "sandbox");
  res.setHeader("Accept-Ranges", "bytes");
  // The name a save from the browser gets. Without it the browser falls back to the URL's last
  // segment plus an extension guessed from the type, so every file saved as `raw.<ext>` (#2040).
  // BEFORE the Range branch so the 206 carries it too — a media save takes the partial response.
  // `inline`, not `attachment`: this route is how the app RENDERS images, PDFs and text, and
  // `attachment` would turn every one of those into a download.
  const advertised = servedFileName(rel);
  if (advertised !== null) res.setHeader("Content-Disposition", contentDisposition(advertised, { type: "inline" }));

  // Range support (required for <video>/<audio> seeking in Safari).
  const rangeHeader = req.headers.range;
  if (rangeHeader) {
    const range = parseByteRange(rangeHeader, size);
    // A well-formed but unsatisfiable range earns a 416; a malformed / unsupported one is
    // ignored (fall through to the full 200), per RFC 7233 — a 416 breaks a media seek.
    if (range.kind === "unsatisfiable") {
      res.status(416).setHeader("Content-Range", `bytes */${size}`);
      res.json({ error: "range not satisfiable" });
      return false;
    }
    if (range.kind === "range") {
      res.status(206);
      res.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
      res.setHeader("Content-Length", String(range.end - range.start + 1));
      streamFileToResponse(abs, res, { start: range.start, end: range.end }, fd);
      return true;
    }
    // range.kind === "ignore" → serve the whole file below.
  }

  res.setHeader("Content-Length", String(size));
  streamFileToResponse(abs, res, undefined, fd);
  return true;
}
