// Host tool: `manageShapeScript` — the user's ShapeScript models in the public
// gallery on mulmoserver (server.mulmocast.com/shapes): publish, update, delete,
// get, getList.
//
// Everything a model sees lives in `@mulmoclaude/shapescript-plugin`: the schema,
// the description, the document a post is and its pinned key set, the keyword
// rule. That entry is Firebase-free on purpose; what this module contributes is
// the SESSION. The remote-host runner signs into mulmoserver's Firebase as the
// user (server/backends/remoteHost/session.ts), so a post is a plain `setDoc` on
// `shapes/{id}` the gallery's rules accept because `uid == request.auth.uid`,
// and the thumbnail AND the script uploads under `shapes/{uid}/{id}/…`, the
// path the Storage rule scopes — the script is a Storage object the document
// points at by `scriptId`, never a field (receptron/mulmoserver#266). The reads
// are the queries the gallery's own pages run, and `get` downloads the script
// from under its OWNER, since the Storage rule opens the objects to anyone. No
// session → the tool says how to connect one. Compare MulmoClaude's
// `server/agent/mcp-tools/manageShapeScript.ts`, the same calls over that
// host's session.
//
// A HOST tool for the reason renderShapeScript is: it needs the workspace
// artifacts root and the session, which a plugin is not handed.
import {
  executeManageShapeScript,
  MANAGE_DESCRIPTION,
  MANAGE_PROMPT,
  MANAGE_SCHEMA,
  MANAGE_TOOL_NAME,
  SHAPE_OBJECT_CACHE_CONTROL,
  SHAPE_SCRIPT_CONTENT_TYPE,
  POST_CHANGED_MESSAGE,
  SHAPE_LICENSE,
  type ManageShapeResult,
  type ShapeGalleryWriter,
  type ShapePostDoc,
  type ShapePostExpect,
  type ShapePostPatch,
} from "@mulmoclaude/shapescript-plugin";
import { renderShapeThumbnail } from "@mulmoclaude/shapescript-plugin/render";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit as limitTo,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  where,
  type Firestore,
} from "firebase/firestore";
import { deleteObject, getBytes, ref as storageRef, uploadBytes, type FirebaseStorage } from "firebase/storage";
import type { ToolDefinition } from "gui-chat-protocol";
import { artifactsFileOps } from "../backends/artifacts.js";
import { shapeScriptByPath } from "../backends/openPath.js";
import { currentDisplayName, currentFirestore, currentStorage, currentUid } from "../backends/remoteHost/session.js";

const SHAPES = "shapes";
const THUMBNAIL_TYPE = "image/png";

export const MANAGE_SHAPE_SCRIPT: ToolDefinition = {
  type: "function",
  name: MANAGE_TOOL_NAME,
  description: MANAGE_DESCRIPTION,
  prompt: MANAGE_PROMPT,
  parameters: MANAGE_SCHEMA,
};

/** The grant's stamp, beside a `license` the owner is granting now: the rules want it to be
 *  the server's, and refuse one without a grant — so none for a draft, or an unlicensed post. */
const acceptedNow = (license: ShapePostDoc["license"] | undefined): Record<string, unknown> =>
  license === SHAPE_LICENSE ? { licenseAcceptedAt: serverTimestamp() } : {};

/** The document as written: the post plus the stamps the rules demand be the server's — the
 *  two times, and the agreement's when there is one. Exported for the test that pins it. */
export function postDocumentOf(post: ShapePostDoc): Record<string, unknown> {
  return { ...post, ...acceptedNow(post.license), createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
}

/** The update as written: only the fields the plugin gave plus a server `updatedAt`, and NO
 *  `createdAt` — the rules freeze it. Field-level (`updateDoc`), so a field not given keeps
 *  what the document holds now, not what a read a moment ago saw. A `license` in the patch is
 *  the owner's first agreement and gets its server stamp — unless the document is licensed
 *  `already` (another client agreed since the plugin's read): the rules let a grant be made
 *  once and never restated, so both are then left out and the stored grant stands. */
export function postUpdateOf(patch: ShapePostPatch, already = false): Record<string, unknown> {
  const { license, ...rest } = patch;
  const grant = already ? {} : { ...(license === undefined ? {} : { license }), ...acceptedNow(license) };
  return { ...rest, ...grant, updatedAt: serverTimestamp() };
}

/** Whether the stored document is still the one the plugin merged against: same owner, same
 *  object ids, same published state. Object ids are minted per upload, so a match means no edit
 *  replaced the model in between; the published state is what the patch's grant was decided
 *  from, so a toggle in between refuses the write instead of licensing a draft. */
export function postStillMatches(data: Record<string, unknown> | undefined, expect: ShapePostExpect): data is Record<string, unknown> {
  return (
    data !== undefined &&
    data.uid === expect.uid &&
    data.scriptId === expect.scriptId &&
    data.thumbnailId === expect.thumbnailId &&
    (data.published !== false) === expect.published
  );
}

/** A read the rules refused — another account's draft. The gallery shows the same "not here"
 *  for that as for a wrong id, and so does the tool: both are null, not an error. */
export function isHiddenByRules(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "permission-denied";
}

/** `shapes/{uid}/{shapeId}/{objectId}` — under the owner, so the Storage rule
 *  scopes writes without a Firestore read. */
export function shapeObjectPath(uid: string, shapeId: string, objectId: string): string {
  return `${SHAPES}/${uid}/${shapeId}/${objectId}`;
}

/** The writer over one signed-in session: the Firestore document, and the Storage
 *  objects — the card's picture and the script — under `shapes/{uid}/{id}/…`, the
 *  path the Storage rule lets the owner write. Every object goes out
 *  immutable-cacheable: its id is minted here and it is never rewritten. */
export function galleryWriterFrom(session: { firestore: Firestore; storage: FirebaseStorage; uid: string; authorName: string }): ShapeGalleryWriter {
  const post = (shapeId: string) => doc(session.firestore, SHAPES, shapeId);
  const objectRef = (ownerUid: string, shapeId: string, objectId: string) => storageRef(session.storage, shapeObjectPath(ownerUid, shapeId, objectId));
  const upload = async (shapeId: string, bytes: Uint8Array | string, contentType: string): Promise<string> => {
    const objectId = crypto.randomUUID();
    const data = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
    await uploadBytes(objectRef(session.uid, shapeId, objectId), data, { contentType, cacheControl: SHAPE_OBJECT_CACHE_CONTROL });
    return objectId;
  };
  return {
    uid: session.uid,
    authorName: session.authorName,
    createPost: (shapeId, document) => setDoc(post(shapeId), postDocumentOf(document)),
    readPost: async (shapeId) => {
      try {
        const snapshot = await getDoc(post(shapeId));
        return snapshot.exists() ? snapshot.data() : null;
      } catch (error) {
        if (isHiddenByRules(error)) return null;
        throw error;
      }
    },
    // A transaction: the check and the field-level update are one atomic step, so a
    // concurrent edit either lands before (and this one is refused) or after (and sees ours).
    updatePost: (shapeId, patch, expect) =>
      runTransaction(session.firestore, async (transaction) => {
        const data = (await transaction.get(post(shapeId))).data();
        if (!postStillMatches(data, expect)) throw new Error(POST_CHANGED_MESSAGE);
        transaction.update(post(shapeId), postUpdateOf(patch, data.license === SHAPE_LICENSE));
      }),
    // The same transaction shape: refused unless the post still carries the ids the plugin
    // read, so a delete cannot orphan the objects of an update that landed in between. Answers
    // the document as deleted, whose objects the plugin then removes.
    deletePost: (shapeId, expect) =>
      runTransaction(session.firestore, async (transaction) => {
        const data = (await transaction.get(post(shapeId))).data();
        if (!postStillMatches(data, expect)) throw new Error(POST_CHANGED_MESSAGE);
        transaction.delete(post(shapeId));
        return data;
      }),
    // The gallery's own "My models" query: the rules admit it because `uid == me` holds
    // for every row, and the (uid, createdAt desc) composite index serves it.
    listPosts: async (uid, count) => {
      const snapshot = await getDocs(query(collection(session.firestore, SHAPES), where("uid", "==", uid), orderBy("createdAt", "desc"), limitTo(count)));
      return snapshot.docs.map((row) => ({ id: row.id, data: row.data() }));
    },
    readScript: async (ownerUid, shapeId, scriptId) => new TextDecoder().decode(await getBytes(objectRef(ownerUid, shapeId, scriptId))),
    uploadThumbnail: (shapeId, png) => upload(shapeId, png, THUMBNAIL_TYPE),
    uploadScript: (shapeId, script) => upload(shapeId, script, SHAPE_SCRIPT_CONTENT_TYPE),
    deleteObject: (shapeId, objectId) => deleteObject(objectRef(session.uid, shapeId, objectId)),
  };
}

/** The live session as a writer, or null when Remote Host is not connected. */
function currentGallery(): ShapeGalleryWriter | null {
  const uid = currentUid();
  if (uid === null) return null;
  return galleryWriterFrom({ firestore: currentFirestore(), storage: currentStorage(), uid, authorName: currentDisplayName() ?? "" });
}

/** Run one call. Returns the text the agent reads — a sentence, or JSON for the two reads —
 *  and, when the call concerns one post, its URL. */
export async function runManageShapeScript(args: Record<string, unknown>): Promise<{ message: string; url?: string }> {
  const result: ManageShapeResult = await executeManageShapeScript(
    {
      files: { artifacts: artifactsFileOps, byPath: shapeScriptByPath },
      gallery: currentGallery(),
      renderThumbnail: (script) => renderShapeThumbnail(script, (message) => console.warn(`[manageShapeScript] renderer: ${message}`)),
      onWarning: (message) => console.warn(`[manageShapeScript] ${message}`),
    },
    args,
  );
  return "url" in result ? { message: result.message, url: result.url } : { message: result.message };
}
