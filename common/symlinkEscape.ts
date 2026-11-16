// A file route's 403 for a path that is inside the project by its spelling but whose real location
// is not, because a symbolic link on the way leads out (#3301). The server says which of the two
// refusals it was, since only it can see where a link goes; the pane decides from this field and
// never from the error sentence.
import { isRecord } from "./isRecord.js";

export const SYMLINK_ESCAPE_FIELD = "escape";
export const SYMLINK_ESCAPE = "symlink";

export const isSymlinkEscape = (body: unknown): boolean => isRecord(body) && body[SYMLINK_ESCAPE_FIELD] === SYMLINK_ESCAPE;
