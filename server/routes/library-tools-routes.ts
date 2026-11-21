// The Library's tools kind (#3332): which instruction files Claude Code loads in a directory, and one
// of them read. Read only. A directory is asked for by name, and only one the Library knows a
// conversation ran in; a file only when it is one that directory's listing names.
import os from "node:os";
import type { Express } from "express";
import type { LibraryCaller } from "../backends/library/library-service.js";
import { readInstructionText, readInstructions } from "../backends/library/instruction-files-read.js";
import { readSettings } from "../backends/library/settings-layers-read.js";
import { agentHome } from "../agents/agent-homes.js";
import { answer } from "./library-routes.js";

export interface ToolsRouteDeps {
  /** Claude Code's config folder (`~/.claude`, or `CLAUDE_CONFIG_DIR`). */
  configDir?: string;
  home?: string;
}

/** The directory a request names, when the Library knows a conversation ran there; else null, and the
 *  response is already sent. */
async function knownDirectory(res: Parameters<typeof answer>[0], call: LibraryCaller, cwd: unknown): Promise<string | null> {
  if (typeof cwd !== "string" || cwd === "") {
    res.status(400).json({ error: "expected ?cwd= naming a directory" });
    return null;
  }
  const directories = await answer(res, call, "directories", []);
  if (directories === undefined) return null;
  if (!Array.isArray(directories) || !directories.includes(cwd)) {
    res.status(404).json({ error: "no conversation ran in that directory" });
    return null;
  }
  return cwd;
}

export function mountToolsRoutes(app: Express, call: LibraryCaller, deps: ToolsRouteDeps = {}): void {
  const configDir = (): string => deps.configDir ?? agentHome("claude");
  const home = (): string => deps.home ?? os.homedir();
  // The directories to choose among: every one a conversation ran in, in name order.
  app.get("/api/library/tools/directories", async (_req, res) => {
    const directories = await answer(res, call, "directories", []);
    if (directories === undefined) return;
    const names = Array.isArray(directories) ? directories.filter((cwd): cwd is string => typeof cwd === "string") : [];
    res.json({ directories: names.toSorted((a, b) => a.localeCompare(b)) });
  });
  app.get("/api/library/tools/instructions", async (req, res) => {
    const cwd = await knownDirectory(res, call, req.query.cwd);
    if (cwd === null) return;
    try {
      res.json(await readInstructions(cwd, configDir(), home()));
    } catch {
      res.status(500).json({ error: "the instruction files could not be read" });
    }
  });
  app.get("/api/library/tools/settings", async (req, res) => {
    const cwd = await knownDirectory(res, call, req.query.cwd);
    if (cwd === null) return;
    try {
      res.json(await readSettings(cwd, configDir()));
    } catch {
      res.status(500).json({ error: "the settings files could not be read" });
    }
  });
  app.get("/api/library/tools/instruction", async (req, res) => {
    const cwd = await knownDirectory(res, call, req.query.cwd);
    if (cwd === null) return;
    try {
      const listed = (await readInstructions(cwd, configDir(), home())).files.find((file) => file.path === req.query.path);
      if (listed === undefined) {
        res.status(404).json({ error: "not an instruction file loaded in that directory" });
        return;
      }
      res.json(await readInstructionText(listed.path));
    } catch {
      res.status(500).json({ error: "the instruction file could not be read" });
    }
  });
}
