import { describe, it, expect } from "vitest";
import { dropUploadErrorMessage, dropUploadUrl, isTooLargeToDrop, uploadDropBatch, type DropUploadResult } from "../../../src/components/dropUpload";
import { MAX_DROP_BYTES } from "../../../common/dropUpload";

describe("dropUploadUrl", () => {
  it("addresses the session's own drop endpoint", () => {
    expect(dropUploadUrl("2f1c0b4e-0000-4000-8000-000000000000")).toBe("/api/session/2f1c0b4e-0000-4000-8000-000000000000/drop");
  });

  // #3506: a session on a remote host is reached through the gateway.
  it("addresses a remote host's session through the gateway", () => {
    expect(dropUploadUrl("2f1c0b4e-0000-4000-8000-000000000000", "lx")).toBe("/remote/lx/api/session/2f1c0b4e-0000-4000-8000-000000000000/drop");
    expect(dropUploadUrl("2f1c0b4e-0000-4000-8000-000000000000", null)).toBe("/api/session/2f1c0b4e-0000-4000-8000-000000000000/drop");
  });

  // The id reaches the URL from component state rather than from a user, but a value that
  // needs escaping must not silently address a different path.
  it("escapes an id that would otherwise reshape the path", () => {
    expect(dropUploadUrl("../../evil")).toBe("/api/session/..%2F..%2Fevil/drop");
  });
});

describe("isTooLargeToDrop", () => {
  // Checked in the browser as well as by the server so a large file fails at once, rather than
  // after uploading all of it only to be refused at the end.
  it("accepts up to the cap and refuses past it", () => {
    expect(isTooLargeToDrop(MAX_DROP_BYTES)).toBe(false);
    expect(isTooLargeToDrop(MAX_DROP_BYTES + 1)).toBe(true);
    expect(isTooLargeToDrop(0)).toBe(false);
  });
});

describe("dropUploadErrorMessage", () => {
  // Each of these needs a DIFFERENT thing from the user — shrink the file, restart the
  // terminal, fix the origin — and "it failed" tells them none of it.
  it("says something different for each cause the user can act on", () => {
    const actionable = [413, 404, 403].map(dropUploadErrorMessage);
    expect(new Set(actionable).size).toBe(actionable.length);
    expect(actionable).not.toContain(dropUploadErrorMessage(null));
  });

  // Everything else is one message on purpose: there is nothing specific to say about a 500 or
  // a dropped connection, and inventing per-status wording would only look like it knew more.
  it("gives an unrecognized status the same message as no status at all", () => {
    expect(dropUploadErrorMessage(500)).toBe(dropUploadErrorMessage(null));
  });

  it("names the size for a file that was too large", () => {
    expect(dropUploadErrorMessage(413)).toContain("too large");
  });

  it("has a message for a failure with no status at all", () => {
    expect(dropUploadErrorMessage(null)).not.toBe("");
  });
});

describe("uploadDropBatch", () => {
  const SESSION = "2f1c0b4e-0000-4000-8000-000000000000";
  const fileNamed = (name: string) => new File(["x"], name, { type: "text/plain" });
  const saves = (path: string): DropUploadResult => ({ ok: true, path });

  it("returns the paths in the order the files were dropped", async () => {
    const outcome = await uploadDropBatch(
      SESSION,
      [fileNamed("a.txt"), fileNamed("b.txt")],
      () => SESSION,
      async (_s, file) => saves(`/saved-drops/${file.name}`),
    );
    expect(outcome).toEqual({ kind: "inserted", paths: ["/saved-drops/a.txt", "/saved-drops/b.txt"] });
  });

  // Order must come from the DROP, not from which upload happened to finish first — a small
  // file otherwise overtakes a large one every time and the terminal gets the wrong argument list.
  it("keeps drop order even when a later file finishes first", async () => {
    const delays: Record<string, number> = { "slow.txt": 20, "fast.txt": 0 };
    const outcome = await uploadDropBatch(
      SESSION,
      [fileNamed("slow.txt"), fileNamed("fast.txt")],
      () => SESSION,
      async (_s, file) => {
        await new Promise((resolve) => setTimeout(resolve, delays[file.name]));
        return saves(`/saved-drops/${file.name}`);
      },
    );
    expect(outcome).toEqual({ kind: "inserted", paths: ["/saved-drops/slow.txt", "/saved-drops/fast.txt"] });
  });

  it("reports the failure and stops rather than inserting a partial list", async () => {
    const attempted: string[] = [];
    const outcome = await uploadDropBatch(
      SESSION,
      [fileNamed("a.txt"), fileNamed("b.txt")],
      () => SESSION,
      async (_s, file) => {
        attempted.push(file.name);
        return file.name === "a.txt" ? { ok: false, status: 413 } : saves("/saved-drops/b.txt");
      },
    );
    expect(outcome).toEqual({ kind: "failed", status: 413 });
    expect(attempted).toEqual(["a.txt"]);
  });

  // A saved file belongs to the session it was uploaded for — the only one granted its
  // directory at spawn. Inserting it after a switch hands the NEW session a path it was never
  // granted and cannot read (found by Codex review).
  it("refuses to insert when the terminal changed session mid-upload", async () => {
    let current: string | null = SESSION;
    const outcome = await uploadDropBatch(
      SESSION,
      [fileNamed("a.txt")],
      () => current,
      async () => {
        current = "9999aaaa-0000-4000-8000-000000000000"; // a reconnect minted a new id under us
        return saves("/saved-drops/a.txt");
      },
    );
    expect(outcome).toEqual({ kind: "stale" });
  });

  // The switch can also land between two files, which the check after the last upload alone
  // would only catch once every byte had already been sent.
  it("stops uploading as soon as the session changes", async () => {
    let current: string | null = SESSION;
    const attempted: string[] = [];
    const outcome = await uploadDropBatch(
      SESSION,
      [fileNamed("a.txt"), fileNamed("b.txt")],
      () => current,
      async (_s, file) => {
        attempted.push(file.name);
        current = null; // the terminal lost its session
        return saves(`/saved-drops/${file.name}`);
      },
    );
    expect(outcome).toEqual({ kind: "stale" });
    expect(attempted).toEqual(["a.txt"]);
  });
});
