// GET /api/files/page/<cwd>/<path> — an HTML file rendered in the Files pane's Preview (#2269).
//
// Two rules, each borrowed rather than invented, because this route serves file bytes:
//   - WHERE: the base is authorised exactly as the raw route's is (the workspace root or a live
//     session's directory), and the path is contained in it with the same gate. So this reaches
//     nothing /api/files/raw does not — it only changes how an HTML file is served.
//   - HOW: an HTML file goes out under the presentHtml preview CSP (`sendHtmlDocument`), which
//     gives the page an opaque origin and no network. Anything else under the page's directory —
//     the image it links relatively — is handed to the raw route, which already serves it with the
//     right type, the sandbox and Range support; one implementation of that, not two.
import path from "node:path";
import os from "node:os";
import type { Express, Request, Response } from "express";
import { FILES_PAGE_ROUTE, HTML_FILE_NAME, filesPageRequest } from "../../../common/filesPage.js";
import { authorizedServingBase, resolveContained } from "../../files/pathContainment.js";
import { sendHtmlDocument } from "../plugins/html.js";

/** The raw route's URL for the same file, for a request that is not the page itself. */
const rawUrl = (cwd: string, pathRel: string): string => `/api/files/raw?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(pathRel)}`;

/** The page itself, once its base is authorised: contained, then sent under the preview CSP. */
function sendContainedPage(res: Response, base: string, pathRel: string): void {
  const abs = resolveContained(base, pathRel, os.homedir());
  if (abs) sendHtmlDocument(res, abs, () => resolveContained(base, pathRel, os.homedir()));
  else res.status(403).json({ error: "path escapes the serving root" });
}

export function mountFilesPageRoute(app: Express, deps: { workspace: string; sessionCwds: () => Iterable<string> }): void {
  const root = path.resolve(deps.workspace);
  app.get(new RegExp(`^${FILES_PAGE_ROUTE}/(.+)`), (req: Request, res: Response) => {
    // The still-encoded tail: `req.params` is decoded, and decoding before the split is the smuggle.
    // `req.path` is undecoded too, carries no query, and is relative to wherever the app is mounted.
    const tail = req.path.slice(FILES_PAGE_ROUTE.length + 1);
    const request = filesPageRequest(tail);
    const base = request ? authorizedServingBase(request.cwd, root, deps.sessionCwds()) : null;
    if (!request) {
      res.status(404).json({ error: "not found" });
    } else if (base === null) {
      res.status(403).json({ error: "cwd is not an active session directory" });
    } else if (!HTML_FILE_NAME.test(request.pathRel)) {
      res.redirect(302, rawUrl(request.cwd, request.pathRel));
    } else {
      sendContainedPage(res, base, request.pathRel);
    }
  });
}
