import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseUpdateStatus, readUpdateStatus } from "../../../server/config/update-status.js";

describe("parseUpdateStatus", () => {
  it("reads a string notice", () => {
    expect(parseUpdateStatus({ notice: "Update available: git pull" })).toEqual({ notice: "Update available: git pull" });
  });

  it("is null when the launcher wrote no notice (clean / opted out)", () => {
    expect(parseUpdateStatus({ notice: null })).toEqual({ notice: null });
  });

  // An empty string is nothing to show — treat it as no notice so the badge stays hidden.
  it("treats an empty notice as none", () => {
    expect(parseUpdateStatus({ notice: "" })).toEqual({ notice: null });
  });

  // A hand-edited or partially-written file must never take the route down.
  it("is null for junk rather than throwing", () => {
    expect(parseUpdateStatus(null)).toEqual({ notice: null });
    expect(parseUpdateStatus("nope")).toEqual({ notice: null });
    expect(parseUpdateStatus(42)).toEqual({ notice: null });
    expect(parseUpdateStatus({})).toEqual({ notice: null });
    expect(parseUpdateStatus({ notice: 123 })).toEqual({ notice: null });
  });
});

describe("readUpdateStatus", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "mt-update-"));
  const file = path.join(dir, "update-status.json");
  const cleanup = () => rmSync(dir, { recursive: true, force: true });

  it("returns the notice from a well-formed file", async () => {
    writeFileSync(file, JSON.stringify({ notice: "Update available: 0.7.1 → 0.8.0  ·  run: npm i -g mulmoterminal" }));
    expect((await readUpdateStatus(file)).notice).toContain("npm i -g mulmoterminal");
  });

  // The launcher's async check may not have written the file yet on first load — that is the
  // common case, not an error, and it must read as "no badge".
  it("is null when the file does not exist", async () => {
    expect(await readUpdateStatus(path.join(dir, "missing.json"))).toEqual({ notice: null });
  });

  it("is null for malformed JSON", async () => {
    writeFileSync(file, "{ not json");
    expect(await readUpdateStatus(file)).toEqual({ notice: null });
    cleanup();
  });
});
