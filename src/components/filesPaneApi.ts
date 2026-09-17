// What the Files pane asks the SERVER for, with none of the pane in it: every function here takes
// what it needs and hands back a value.
//
// Split out of FilesPane.vue because these were the parts of it that touch no component state and
// were only reachable through a mounted editor — a save that loses the version race, a backup that
// the store refuses, an opener a host does not have. Those are the outcomes that matter most and
// were the hardest to arrange; here each is one call and one assertion.
import { jsonBody } from "../jsonBody";
import { fetchWithTimeout } from "../utils/fetchWithTimeout";

/** The `?cwd=&path=` every `/api/files/browse/*` route takes. `cwd` is omitted when the pane has
 *  no root of its own, which is how the server is told to use its default workspace. */
export function browseQuery(cwd: string | null, pathRel: string): string {
  const params = new URLSearchParams();
  if (cwd) params.set("cwd", cwd);
  params.set("path", pathRel);
  return params.toString();
}

export type WriteOutcome = { status: "saved"; version: string | null } | { status: "conflict"; version: string | null } | { status: "error"; message: string };

/** One conditional write, reported as a value rather than through component state. Leaving has to
 *  keep working while the pane is being torn down, and anything read from a ref AFTER an await may
 *  already be gone by then. */
export async function writeBuffer(query: string, text: string, base: string | null, keepalive = false): Promise<WriteOutcome> {
  try {
    const res = await fetchWithTimeout(`/api/files/browse/write?${query}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, baseVersion: base }),
      keepalive,
    });
    const data = await jsonBody(res);
    const version = typeof data.version === "string" ? data.version : null;
    if (res.status === 409) return { status: "conflict", version };
    if (!res.ok) return { status: "error", message: typeof data.error === "string" ? data.error : `HTTP ${res.status}` };
    return { status: "saved", version };
  } catch (e) {
    return { status: "error", message: e instanceof Error ? e.message : String(e) };
  }
}

/** Hand a copy to the backup store — content that exists nowhere else once the editor is gone. */
export async function bankText(query: string, text: string, keepalive = false): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(`/api/files/browse/backup?${query}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
      keepalive,
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Hand a path to something on this machine that the browser cannot reach — the OS file manager
 *  (#2039) or the default application (#2038). One function for both, because the only thing that
 *  differs is the route and the words: `failure` is what the message NAMES, which is not always
 *  what is sent (revealing says the absolute path, opening says the relative one the user picked).
 *
 *  Returns the message to SHOW, or null when it worked. A host with no opener to call — a bare
 *  Linux box, WSL with interop off — used to look exactly like a successful one, and nothing
 *  appeared (#1447), so the caller is given something to say either way. */
export async function askTheMachine(route: string, pathAbs: string, failure: string): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(route, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: pathAbs }),
    });
    if (res.ok) return null;
    const body = await jsonBody(res);
    return typeof body.error === "string" && body.error.length > 0 ? body.error : `${failure} (HTTP ${res.status})`;
  } catch (e) {
    return `${failure}: ${e instanceof Error ? e.message : String(e)}`;
  }
}
