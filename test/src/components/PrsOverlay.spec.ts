import { describe, it, expect, vi } from "vitest";
import { ref } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import PrsOverlay from "../../src/components/PrsOverlay.vue";

// The view is route-driven; stub usePrsView so the overlay is "open" without a router.
vi.mock("../composables/usePrsView", () => ({
  usePrsView: () => ({ isOpen: ref(true), close: vi.fn() }),
}));

type Repo = { repo: string; prs?: unknown[]; error?: string; truncated?: boolean };
type IssueRepo = { repo: string; issues?: unknown[]; error?: string; truncated?: boolean; url?: string };

// The overlay fetches /api/prs and /api/issues in parallel; route the mock by path.
// opts.failPrs / opts.failIssues make that endpoint return a non-ok response.
function mockFetch(prs: Repo[], issues: IssueRepo[] = [], opts: { failPrs?: boolean; failIssues?: boolean } = {}) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const isIssues = String(input).includes("/api/issues");
    if ((isIssues && opts.failIssues) || (!isIssues && opts.failPrs)) {
      return { ok: false, status: 500, json: async () => ({}) };
    }
    return { ok: true, json: async () => ({ repos: isIssues ? issues : prs }) };
  }) as unknown as typeof fetch;
}

function pr(number: number, title: string) {
  return { number, title, author: "alice", updatedAt: new Date().toISOString(), isDraft: false, url: `u${number}`, review: null, ci: "none" };
}

describe("PrsOverlay", () => {
  it("groups repos and lists their open PRs", async () => {
    mockFetch([
      {
        repo: "octo/hello",
        prs: [
          {
            number: 3,
            title: "fix the bug",
            author: "alice",
            updatedAt: new Date().toISOString(),
            isDraft: false,
            url: "u3",
            review: "APPROVED",
            ci: "passing",
          },
        ],
        truncated: true,
      },
      { repo: "octo/empty", prs: [] },
    ]);
    const w = mount(PrsOverlay);
    await flushPromises();
    expect(w.text()).toContain("octo/hello");
    expect(w.text()).toContain("#3");
    expect(w.text()).toContain("fix the bug");
    expect(w.text()).toContain("approved");
    expect(w.text()).toContain("more open PRs"); // truncation note
    expect(w.text()).toContain("No open PRs"); // octo/empty
    // Rows are real links (right-click / new-tab / ⌘-click work), not JS buttons.
    const row = w.get("a.prs-row");
    expect(row.attributes("href")).toBe("u3");
    expect(row.attributes("target")).toBe("_blank");
    expect(row.attributes("rel")).toContain("noopener");
  });

  it("lists open issues below the PRs and links to GitHub when truncated", async () => {
    mockFetch(
      [{ repo: "octo/hello", prs: [] }],
      [
        {
          repo: "octo/hello",
          issues: [{ number: 42, title: "flaky test", author: "bob", updatedAt: new Date().toISOString(), url: "https://github.com/octo/hello/issues/42" }],
          truncated: true,
          url: "https://github.com/octo/hello/issues",
        },
        { repo: "octo/quiet", issues: [] },
      ],
    );
    const w = mount(PrsOverlay);
    await flushPromises();
    expect(w.text()).toContain("Issues");
    expect(w.text()).toContain("#42");
    expect(w.text()).toContain("flaky test");
    expect(w.text()).toContain("No open issues"); // octo/quiet
    expect(w.get("a.prs-row").attributes("href")).toBe("https://github.com/octo/hello/issues/42"); // issue row is a real link
    const seeAll = w.get("a.prs-link");
    expect(seeAll.attributes("href")).toBe("https://github.com/octo/hello/issues");
    expect(seeAll.text()).toContain("see all open issues");
  });

  it("keeps rendering one section when the other endpoint fails", async () => {
    // /api/issues fails → PRs must still render, issue section shows its own error.
    mockFetch([{ repo: "octo/hello", prs: [pr(3, "still visible")] }], [], { failIssues: true });
    const w1 = mount(PrsOverlay);
    await flushPromises();
    expect(w1.text()).toContain("still visible"); // PR dashboard not blanked
    expect(w1.text()).toContain("HTTP 500"); // issue section error

    // Reverse: /api/prs fails → issues still render.
    mockFetch([], [{ repo: "octo/hello", issues: [{ number: 9, title: "issue shows", author: "bob", updatedAt: new Date().toISOString(), url: "u9" }] }], {
      failPrs: true,
    });
    const w2 = mount(PrsOverlay);
    await flushPromises();
    expect(w2.text()).toContain("issue shows");
    expect(w2.text()).toContain("HTTP 500");
  });

  it("shows a per-repo error", async () => {
    mockFetch([{ repo: "octo/x", error: "no access" }]);
    const w = mount(PrsOverlay);
    await flushPromises();
    expect(w.text()).toContain("no access");
  });

  it("hints to configure repos when none are set", async () => {
    mockFetch([]);
    const w = mount(PrsOverlay);
    await flushPromises();
    expect(w.text()).toContain("No repositories configured");
  });
});
