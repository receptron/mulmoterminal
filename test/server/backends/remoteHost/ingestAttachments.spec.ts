// @vitest-environment node
import { describe, it, expect, vi } from "vitest";

import { createIngestAttachments, type IngestDeps } from "../../../../server/backends/remoteHost/ingestAttachments.js";

// A recording stub set. Every dep appends to `log` so a test can assert not just WHAT happened
// but the ORDER — the invariant this module exists to hold is "save all, then delete all".
interface Harness {
  deps: IngestDeps;
  log: string[];
  saved: string[];
  deleted: string[];
}

interface Options {
  uid?: string | null;
  fetchThrowsOn?: string; // storage_id whose fetch rejects
  saveThrowsOn?: string; // storage_id whose save rejects (keyed by the fetched contentType tag)
  deleteThrowsOn?: string; // storage path whose delete rejects
}

const harness = (opts: Options = {}): Harness => {
  const log: string[] = [];
  const saved: string[] = [];
  const deleted: string[] = [];
  const uid = opts.uid === undefined ? "user-1" : opts.uid;
  const deps: IngestDeps = {
    uid: () => {
      log.push("uid");
      return uid;
    },
    fetchObject: async (storagePath) => {
      const id = storagePath.split("/").pop() ?? "";
      log.push(`fetch:${id}`);
      if (opts.fetchThrowsOn === id) throw new Error(`fetch failed for ${id}`);
      return { base64: `bytes-${id}`, contentType: `mime/${id}` };
    },
    saveAttachment: async (base64, mimeType) => {
      const id = base64.replace("bytes-", "");
      log.push(`save:${id}`);
      saved.push(id);
      if (opts.saveThrowsOn === id) throw new Error(`save failed for ${id}`);
      return { relativePath: `data/attachments/${id}.bin`, mimeType };
    },
    deleteObject: async (storagePath) => {
      log.push(`delete:${storagePath}`);
      deleted.push(storagePath);
      if (opts.deleteThrowsOn === storagePath) throw new Error(`delete failed for ${storagePath}`);
    },
  };
  return { deps, log, saved, deleted };
};

const pathOf = (id: string) => `users/user-1/uploads/${id}`;

describe("createIngestAttachments", () => {
  it("returns [] for no ids without even checking sign-in", async () => {
    const h = harness();
    expect(await createIngestAttachments(h.deps)([])).toEqual([]);
    expect(h.log).toEqual([]); // uid() never read — nothing to ingest
  });

  it("throws when the host is not signed in, touching no storage", async () => {
    const h = harness({ uid: null });
    await expect(createIngestAttachments(h.deps)(["a"])).rejects.toThrow("not signed in");
    expect(h.log).toEqual(["uid"]); // failed before any fetch/save/delete
  });

  it("maps each id to a path-only Attachment, in order", async () => {
    const h = harness();
    const result = await createIngestAttachments(h.deps)(["a", "b"]);
    expect(result).toEqual([
      { path: "data/attachments/a.bin", mimeType: "mime/a" },
      { path: "data/attachments/b.bin", mimeType: "mime/b" },
    ]);
  });

  it("interpolates the id into users/{uid}/uploads/{id} for fetch and delete", async () => {
    const h = harness();
    await createIngestAttachments(h.deps)(["a"]);
    expect(h.log).toContain(`fetch:a`);
    expect(h.deleted).toEqual([pathOf("a")]);
  });

  // The core invariant: every save completes before the first delete runs. A regression that
  // interleaved delete into phase 1 would reap a staged object before a later file is safe.
  it("saves every attachment before deleting any", async () => {
    const h = harness();
    await createIngestAttachments(h.deps)(["a", "b", "c"]);
    const firstDelete = h.log.findIndex((e) => e.startsWith("delete:"));
    const lastSave = h.log.map((e) => e.startsWith("save:")).lastIndexOf(true);
    expect(lastSave).toBeLessThan(firstDelete);
    expect(h.deleted).toEqual([pathOf("a"), pathOf("b"), pathOf("c")]);
  });

  // Replay safety: a malformed id aborts the batch BEFORE any delete, so a retry with the same
  // ids still finds every earlier upload in staging. This is the whole reason phase 2 is separate.
  it("rejects a malformed storage_id and deletes nothing", async () => {
    const h = harness();
    await expect(createIngestAttachments(h.deps)(["good", "../evil"])).rejects.toThrow("invalid storage_id: ../evil");
    expect(h.deleted).toEqual([]);
  });

  // Same replay-safety guarantee for a hard failure mid-batch: id "b" fails to fetch, so nothing —
  // not even the already-saved "a" — is deleted from staging.
  it("does not delete earlier uploads when a later fetch fails", async () => {
    const h = harness({ fetchThrowsOn: "b" });
    await expect(createIngestAttachments(h.deps)(["a", "b"])).rejects.toThrow("fetch failed for b");
    expect(h.saved).toEqual(["a"]); // "a" was saved
    expect(h.deleted).toEqual([]); // ...but not reaped
  });

  it("does not delete earlier uploads when a later save fails", async () => {
    const h = harness({ saveThrowsOn: "b" });
    await expect(createIngestAttachments(h.deps)(["a", "b"])).rejects.toThrow("save failed for b");
    expect(h.deleted).toEqual([]);
  });

  // Phase 2 is best-effort: a delete that fails only logs and leaves an orphan for a TTL sweep —
  // it must never drop an attachment that is already safely in the workspace.
  it("still returns every attachment when a staging delete fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const h = harness({ deleteThrowsOn: pathOf("a") });
    const result = await createIngestAttachments(h.deps)(["a", "b"]);
    expect(result.map((r) => r.path)).toEqual(["data/attachments/a.bin", "data/attachments/b.bin"]);
    expect(h.deleted).toContain(pathOf("b")); // the failure did not abort the rest of phase 2
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
