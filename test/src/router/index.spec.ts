import { describe, it, expect } from "vitest";
import { createRouter, createMemoryHistory } from "vue-router";
import { router, routes } from "../../../src/router/../../src/router/index";

describe("router route table", () => {
  it("resolves the top-level surfaces to their names", () => {
    expect(router.resolve("/").name).toBe("chat");
    expect(router.resolve("/terminals").name).toBe("terminals");
    expect(router.resolve("/collections").name).toBe("collections");
    expect(router.resolve("/feeds").name).toBe("feeds");
    expect(router.resolve("/accounting").name).toBe("accounting");
  });

  it("parses :slug for the detail routes", () => {
    const c = router.resolve("/collections/todos");
    expect(c.name).toBe("collectionDetail");
    expect(c.params.slug).toBe("todos");

    const f = router.resolve("/feeds/tech-news");
    expect(f.name).toBe("feedDetail");
    expect(f.params.slug).toBe("tech-news");
  });

  it("redirects unknown paths to chat (/)", async () => {
    // Use an isolated memory-history router so navigation (which follows redirects)
    // doesn't touch the shared singleton / jsdom history.
    const mem = createRouter({ history: createMemoryHistory(), routes });
    await mem.push("/this/does/not/exist");
    expect(mem.currentRoute.value.name).toBe("chat");
    expect(mem.currentRoute.value.path).toBe("/");
  });
});
