// A picture, PDF, video or sound the pane opened by a path inside the project, whose symlink leads
// outside it (#3301). The project-scoped routes refuse it, and keep refusing it; the pane shows it
// through the one-file URL a click on an outside file already gets (common/fileGrant.ts), which
// serves that file and nothing beside it.
import { grantKind } from "../../common/fileGrant";
import { symlinkEscapePath } from "../../common/symlinkEscape";

const HTTP_FORBIDDEN = 403;

/** The absolute path to ask a one-file grant for, or null when the refused read is not one: refused
 *  because of a symlink, and a kind the granted route serves as itself. A page is left out — the
 *  pane previews one through the project's own page route, which a grant does not stand in for. */
export function grantPathFor(status: number, body: unknown, pathRel: string): string | null {
  const name = pathRel.split("/").pop() ?? pathRel;
  if (status !== HTTP_FORBIDDEN || grantKind(name) !== "raw") return null;
  return symlinkEscapePath(body);
}
