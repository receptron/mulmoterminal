// Host tool: `publishShapeScript` — post a ShapeScript model to the public gallery
// on mulmoserver (server.mulmocast.com/shapes) under the user's own account.
//
// Everything a model sees lives in `@mulmoclaude/shapescript-plugin`: the schema,
// the description, the document a post is and its pinned key set, the keyword
// rule. That entry is Firebase-free on purpose; what this module contributes is
// the SESSION. The remote-host runner signs into mulmoserver's Firebase as the
// user (server/backends/remoteHost/session.ts), so a post is a plain `setDoc` on
// `shapes/{id}` the gallery's rules accept because `uid == request.auth.uid`,
// and the thumbnail AND the script uploads under `shapes/{uid}/{id}/…`, the
// path the Storage rule scopes — the script is a Storage object the document
// points at by `scriptId`, never a field (receptron/mulmoserver#266). No
// session → the tool says how to connect one. Compare MulmoClaude's
// `server/agent/mcp-tools/publishShapeScript.ts`, the same call over that
// host's session.
//
// A HOST tool for the reason renderShapeScript is: it needs the workspace
// artifacts root and the session, which a plugin is not handed.
import {
  executePublishShapeScript,
  PUBLISH_DESCRIPTION,
  PUBLISH_PROMPT,
  PUBLISH_SCHEMA,
  PUBLISH_TOOL_NAME,
  SHAPE_OBJECT_CACHE_CONTROL,
  SHAPE_SCRIPT_CONTENT_TYPE,
  type ShapeGalleryWriter,
  type ShapePostDoc,
} from "@mulmoclaude/shapescript-plugin";
import { renderShapeThumbnail } from "@mulmoclaude/shapescript-plugin/render";
import { doc, serverTimestamp, setDoc, type Firestore } from "firebase/firestore";
import { deleteObject, ref as storageRef, uploadBytes, type FirebaseStorage } from "firebase/storage";
import type { ToolDefinition } from "gui-chat-protocol";
import { artifactsFileOps } from "../backends/artifacts.js";
import { shapeScriptByPath } from "../backends/openPath.js";
import { currentDisplayName, currentFirestore, currentStorage, currentUid } from "../backends/remoteHost/session.js";

const SHAPES = "shapes";
const THUMBNAIL_TYPE = "image/png";

export const PUBLISH_SHAPE_SCRIPT: ToolDefinition = {
  type: "function",
  name: PUBLISH_TOOL_NAME,
  description: PUBLISH_DESCRIPTION,
  prompt: PUBLISH_PROMPT,
  parameters: PUBLISH_SCHEMA,
};

/** The document as written: the post plus the two stamps the rules demand be the
 *  server's. Exported for the test that pins it. */
export function postDocumentOf(post: ShapePostDoc): Record<string, unknown> {
  return { ...post, createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
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
  const objectRef = (shapeId: string, objectId: string) => storageRef(session.storage, shapeObjectPath(session.uid, shapeId, objectId));
  const upload = async (shapeId: string, bytes: Uint8Array | string, contentType: string): Promise<string> => {
    const objectId = crypto.randomUUID();
    const data = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
    await uploadBytes(objectRef(shapeId, objectId), data, { contentType, cacheControl: SHAPE_OBJECT_CACHE_CONTROL });
    return objectId;
  };
  return {
    uid: session.uid,
    authorName: session.authorName,
    createPost: (shapeId, post) => setDoc(doc(session.firestore, SHAPES, shapeId), postDocumentOf(post)),
    uploadThumbnail: (shapeId, png) => upload(shapeId, png, THUMBNAIL_TYPE),
    uploadScript: (shapeId, script) => upload(shapeId, script, SHAPE_SCRIPT_CONTENT_TYPE),
    deleteObject: (shapeId, objectId) => deleteObject(objectRef(shapeId, objectId)),
  };
}

/** The live session as a writer, or null when Remote Host is not connected. */
function currentGallery(): ShapeGalleryWriter | null {
  const uid = currentUid();
  if (uid === null) return null;
  return galleryWriterFrom({ firestore: currentFirestore(), storage: currentStorage(), uid, authorName: currentDisplayName() ?? "" });
}

/** Run one call. Returns the sentence the agent reads and the model's URL. */
export async function runPublishShapeScript(args: Record<string, unknown>): Promise<{ message: string; url: string }> {
  const result = await executePublishShapeScript(
    {
      files: { artifacts: artifactsFileOps, byPath: shapeScriptByPath },
      gallery: currentGallery(),
      renderThumbnail: (script) => renderShapeThumbnail(script, (message) => console.warn(`[publishShapeScript] renderer: ${message}`)),
      onWarning: (message) => console.warn(`[publishShapeScript] ${message}`),
    },
    args,
  );
  return { message: result.message, url: result.url };
}
