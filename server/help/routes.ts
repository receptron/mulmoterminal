// GET /api/help/sources — where the running install keeps its docs and source, for the bundled
// help skill. A read with no side effects; the skill curls it on the port every PTY is handed.
import type { Express } from "express";
import path from "node:path";
import { getUpdateStatus } from "../config/update-status.js";
import { helpSources } from "./help-sources.js";
import type { UpdateStatus } from "../../common/updateStatus.js";

// server/help → the package root, the same resolution update-status.ts makes for package.json.
const PACKAGE_DIR = path.join(import.meta.dirname, "..", "..");

export interface HelpRoutesDeps {
  packageDir: string;
  status: () => Pick<UpdateStatus, "version" | "install">;
}

const defaultDeps: HelpRoutesDeps = { packageDir: PACKAGE_DIR, status: getUpdateStatus };

export function mountHelpRoutes(app: Express, deps: HelpRoutesDeps = defaultDeps): void {
  app.get("/api/help/sources", (_req, res) => {
    const { version, install } = deps.status();
    res.json(helpSources(deps.packageDir, version, install));
  });
}
