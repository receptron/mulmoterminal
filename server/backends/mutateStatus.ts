// HTTP status for a failed remote-view mutate. The phone and the desktop preview branch on
// it, so it is the machine-readable half of the answer (the sentence being the other half —
// mutateRemoteViewFailureMessage).
//
// The distinctions are the point, and they were previously described wrongly: the doc comment
// said "404 for a missing view/record, 403 for a policy refusal, 400 otherwise" and never
// mentioned 405 at all. A `read-only-collection` demoted to 400 tells the client the request
// was malformed, when in fact no request of that shape can ever succeed against this
// collection — the caller should stop retrying, not fix its payload.

const NOT_FOUND = 404;
const METHOD_NOT_ALLOWED = 405;
const FORBIDDEN = 403;
const BAD_REQUEST = 400;

// Whatever the collection cannot do at all, regardless of the request.
const METHOD_NOT_ALLOWED_KINDS = new Set(["read-only-collection"]);
// The target does not exist.
const NOT_FOUND_KINDS = new Set(["view-not-found", "item-not-found"]);
// The target exists and the request is well-formed; policy refuses it.
const FORBIDDEN_KINDS = new Set(["not-writable", "delete-not-allowed", "field-not-editable", "path-escape"]);

export function mutateStatus(kind: string): number {
  if (NOT_FOUND_KINDS.has(kind)) return NOT_FOUND;
  if (METHOD_NOT_ALLOWED_KINDS.has(kind)) return METHOD_NOT_ALLOWED;
  if (FORBIDDEN_KINDS.has(kind)) return FORBIDDEN;
  return BAD_REQUEST;
}

// "too-large" on a mutate is NOT a failure: the record WAS written, only its response
// (the enriched, thumbnail-inlined item) exceeded the command-channel byte budget. Callers
// must report it as an applied write so the client re-fetches — a 4xx here reads as "edit
// failed" and strands stale data in the UI (#747). A type guard so both the desktop preview
// HTTP handler and the phone channel narrow the result and branch on it in one place.
export function mutateWriteApplied<T extends { kind: string }>(result: T): result is Extract<T, { kind: "too-large" }> {
  return result.kind === "too-large";
}
