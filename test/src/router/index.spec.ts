import { describe, it, expect } from "vitest";
import { createRouter, createMemoryHistory } from "vue-router";
import { router, routes } from "../../../src/router/index";

describe("router route table", () => {
  it("resolves the top-level surfaces to their names", () => {
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

  // `/` is the default-view entry, not a screen: what it lands on is the one line that
  // decides which view the app opens on (#883).
  it("opens the grid at the root", async () => {
    const mem = createRouter({ history: createMemoryHistory(), routes });
    await mem.push("/");
    expect(mem.currentRoute.value.name).toBe("terminals");
  });

  it("redirects unknown paths through the root, so they follow the default view", async () => {
    // Use an isolated memory-history router so navigation (which follows redirects)
    // doesn't touch the shared singleton / jsdom history.
    const mem = createRouter({ history: createMemoryHistory(), routes });
    await mem.push("/this/does/not/exist");
    expect(mem.currentRoute.value.name).toBe("terminals");
  });
});
