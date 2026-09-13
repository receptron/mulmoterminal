// @vitest-environment node
//
// The publishShapeScript host tool. No Firebase is reached: what is pinned is the
// contract with the plugin (the definition comes from the package, not a local
// copy), the document this host writes (the post plus two server stamps, which
// mulmoserver's rules demand), the Storage path the rule scopes, and that with no
// remote-host session the tool refuses with the sentence that says how to connect.
import { describe, it, expect } from "vitest";
import type { Firestore } from "firebase/firestore";
import type { FirebaseStorage } from "firebase/storage";
import { NOT_CONNECTED_MESSAGE, SHAPE_POST_KEYS, shapePostFrom } from "@mulmoclaude/shapescript-plugin";
import {
  PUBLISH_SHAPE_SCRIPT,
  galleryWriterFrom,
  postDocumentOf,
  runPublishShapeScript,
  shapeObjectPath,
} from "../../../server/infra/shapescript-publish-tool.js";

describe("publishShapeScript host tool", () => {
  it("is offered with the shared contract, not a local copy of it", () => {
    expect(PUBLISH_SHAPE_SCRIPT.name).toBe("publishShapeScript");
    expect(PUBLISH_SHAPE_SCRIPT.description).toContain("gallery");
    expect(Object.keys(PUBLISH_SHAPE_SCRIPT.parameters?.properties ?? {})).toEqual([
      "title",
      "script",
      "path",
      "description",
      "keywords",
      "prompt",
      "published",
    ]);
  });

  it("writes the post plus server-stamped createdAt / updatedAt, and nothing else", () => {
    const post = shapePostFrom({ uid: "u-alice", authorName: "Alice" }, { title: "Lamp", script: "cube", keywords: ["lamp"] });
    const document = postDocumentOf(post);
    expect(Object.keys(document)).toEqual([...SHAPE_POST_KEYS, "createdAt", "updatedAt"]);
    for (const key of ["createdAt", "updatedAt"]) {
      expect((document[key] as { _methodName?: string })._methodName).toBe("serverTimestamp");
    }
  });

  it("keeps a picture under the owner, where the Storage rule scopes writes", () => {
    expect(shapeObjectPath("u-alice", "s-1", "o-1")).toBe("shapes/u-alice/s-1/o-1");
  });

  it("posts as the session's user, with every write the plugin's contract needs", () => {
    const writer = galleryWriterFrom({ firestore: {} as Firestore, storage: {} as FirebaseStorage, uid: "u-alice", authorName: "Alice" });
    expect(writer.uid).toBe("u-alice");
    expect(writer.authorName).toBe("Alice");
    expect(typeof writer.createPost).toBe("function");
    expect(typeof writer.uploadThumbnail).toBe("function");
    expect(typeof writer.deleteObject).toBe("function");
  });

  it("refuses without a remote-host session, saying how to connect one", async () => {
    await expect(runPublishShapeScript({ title: "Lamp", script: "cube { size 1 }" })).rejects.toThrow(NOT_CONNECTED_MESSAGE.slice(0, 30));
  });
});
