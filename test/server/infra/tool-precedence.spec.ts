import { describe, it, expect } from "vitest";

import { resolvePluginTools } from "../../../server/infra/tool-precedence.js";

interface FakePlugin {
  toolName: string;
  from: string;
}

const plugin = (toolName: string, from: string): FakePlugin => ({ toolName, from });
const nameOf = (p: FakePlugin) => p.toolName;
const HOSTS = ["spawnBackgroundChat", "manageAccounting", "manageCollection"];

const resolve = (plugins: FakePlugin[], hosts: string[] = HOSTS) => resolvePluginTools(plugins, nameOf, hosts);
const dispatchedNames = (plugins: FakePlugin[], hosts?: string[]) => resolve(plugins, hosts).dispatched.map(nameOf);

describe("resolvePluginTools", () => {
  describe("with no collision", () => {
    it("dispatches every plugin, in the order they were loaded", () => {
      const plugins = [plugin("presentHtml", "a"), plugin("presentForm", "b"), plugin("presentMulmoScript", "c")];
      expect(dispatchedNames(plugins)).toEqual(["presentHtml", "presentForm", "presentMulmoScript"]);
    });

    it("reports nothing", () => {
      expect(resolve([plugin("presentHtml", "a")]).collisions).toEqual([]);
    });
  });

  // A package taking a host tool's name is the case with teeth: the host route is mounted
  // first, so the plugin can never run — but its definition used to be advertised anyway,
  // leaving the tool list describing a package while the built-in answered.
  describe("when a plugin claims a host tool's name", () => {
    it("does not dispatch it", () => {
      const plugins = [plugin("presentHtml", "a"), plugin("manageCollection", "evil")];
      expect(dispatchedNames(plugins)).toEqual(["presentHtml"]);
    });

    it("reports that the host tool keeps the name", () => {
      const plugins = [plugin("manageCollection", "evil")];
      expect(resolve(plugins).collisions).toEqual([{ name: "manageCollection", shadowedBy: "host" }]);
    });

    it("drops it wherever it sits in the load order", () => {
      const plugins = [plugin("manageAccounting", "first"), plugin("presentHtml", "a"), plugin("spawnBackgroundChat", "last")];
      expect(dispatchedNames(plugins)).toEqual(["presentHtml"]);
    });

    it("drops every plugin claiming it, not just one", () => {
      const plugins = [plugin("manageCollection", "a"), plugin("manageCollection", "b")];
      expect(resolve(plugins).dispatched).toEqual([]);
      expect(resolve(plugins).collisions).toEqual([
        { name: "manageCollection", shadowedBy: "host" },
        { name: "manageCollection", shadowedBy: "host" },
      ]);
    });
  });

  // The dispatch map is built with Object.fromEntries, so the last claimant already won it.
  // What changes is that the losers are no longer advertised as if they might answer.
  describe("when two plugins claim the same name", () => {
    it("dispatches the last one to declare it", () => {
      const plugins = [plugin("presentHtml", "old"), plugin("presentHtml", "new")];
      expect(resolve(plugins).dispatched).toEqual([plugin("presentHtml", "new")]);
    });

    it("reports the earlier one as shadowed", () => {
      const plugins = [plugin("presentHtml", "old"), plugin("presentHtml", "new")];
      expect(resolve(plugins).collisions).toEqual([{ name: "presentHtml", shadowedBy: "plugin" }]);
    });

    it("keeps only the last of three", () => {
      const plugins = [plugin("x", "1"), plugin("x", "2"), plugin("x", "3")];
      expect(resolve(plugins).dispatched).toEqual([plugin("x", "3")]);
      expect(resolve(plugins).collisions).toHaveLength(2);
    });

    it("leaves the other plugins where they are", () => {
      const plugins = [plugin("a", "1"), plugin("dup", "old"), plugin("b", "2"), plugin("dup", "new")];
      expect(dispatchedNames(plugins)).toEqual(["a", "b", "dup"]);
    });
  });

  // The property the whole resolution exists for: the advertised list is built from
  // `dispatched`, so anything in it must be able to answer.
  describe("what survives can always answer", () => {
    it("never dispatches a name twice", () => {
      const plugins = [plugin("dup", "1"), plugin("dup", "2"), plugin("dup", "3"), plugin("other", "x")];
      const names = dispatchedNames(plugins);
      expect(new Set(names).size).toBe(names.length);
    });

    it("never dispatches a name a host tool owns", () => {
      const plugins = HOSTS.map((name) => plugin(name, "pkg")).concat(plugin("fine", "a"));
      expect(dispatchedNames(plugins).filter((name) => HOSTS.includes(name))).toEqual([]);
    });
  });

  describe("empty cases", () => {
    it("resolves an empty plugin list", () => {
      expect(resolve([])).toEqual({ dispatched: [], collisions: [] });
    });

    it("dispatches everything when there are no host tools", () => {
      expect(dispatchedNames([plugin("manageCollection", "a")], [])).toEqual(["manageCollection"]);
    });
  });
});
