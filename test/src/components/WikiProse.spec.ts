import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { createApp, defineComponent } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import type { WikiGraph } from "@mulmoclaude/core/wiki";
import { router } from "../../../src/router/index";
import WikiProse from "../../../src/components/WikiProse.vue";
import WikiPageView from "../../../src/components/WikiPageView.vue";
import WikiBrowseOverlay from "../../../src/components/WikiBrowseOverlay.vue";

// The lint report names broken links, so its body carries `[[…]]` spans just like a page body.
const LINT_REPORT = "# Wiki Lint Report\n\n1 issue found:\n\n- **Broken link** in `alpha.md`: [[Meeting Notes]] → not found";

vi.mock("../../../src/wikiApi", () => ({
  fetchWikiIndex: () => Promise.resolve({ content: "", entries: [] }),
  fetchWikiPage: (slug: string) => Promise.resolve({ filePath: `${slug}.md`, content: "Body with [[Meeting Notes]].", exists: true, resolvedTitle: slug }),
  fetchWikiGraph: () => Promise.resolve(GRAPH),
  fetchWikiLint: () => Promise.resolve({ issues: ["- **Broken link**"], report: LINT_REPORT }),
}));

// "Meeting Notes" slugifies to `meeting-notes`, but its file is `notes-2026` — resolving it
// needs the graph's title map, which is why the lint view fetches the graph too.
const GRAPH: WikiGraph = { nodes: [{ slug: "notes-2026", title: "Meeting Notes" }], edges: [] };

beforeAll(async () => {
  createApp(defineComponent({ render: () => null })).use(router);
  await router.isReady();
});

beforeEach(async () => {
  await router.replace("/terminals");
  await flushPromises();
});

const mountProse = (graph: WikiGraph | null = GRAPH) => mount(WikiProse, { props: { markdown: "See [[Meeting Notes]] and text.", graph } });

describe("WikiProse", () => {
  // The container class is what src/style.css's single wiki rule set hangs off. Two containers
  // with two rule sets is how the page and the lint report drifted apart in the first place (#1125).
  it("renders into the .wiki-body container", () => {
    expect(mountProse().find("div").classes()).toContain("wiki-body");
  });

  // The prop is markdown, not HTML, so the only thing v-html ever receives is
  // renderWikiHtml's sanitized output — a caller cannot hand it a string of its own.
  it("renders the markdown itself rather than trusting caller-supplied HTML", () => {
    const w = mount(WikiProse, { props: { markdown: "**bold** <script>alert(1)</script>", graph: null } });
    expect(w.find("strong").text()).toBe("bold");
    expect(w.html()).not.toContain("<script>");
  });

  it("navigates on click, resolving the target through the graph's title map", async () => {
    await mountProse().find(".wiki-link").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/wiki/pages/notes-2026");
  });

  it.each(["Enter", " "])("navigates on %s so the focusable span is actually activatable", async (key) => {
    await mountProse().find(".wiki-link").trigger("keydown", { key });
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/wiki/pages/notes-2026");
  });

  it("ignores clicks and keys outside a link", async () => {
    const before = router.currentRoute.value.path;
    const w = mountProse();
    await w.find(".wiki-body").trigger("click");
    await w.find(".wiki-link").trigger("keydown", { key: "a" });
    await flushPromises();
    expect(router.currentRoute.value.path).toBe(before);
  });

  // Without a graph the resolver falls back to slugifying the raw target itself.
  it("falls back to the slugified target when no graph is loaded", async () => {
    await mountProse(null).find(".wiki-link").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/wiki/pages/meeting-notes");
  });
});

// #1125: the page body and the lint report are one surface, so they must go through one
// component — the guarantee that a wiki link looks and behaves the same in both.
describe("the wiki views that render markdown", () => {
  it("renders a page body through WikiProse", () => {
    const page = { filePath: "alpha.md", content: "See [[Meeting Notes]].", exists: true, resolvedTitle: "Alpha" };
    const w = mount(WikiPageView, { props: { slug: "alpha", page, graph: GRAPH } });
    expect(w.findComponent(WikiProse).props("markdown")).toBe(page.content);
  });

  it("renders the lint report through WikiProse, with the graph loaded", async () => {
    await router.push({ path: "/wiki/lint" });
    const w = mount(WikiBrowseOverlay);
    await flushPromises();
    const prose = w.findComponent(WikiProse);
    expect(prose.exists()).toBe(true);
    expect(prose.props("graph")).toEqual(GRAPH);
    expect(prose.find(".wiki-link").exists()).toBe(true);
  });
});
