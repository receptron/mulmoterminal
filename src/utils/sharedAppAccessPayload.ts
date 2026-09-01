// The access response, narrowed off the wire.
//
// STRICT, and deliberately unlike `asPayload` beside it. The preview fills a gap with a floor,
// because half a preview is still worth drawing; half a permission table is not — a cell that says
// "Nothing" because a field failed to parse is indistinguishable from one that says "Nothing"
// because the rules refuse it, and the author reads both as reassurance. So anything unrecognised
// makes the WHOLE answer null, and the panel says it could not work the summary out.
import type { CollectionAccess, ReadAccess, SharedAppAccess, SubjectAccess } from "../../common/sharedAppAccess";
import type { PublicFace } from "../../common/sharedAppPublicFace";
import { isRecord } from "../../common/isRecord";

/** The three closed vocabularies, as predicates rather than a shared `includes` helper: the helper
 *  needed an assertion to hand the value back at its narrowed type, and an assertion is the one
 *  thing this file is here to avoid. */
const isFace = (value: unknown): value is PublicFace => value === "open" || value === "declared" || value === "none";
const isRead = (value: unknown): value is ReadAccess => value === "none" || value === "own" || value === "all";
const isStage = (value: unknown): value is CollectionAccess["authStage"] => value === "none" || value === "anonymous" || value === "verifiedEmail";

const count = (value: unknown): number | null => (typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null);

function asSubjectAccess(value: unknown): SubjectAccess | null {
  if (!isRecord(value)) return null;
  if (!isRead(value.read)) return null;
  if (typeof value.create !== "boolean" || typeof value.editOwn !== "boolean" || typeof value.editAll !== "boolean") return null;
  return { read: value.read, create: value.create, editOwn: value.editOwn, editAll: value.editAll };
}

function asCollectionAccess(value: unknown): CollectionAccess | null {
  if (!isRecord(value) || typeof value.cid !== "string" || value.cid === "" || typeof value.takesSubmissions !== "boolean") return null;
  if (!isStage(value.authStage) || !isRecord(value.census)) return null;
  const writers = count(value.census.writers);
  const readers = count(value.census.readers);
  const participants = count(value.census.participants);
  if (writers === null || readers === null || participants === null) return null;
  if (!Array.isArray(value.caveats) || value.caveats.some((entry) => typeof entry !== "string")) return null;
  if (!isRecord(value.access)) return null;

  // Named one by one rather than accumulated in a loop, so the four rows the table draws are the
  // four this file requires — a loop over `ACCESS_SUBJECTS` needs an assertion to hand the partial
  // map back as a complete one, and that assertion is exactly the check being skipped.
  const visitor = asSubjectAccess(value.access.visitor);
  const stranger = asSubjectAccess(value.access.stranger);
  const participant = asSubjectAccess(value.access.participant);
  const writer = asSubjectAccess(value.access.writer);
  // A MISSING SUBJECT is the case this refusal is for. Four rows are the answer; three of them plus
  // a silently absent one is a table whose emptiest row is the one nobody was told about.
  if (visitor === null || stranger === null || participant === null || writer === null) return null;
  return {
    cid: value.cid,
    takesSubmissions: value.takesSubmissions,
    authStage: value.authStage,
    census: { writers, readers, participants },
    caveats: value.caveats.filter((entry): entry is string => typeof entry === "string"),
    access: { visitor, stranger, participant, writer },
  };
}

export function asAccess(value: unknown): SharedAppAccess | null {
  if (!isRecord(value)) return null;
  if (!isFace(value.publicFace) || !Array.isArray(value.collections)) return null;
  const collections: CollectionAccess[] = [];
  for (const entry of value.collections) {
    const parsed = asCollectionAccess(entry);
    if (parsed === null) return null;
    collections.push(parsed);
  }
  return { publicFace: value.publicFace, collections };
}
