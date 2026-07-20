import fs from "node:fs";
import type { Response } from "express";

// Stat `abs` for the raw file-serving routes, sending a 404 for a missing entry
// or a non-file. Returns the stat, or null after the response is sent — so the
// caller does `if (!stat) return;`.
export function statFileOr404(res: Response, abs: string): fs.Stats | null {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(abs);
  } catch {
    res.status(404).json({ error: "not found" });
    return null;
  }
  if (!stat.isFile()) {
    res.status(404).json({ error: "not a file" });
    return null;
  }
  return stat;
}
