import type { Express } from "express";
import { requestOriginAllowed } from "./same-origin-guard.js";
import { GRID_LAYOUT_MAX_BYTES, readGridLayout, writeGridLayout } from "../config/grid-layout.js";
import { isRecord } from "../../common/isRecord.js";

export interface GridLayoutRouteDeps {
  file: string;
  isAllowedOrigin: (origin: string | undefined, remoteAddress: string | undefined) => boolean;
  /** Sessions a terminal is showing right now — another tab's cells, which must not be offered twice. */
  attachedSessionIds: () => string[];
}

// The grid's layout, mirrored by every grid that changes it and read back by one that loaded empty
// (#3427). Last writer wins: two grids open at once overwrite each other, and the copy only has to
// hold whichever one the user was last using.
export function mountGridLayoutRoutes(app: Express, deps: GridLayoutRouteDeps): void {
  app.get("/api/grid-layout", (req, res) => {
    if (!requestOriginAllowed(req, deps.isAllowedOrigin)) return res.status(403).json({ error: "forbidden origin" });
    return res.json({ layout: readGridLayout(deps.file), attached: deps.attachedSessionIds() });
  });

  // POST rather than PUT so a closing page can send its last change with `navigator.sendBeacon`.
  app.post("/api/grid-layout", (req, res) => {
    if (!requestOriginAllowed(req, deps.isAllowedOrigin)) return res.status(403).json({ error: "forbidden origin" });
    const layout: unknown = isRecord(req.body) ? req.body.layout : undefined;
    if (!isRecord(layout)) return res.status(400).json({ error: "layout must be an object" });
    const serialized = JSON.stringify(layout);
    if (Buffer.byteLength(serialized) > GRID_LAYOUT_MAX_BYTES) return res.status(413).json({ error: "layout too large" });
    if (!writeGridLayout(deps.file, serialized)) return res.status(500).json({ error: "could not write the layout" });
    return res.json({ ok: true });
  });
}
