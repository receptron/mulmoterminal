// Host wiring for @mulmoclaude/shapescript-plugin (presentShapeScript). The tool-call
// path — save a new `.shape` under artifacts/shapes, or present one that already
// exists — runs through the generic package loader (plugins.json `packages` →
// /api/plugin/presentShapeScript with the FileOps context from
// infra/plugins-registry.ts). This module adds the one host-specific piece:
//
//   The View's source-editor DISPATCH. `useRuntime().dispatch({kind})` POSTs to the
//   SAME /api/plugin/presentShapeScript route with `kind: "loadShape"|"saveShape"`,
//   which the package's `execute` does not handle. Intercept those before the generic
//   catch-all and route them to executeShapeScriptDispatch (read/write via the
//   artifacts FileOps, plus byPath for a `.shape` outside artifacts/shapes); a
//   tool-call (no `kind`) falls through. After a save we publish a file-change so any
//   open View live-refreshes.
//
// Same shape as backends/html.ts — deliberately, since the two plugins share this
// contract; read that file's comments for the reasoning behind each step.
import type { Express, Request, Response, NextFunction } from "express";
import { executeShapeScriptDispatch, isShapeScriptDispatchArgs } from "@mulmoclaude/shapescript-plugin";
import { artifactsFileOps } from "./artifacts.js";
import { shapeScriptByPath } from "./openPath.js";
import { publishFileChange } from "./fileChange.js";
import { isRecord } from "../../common/isRecord.js";

/** Intercept the View's dispatch (loadShape/saveShape) on
 *  /api/plugin/presentShapeScript, before the generic plugin catch-all (which handles
 *  the tool-call). MUST be registered BEFORE mountAllRoutes. */
export function mountShapeScriptDispatchRoute(app: Express): void {
  app.post("/api/plugin/presentShapeScript", async (req: Request, res: Response, next: NextFunction) => {
    const args: Record<string, unknown> = isRecord(req.body) ? req.body : {};
    // A tool-call (no `kind`) is left to the package execute via the catch-all.
    if (args.kind !== "loadShape" && args.kind !== "saveShape") return next();
    // The package's OWN guard rather than an assertion here: `saveShape` with a
    // non-string `script` would otherwise reach `files.*.write` and blank the model.
    if (!isShapeScriptDispatchArgs(args)) {
      res.status(400).json({ error: "invalid presentShapeScript dispatch args" });
      return;
    }
    try {
      // `byPath` is what lets the source editor load/save a model OUTSIDE
      // artifacts/shapes — presentShapeScript's `path` form takes any .shape on disk.
      // Without it the package degrades to its artifacts-only behaviour.
      const result = await executeShapeScriptDispatch({ files: { artifacts: artifactsFileOps, byPath: shapeScriptByPath } }, args);
      if (args.kind === "saveShape" && typeof args.path === "string") {
        await publishFileChange(args.path);
      }
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });
}
