// @vitest-environment node
import { describe, it, expect } from "vitest";
import path from "node:path";
import { workspaceKey } from "../../../server/infra/workspace-key.js";

// The properties harvested from the differential harness that retired the inline copy of this
// function in scheduled-sessions.ts. They are what every caller filing state under this key
// depends on, so they are pinned here rather than only at one call site.
describe("workspaceKey", () => {
  it("gives each workspace its own key", () => {
    expect(workspaceKey("/ws/app")).not.toEqual(workspaceKey("/ws/app2"));
  });

  it("resolves a relative workspace so one directory answers one key", () => {
    expect(workspaceKey("/ws/app")).toBe(workspaceKey("/ws/sub/../app"));
    expect(workspaceKey("/ws/app")).toBe(workspaceKey("/ws/./app/"));
  });

  // A Windows path carries "\" and ":" — used raw they would break the write, or land it
  // outside the intended directory.
  it("leaves no path-unsafe characters, whatever the path held", () => {
    const keys = [workspaceKey("C:\\Users\\RUNNER~1\\ws"), workspaceKey("/ws/with space/!@#$%^&*()"), workspaceKey("/ws/日本語")];
    keys.forEach((key) => expect(key).toMatch(/^[a-zA-Z0-9-]+$/));
  });

  // Folding alone would collide; the digest is what keeps them apart.
  it("keeps workspaces apart even when their names fold to the same slug", () => {
    expect(workspaceKey("/ws/a.b")).not.toEqual(workspaceKey("/ws/a-b"));
    expect(workspaceKey("/ws/a b")).not.toEqual(workspaceKey("/ws/a-b"));
  });

  it("bounds the key for a deep path", () => {
    const deep = path.join("/", ...Array.from({ length: 40 }, (_, i) => `segment-${i}`));
    expect(workspaceKey(deep).length).toBeLessThanOrEqual(80);
  });

  // Truncation happens after folding, so two long paths sharing their first 60 characters
  // reach the same slug — only the digest separates them, and it is taken from the FULL path.
  it("keeps two deep paths apart when their slugs truncate to the same prefix", () => {
    const prefix = Array.from({ length: 20 }, (_, i) => `segment-${i}`);
    expect(workspaceKey(path.join("/", ...prefix, "one"))).not.toEqual(workspaceKey(path.join("/", ...prefix, "two")));
  });
});
