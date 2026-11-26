// The tree's file operations on the wire (#2578), each answered as a value: the path the entry now
// has, or the server's own words for why not.
import { jsonBody } from "../jsonBody";
import { fetchWithTimeout } from "../utils/fetchWithTimeout";
import { browseUrl } from "./filesPaneApi";
import { pathOnHost } from "./remoteCell";

export type TreeOpRoute = "create" | "rename" | "trash";
export type TreeOpOutcome = { ok: true; path: string | null } | { ok: false; message: string };

export async function treeOp(host: string | null, route: TreeOpRoute, query: string, body: Record<string, unknown>): Promise<TreeOpOutcome> {
  try {
    const res = await fetchWithTimeout(browseUrl(host, route, query), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await jsonBody(res);
    if (!res.ok) return { ok: false, message: typeof data.error === "string" ? data.error : `HTTP ${res.status}` };
    return { ok: true, path: typeof data.path === "string" ? data.path : null };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

/** Whether the pane's machine (`host`, or this one) has a Trash its server knows. Where it does not,
 *  the tree offers no delete. */
export async function trashAvailable(host: string | null): Promise<boolean> {
  try {
    const data = await jsonBody(await fetchWithTimeout(pathOnHost(host, "/api/files/browse/trash")));
    return data.available === true;
  } catch {
    return false;
  }
}
