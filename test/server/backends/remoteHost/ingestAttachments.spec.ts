// @vitest-environment node
import { describe, it, expect } from "vitest.js";

import { createIngestAttachments, type IngestDeps } from "../../../../server/backends/remoteHost/ingestAttachments.js";

// Base stub deps: signed in as u1, fetch returns a jpeg, save echoes a path.
const baseDeps = (): IngestDeps => ({
  uid: () => "u1",
  fetchObject: async () => ({ base64: "AAAA", contentType: "image/jpeg" }),
  saveAttachment: async (base64, mimeType) => ({ relativePath: `data/attachments/${base64}.jpg`, mimeType }),
  deleteObject: async () => undefined,
});

describe("createIngestAttachments", () => {
  it("returns [] for no ids without touching storage", async () => {
    let touched = false;
    const ingest = createIngestAttachments({
      ...baseDeps(),
      fetchObject: async () => {
        touched = true;
        return { base64: "", contentType: "" };
      },
    });
    expect(await ingest([])).toEqual([]);
    expect(touched).toBe(false);
  });

  it("downloads each id, saves it, deletes staging, and returns path-only attachments in order", async () => {
    const fetched: string[] = [];
    const deleted: string[] = [];
    const ingest = createIngestAttachments({
      ...baseDeps(),
      fetchObject: async (storagePath) => {
        fetched.push(storagePath);
        return { base64: "AAAA", contentType: "image/jpeg" };
      },
      deleteObject: async (storagePath) => {
        deleted.push(storagePath);
      },
    });

    const out = await ingest(["a1", "b2"]);

    expect(fetched).toEqual(["users/u1/uploads/a1", "users/u1/uploads/b2"]);
    expect(deleted).toEqual(["users/u1/uploads/a1", "users/u1/uploads/b2"]);
    expect(out).toEqual([
      { path: "data/attachments/AAAA.jpg", mimeType: "image/jpeg" },
      { path: "data/attachments/AAAA.jpg", mimeType: "image/jpeg" },
    ]);
  });

  it("throws when the host is not signed in", async () => {
    const ingest = createIngestAttachments({ ...baseDeps(), uid: () => null });
    await expect(ingest(["a1"])).rejects.toThrow(/not signed in/);
  });

  it("rejects a malformed storage_id before it can reshape the Storage path", async () => {
    const ingest = createIngestAttachments(baseDeps());
    await expect(ingest(["../evil"])).rejects.toThrow(/invalid storage_id/);
    await expect(ingest(["a/b"])).rejects.toThrow(/invalid storage_id/);
  });

  it("deletes NO staged object when a later attachment fails (a same-ids retry stays possible)", async () => {
    const deleted: string[] = [];
    let call = 0;
    const ingest = createIngestAttachments({
      ...baseDeps(),
      fetchObject: async () => {
        call += 1;
        if (call === 2) throw new Error("fetch b failed");
        return { base64: "AAAA", contentType: "image/jpeg" };
      },
      deleteObject: async (storagePath) => {
        deleted.push(storagePath);
      },
    });
    await expect(ingest(["a1", "b2"])).rejects.toThrow(/fetch b failed/);
    expect(deleted).toEqual([]); // a1 was saved but not reaped → the remote can retry with the same ids
  });

  it("tolerates a failed staging delete — the file is already ingested", async () => {
    const ingest = createIngestAttachments({
      ...baseDeps(),
      deleteObject: async () => {
        throw new Error("delete boom");
      },
    });
    const out = await ingest(["a1"]);
    expect(out).toHaveLength(1);
  });
});
