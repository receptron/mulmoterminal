// @vitest-environment node
//
// The manageShapeScript host tool. No Firebase is reached: what is pinned is the
// contract with the plugin (the definition comes from the package, not a local
// copy), the document this host writes (the post plus two server stamps, which
// mulmoserver's rules demand — and `scriptId`, never the script text, since the
// script is a Storage object: receptron/mulmoserver#266), that a rules-refused
// read is an absence, the Storage path the rule scopes, and that with no
// remote-host session the tool refuses with the sentence that says how to connect.
import { describe, it, expect } from "vitest";
import type { Firestore } from "firebase/firestore";
import type { FirebaseStorage } from "firebase/storage";
import { NOT_CONNECTED_MESSAGE, SHAPE_POST_KEYS, shapePostFrom } from "@mulmoclaude/shapescript-plugin";
import {
  MANAGE_SHAPE_SCRIPT,
  galleryWriterFrom,
  isHiddenByRules,
  postDocumentOf,
  postStillMatches,
  postUpdateOf,
  runManageShapeScript,
  shapeObjectPath,
} from "../../../server/infra/shapescript-manage-tool.js";

describe("manageShapeScript host tool", () => {
  it("is offered with the shared contract, not a local copy of it", () => {
    expect(MANAGE_SHAPE_SCRIPT.name).toBe("manageShapeScript");
    expect(MANAGE_SHAPE_SCRIPT.description).toContain("gallery");
    const schema = MANAGE_SHAPE_SCRIPT.parameters as { properties: Record<string, { enum?: string[] }>; required: string[] };
    expect(Object.keys(schema.properties)).toEqual([
      "action",
      "id",
      "title",
      "script",
      "path",
      "description",
      "keywords",
      "prompt",
      "aiModel",
      "published",
      "save",
      "limit",
    ]);
    expect(schema.properties.action?.enum).toEqual(["publish", "update", "delete", "get", "getList"]);
    expect(schema.required).toEqual(["action"]);
  });

  it("writes the post plus server-stamped createdAt / updatedAt, and nothing else", () => {
    const post = shapePostFrom({ uid: "u-alice", authorName: "Alice" }, { title: "Lamp", scriptId: "script-1", keywords: ["lamp"] });
    const document = postDocumentOf(post);
    expect(Object.keys(document)).toEqual([...SHAPE_POST_KEYS, "createdAt", "updatedAt"]);
    expect(document.scriptId).toBe("script-1");
    expect(Object.hasOwn(document, "script")).toBe(false);
    for (const key of ["createdAt", "updatedAt"]) {
      expect((document[key] as { _methodName?: string })._methodName).toBe("serverTimestamp");
    }
  });

  it("updates only the fields the plugin gave, with a server-stamped updatedAt and never createdAt, which the rules freeze", () => {
    const update = postUpdateOf({ title: "Lamp 2", scriptId: "script-2" });
    expect(Object.keys(update)).toEqual(["title", "scriptId", "updatedAt"]);
    expect((update.updatedAt as { _methodName?: string })._methodName).toBe("serverTimestamp");
    expect(Object.hasOwn(update, "createdAt")).toBe(false);
  });

  it("applies an update or a delete only while the post still carries the owner and object ids the plugin read", () => {
    const expected = { uid: "u-alice", scriptId: "script-1", thumbnailId: "obj-1" };
    expect(postStillMatches({ uid: "u-alice", scriptId: "script-1", thumbnailId: "obj-1", title: "Lamp" }, expected)).toBe(true);
    expect(postStillMatches({ uid: "u-alice", scriptId: "script-2", thumbnailId: "obj-1" }, expected)).toBe(false);
    expect(postStillMatches({ uid: "u-alice", scriptId: "script-1", thumbnailId: "obj-2" }, expected)).toBe(false);
    expect(postStillMatches({ uid: "u-bob", scriptId: "script-1", thumbnailId: "obj-1" }, expected)).toBe(false);
    expect(postStillMatches(undefined, expected)).toBe(false);
  });

  // Another account's draft is refused by the rules; the gallery shows "not here" for it as
  // for a wrong id, and so does the tool. A transport fault is not that and stays an error.
  it("reads a rules-refused document as absent, and nothing else", () => {
    expect(isHiddenByRules({ code: "permission-denied", message: "Missing or insufficient permissions." })).toBe(true);
    expect(isHiddenByRules({ code: "unavailable" })).toBe(false);
    expect(isHiddenByRules(new Error("network"))).toBe(false);
    expect(isHiddenByRules(null)).toBe(false);
  });

  it("keeps a picture under the owner, where the Storage rule scopes writes", () => {
    expect(shapeObjectPath("u-alice", "s-1", "o-1")).toBe("shapes/u-alice/s-1/o-1");
  });

  it("posts as the session's user, with every read and write the plugin's contract needs", () => {
    const writer = galleryWriterFrom({ firestore: {} as Firestore, storage: {} as FirebaseStorage, uid: "u-alice", authorName: "Alice" });
    expect(writer.uid).toBe("u-alice");
    expect(writer.authorName).toBe("Alice");
    for (const member of [
      "createPost",
      "readPost",
      "updatePost",
      "deletePost",
      "listPosts",
      "readScript",
      "uploadThumbnail",
      "uploadScript",
      "deleteObject",
    ] as const) {
      expect(typeof writer[member], member).toBe("function");
    }
  });

  it("refuses without a remote-host session, reads included, saying how to connect one", async () => {
    await expect(runManageShapeScript({ action: "publish", title: "Lamp", script: "cube { size 1 }" })).rejects.toThrow(NOT_CONNECTED_MESSAGE.slice(0, 30));
    await expect(runManageShapeScript({ action: "getList" })).rejects.toThrow(NOT_CONNECTED_MESSAGE.slice(0, 30));
  });
});
