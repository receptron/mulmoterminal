// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, symlinkSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { initMulmoScriptBackend, registeredStoriesRoots } from "../../../server/backends/mulmoscript";
import { initArtifactsBackend } from "../../../server/backends/artifacts";
import { storiesRootId } from "../../../server/backends/storiesRoot";

// What `/api/config` hands the browser about the named stories root. It must be the value the
// plugin was REGISTERED with: a card carries the id, and an id nothing registered is a
// `bad_request` on every open (CodeRabbit on #1934).
describe("the registered stories root", () => {
  let base = "";

  beforeEach(() => {
    base = mkdtempSync(path.join(tmpdir(), "mt-stories-registered-"));
  });

  afterEach(() => rmSync(base, { recursive: true, force: true }));

  it("is the canonical workspace and its id", () => {
    const real = path.join(base, "real-ws");
    mkdirSync(real);
    initArtifactsBackend({ workspace: real });
    initMulmoScriptBackend({ workspace: real, pubsub: null });
    const root = registeredStoriesRoots()[0];
    expect(root?.id).toBe(storiesRootId(real));
    // Every spelling names the same directory. On macOS even a plain temp path has two — `/var` is
    // itself a symlink to `/private/var` — which is exactly why the browser is handed the set.
    expect(root?.paths.length).toBeGreaterThan(0);
    expect(root?.paths.every((spelling: string) => spelling.endsWith("real-ws"))).toBe(true);
    expect(new Set(root?.paths).size).toBe(root?.paths.length); // deduped
  });

  // The reason it is captured rather than recomputed: `storiesRootId` realpaths, so a workspace
  // reached through a symlink answers with the TARGET — and retargeting that symlink while the
  // server runs would otherwise change the id the browser is handed, while the plugin keeps
  // serving the one it registered at boot.
  // Both spellings, because both reach the Files pane and the browser's check is lexical: the
  // launched one through a cell's cwd, the resolved one through `git worktree list` (#1934 iter-5).
  it("carries the launched spelling as well as the resolved one", () => {
    const real = path.join(base, "real-ws");
    const link = path.join(base, "ws-link");
    mkdirSync(real);
    symlinkSync(real, link);
    initArtifactsBackend({ workspace: link });
    initMulmoScriptBackend({ workspace: link, pubsub: null });
    const root = registeredStoriesRoots()[0];
    expect(root?.paths).toContain(link);
    expect(root?.paths.some((spelling: string) => spelling.includes("real-ws") && !spelling.includes("ws-link"))).toBe(true);
  });

  // The id comes from the REALPATH, so two spellings of one directory mint one id. Deduplicating
  // the incoming list lexically is not enough: a saved preset that is a symlink to the workspace
  // resolves to a different string, and registered a SECOND root carrying the FIRST one's id —
  // while `extraRoots`, keyed by id, silently kept only one of the two directories. Observed by
  // reading the registration back, not flagged by a review bot (#1951).
  it("registers one root, not two, when a preset is a symlink to the workspace", () => {
    const real = path.join(base, "ws");
    const link = path.join(base, "ws-link");
    mkdirSync(real);
    symlinkSync(real, link);
    initArtifactsBackend({ workspace: real });
    initMulmoScriptBackend({ workspace: real, extraRoots: [link], pubsub: null });
    const roots = registeredStoriesRoots();
    expect(roots).toHaveLength(1);
    expect(new Set(roots.map((root) => root.id)).size).toBe(roots.length);
    // Both spellings reach the browser as ONE root's paths, which is what the workspace's own two
    // spellings already are.
    expect(roots[0]?.paths).toContain(link);
    expect(roots[0]?.paths).toContain(real);
  });

  // A genuinely different directory is its own root, so the merge above is not swallowing them.
  it("registers a preset that is a different directory", () => {
    const ws = path.join(base, "ws");
    const other = path.join(base, "other");
    mkdirSync(ws);
    mkdirSync(other);
    initArtifactsBackend({ workspace: ws });
    initMulmoScriptBackend({ workspace: ws, extraRoots: [other], pubsub: null });
    const roots = registeredStoriesRoots();
    expect(roots).toHaveLength(2);
    expect(new Set(roots.map((root) => root.id)).size).toBe(2);
    // The WORKSPACE is first — the browser reads that as the directory whose own `artifacts/stories`
    // is addressed without a root.
    expect(roots[0]?.paths).toContain(ws);
  });

  // WHICH of the spellings is the resolved one, labelled rather than left to be picked out of the
  // list. The browser cannot realpath, and it resolves a Canvas card's wire path against this
  // directory to decide what the card is about (#1976) — two cards resolved against two spellings
  // of one root would be two cards for one deck.
  it("says which spelling is the resolved one", () => {
    const real = path.join(base, "real-ws");
    const link = path.join(base, "ws-link");
    mkdirSync(real);
    symlinkSync(real, link);
    initArtifactsBackend({ workspace: link });
    initMulmoScriptBackend({ workspace: link, pubsub: null });
    const root = registeredStoriesRoots()[0];
    expect(root?.canonical).toBeDefined();
    expect(root?.canonical).not.toBe(link);
    expect(root?.paths).toContain(root?.canonical);
    // The same value the id was derived from, so a card naming this id resolves against the
    // directory the plugin actually serves.
    expect(root?.id).toBe(storiesRootId(String(root?.canonical)));
  });

  it("does not follow a symlink retargeted after boot", () => {
    const first = path.join(base, "first");
    const second = path.join(base, "second");
    const link = path.join(base, "ws");
    mkdirSync(first);
    mkdirSync(second);
    symlinkSync(first, link);
    initArtifactsBackend({ workspace: link });
    initMulmoScriptBackend({ workspace: link, pubsub: null });
    const atBoot = registeredStoriesRoots()[0];

    unlinkSync(link);
    symlinkSync(second, link);

    expect(registeredStoriesRoots()[0]).toEqual(atBoot);
    expect(atBoot?.id).not.toBe(storiesRootId(link)); // what re-deriving would now answer
  });
});
