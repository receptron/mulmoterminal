import type { Response } from "express";
import { openVerifiedForRead } from "../../files/verifiedRead.js";
import type { Recheck } from "../../files/verifiedWrite.js";

/** A descriptor on `abs` once it is the file `recheck` names (#3306), or null after answering: 404
 *  when it cannot be opened, 403 when what opened is not the contained file. The caller closes it. */
export function openVerifiedOr4xx(res: Response, abs: string, recheck: Recheck): number | null {
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
