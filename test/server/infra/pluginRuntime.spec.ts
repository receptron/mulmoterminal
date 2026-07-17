// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { initPluginRuntime, createPluginRuntime } from "../../../server/infra/pluginRuntime.js";
import { initArtifactsBackend, artifactsRoot } from "../../../server/infra/backends/artifacts.js";

const PKG = "@scope/demo-plugin";

describe("createPluginRuntime", () => {
  let ws: string;
  let published: { channel: string; data: unknown }[];

  beforeEach(() => {
    ws = mkdtempSync(path.join(tmpdir(), "mt-plugrt-"));
    published = [];
    initPluginRuntime({ workspace: ws, publish: (channel, data) => published.push({ channel, data }) });
    initArtifactsBackend({ workspace: ws });
  });
  afterEach(() => {
    rmSync(ws, { recursive: true, force: true });
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe("files", () => {
    it("gives each package a private data dir under the workspace", async () => {
      const runtime = createPluginRuntime(PKG);
      await runtime.files.data.write("state.json", "{}");
      // The scoped name is slugified, so it can't introduce a path separator.
      const expected = path.join(ws, "data", "plugins", "_scope_demo-plugin", "state.json");
      expect(await runtime.files.data.exists("state.json")).toBe(true);
      expect(await readFile(expected, "utf8")).toBe("{}");
    });

    it("isolates one package's data from another's", async () => {
      await createPluginRuntime(PKG).files.data.write("state.json", "mine");
      const other = createPluginRuntime("@scope/other-plugin");
      expect(await other.files.data.exists("state.json")).toBe(false);
    });

    it("keeps data and config in separate areas", async () => {
      const runtime = createPluginRuntime(PKG);
      await runtime.files.data.write("x.txt", "data");
      await runtime.files.config.write("x.txt", "config");
      expect(await runtime.files.data.read("x.txt")).toBe("data");
      expect(await runtime.files.config.read("x.txt")).toBe("config");
    });

    it("shares one artifacts area across packages", async () => {
      await createPluginRuntime(PKG).files.artifacts.write("shared.txt", "hi");
      const other = createPluginRuntime("@scope/other-plugin");
      expect(await other.files.artifacts.read("shared.txt")).toBe("hi");
      expect(artifactsRoot()).toBe(path.resolve(ws, "artifacts"));
    });

    it("stops a plugin from escaping its own dir", async () => {
      const runtime = createPluginRuntime(PKG);
      await expect(runtime.files.data.write(path.join("..", "..", "escape.txt"), "x")).rejects.toThrow(/escapes its root/);
    });
  });

  describe("pubsub", () => {
    it("namespaces every publish under the package", () => {
      createPluginRuntime(PKG).pubsub.publish("progress", { done: 1 });
      expect(published).toEqual([{ channel: `plugin:${PKG}:progress`, data: { done: 1 } }]);
    });

    it("is a no-op when boot has not wired a publisher", () => {
      initPluginRuntime({ workspace: ws });
      expect(() => createPluginRuntime(PKG).pubsub.publish("progress", {})).not.toThrow();
    });
  });

  describe("fetch", () => {
    it("blocks a host outside allowedHosts without issuing a request", async () => {
      const spy = vi.fn();
      vi.stubGlobal("fetch", spy);
      const runtime = createPluginRuntime(PKG);
      await expect(runtime.fetch("https://evil.test/x", { allowedHosts: ["api.example.com"] })).rejects.toThrow(/not in allowedHosts/);
      expect(spy).not.toHaveBeenCalled();
    });

    it("allows a listed host", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response("ok")),
      );
      const runtime = createPluginRuntime(PKG);
      const res = await runtime.fetch("https://api.example.com/x", { allowedHosts: ["api.example.com"] });
      expect(await res.text()).toBe("ok");
    });

    it("aborts a hung request once the timeout elapses", async () => {
      vi.stubGlobal("fetch", (_url: string, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        });
      });
      const runtime = createPluginRuntime(PKG);
      await expect(runtime.fetch("https://api.example.com/slow", { timeoutMs: 5 })).rejects.toThrow(/aborted/);
    });
  });

  describe("fetchJson", () => {
    it("returns the raw body when no parse is given", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json({ a: 1 })),
      );
      expect(await createPluginRuntime(PKG).fetchJson("https://api.example.com/x")).toEqual({ a: 1 });
    });

    it("passes the body through parse when given", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json({ a: 1 })),
      );
      const parsed = await createPluginRuntime(PKG).fetchJson("https://api.example.com/x", {
        parse: (raw) => ({ wrapped: raw }),
      });
      expect(parsed).toEqual({ wrapped: { a: 1 } });
    });

    it("surfaces a rejecting parse to the plugin", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json({ a: 1 })),
      );
      const failing = createPluginRuntime(PKG).fetchJson("https://api.example.com/x", {
        parse: () => {
          throw new Error("schema mismatch");
        },
      });
      await expect(failing).rejects.toThrow(/schema mismatch/);
    });
  });

  it("exposes a locale and a prefixed logger", () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    const runtime = createPluginRuntime(PKG);
    runtime.log.debug("hello", { n: 1 });
    expect(debug).toHaveBeenCalledWith(`[plugin/${PKG}] hello`, { n: 1 });
    expect(runtime.locale).toMatch(/^[a-zA-Z]/);
  });

  it("refuses to build a runtime before boot injects the workspace", async () => {
    initPluginRuntime({ workspace: "" });
    await expect(createPluginRuntime(PKG).files.data.read("x")).rejects.toThrow(/not initialised/);
  });
});
