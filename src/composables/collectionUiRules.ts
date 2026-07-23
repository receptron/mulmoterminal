// Pure decisions extracted from collectionUi.ts so they can be tested without the
// fetch/DOM host around them. The host keeps the network and configureCollectionUi
// wiring; these functions only shape strings.
import { isObject } from "graphai";

const HTML_PREVIEW_DIR_PREFIX = "artifacts/html/";

// A `file` field holding an `artifacts/html/*.html` path points at an LLM-authored
// page. The raw-file route serves it as octet-stream (no `.html` in its MIME map) so
// the browser downloads it; the dedicated preview route serves it as text/html with
// the sandboxed preview CSP, so it renders in a new tab. Detect that shape and return
// the preview URL; everything else returns null so the caller falls back to raw.
//
// Note the deliberate asymmetry: the `.html` suffix is matched case-insensitively
// (via toLowerCase) but the directory prefix is matched case-sensitively. Preserved
// as the existing behavior — see collectionUiRules.spec.ts.
export function htmlPreviewUrl(value: string): string | null {
  if (!value.toLowerCase().endsWith(".html")) return null;
  if (!value.startsWith(HTML_PREVIEW_DIR_PREFIX)) return null;
  const rest = value.slice(HTML_PREVIEW_DIR_PREFIX.length);
  if (rest.length === 0) return null;
  return `/artifacts/html/${rest.split("/").map(encodeURIComponent).join("/")}`;
}

// The `?offset=…&limit=…&fields=…` suffix (or "") for a remote-view items page. `offset`
// is kept when it is 0 (a valid first-page offset), so the test uses `!= null` rather
// than a truthy check; an empty `fields` array is dropped.
export function remoteViewItemsQuery(req: { offset?: number; limit?: number; fields?: string[] }): string {
  const query = new URLSearchParams();
  if (req.offset != null) query.set("offset", String(req.offset));
  if (req.limit != null) query.set("limit", String(req.limit));
  if (req.fields?.length) query.set("fields", req.fields.join(","));
  const qs = query.toString();
  return qs ? `?${qs}` : "";
}

// The message for a failed DELETE: the server's `{ error }` body when present, else a
// bare `HTTP <status>` (e.g. a delete-refusal reason like "preset collections can't be
// deleted" instead of "HTTP 403").
export function deleteErrorMessage(body: unknown, status: number): string {
  return isObject(body) && typeof body.error === "string" ? body.error : `HTTP ${status}`;
}
