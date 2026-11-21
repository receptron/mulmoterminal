import { describe, it, expect, vi } from "vitest";
import { ref } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import GithubPane from "../../../src/components/GithubPane.vue";

// The pane is no longer route-driven — it fetches on mount — so there is nothing to stub for it
// to be "open". What remains stubbed is only what a router would otherwise be needed for.
vi.mock("../../../src/composables/useGithubView", () => ({
  useGithubView: () => ({ isOpen: ref(true), close: vi.fn() }),
}));

type Repo = { repo: string; prs?: unknown[]; error?: string; truncated?: boolean; unregistered?: boolean };
type IssueRepo = { repo: string; issues?: unknown[]; error?: string; truncated?: boolean; url?: string; unregistered?: boolean };

// The overlay fetches /api/prs and /api/issues in parallel; route the mock by path.
// opts.failPrs / opts.failIssues make that endpoint return a non-ok response.
function mockFetch(prs: Repo[], issues: IssueRepo[] = [], opts: { failPrs?: boolean; failIssues?: boolean; repoDirs?: unknown[] } = {}) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    // The issue rows' start control reads the reverse map to know which repos have a clone here.
    if (path.includes("/api/repo-dirs")) return { ok: true, json: async () => ({ repos: opts.repoDirs ?? [] }) };
    const isIssues = path.includes("/api/issues");
    if ((isIssues && opts.failIssues) || (!isIssues && opts.failPrs)) {
      return { ok: false, status: 500, json: async () => ({}) };
    }
    return { ok: true, json: async () => ({ repos: isIssues ? issues : prs }) };
  }) as unknown as typeof fetch;
}

function pr(number: number, title: string) {
  return { number, title, author: "alice", updatedAt: new Date().toISOString(), isDraft: false, url: `u${number}`, review: null, ci: "none" };
}

describe("GithubPane", () => {
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
    const w = mount(GithubPane);
    await flushPromises();
    expect(w.text()).toContain("octo/hello");
    expect(w.text()).toContain("#3");
    expect(w.text()).toContain("fix the bug");
    expect(w.text()).toContain("approved");
    expect(w.text()).toContain("more open PRs"); // truncation note
    expect(w.text()).toContain("No open PRs"); // octo/empty
    // Rows are real links (right-click / new-tab / ⌘-click work), not JS buttons.
    const row = w.get('[data-testid="prs-row"]');
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
    const w = mount(GithubPane);
    await flushPromises();
    expect(w.text()).toContain("Issues");
    expect(w.text()).toContain("#42");
    expect(w.text()).toContain("flaky test");
    expect(w.text()).toContain("No open issues"); // octo/quiet
    expect(w.get('[data-testid="prs-row"]').attributes("href")).toBe("https://github.com/octo/hello/issues/42"); // issue row is a real link
    const seeAll = w.get('[data-testid="prs-link"]');
    expect(seeAll.attributes("href")).toBe("https://github.com/octo/hello/issues");
    expect(seeAll.text()).toContain("see all open issues");
  });

  it("keeps rendering one section when the other endpoint fails", async () => {
    // /api/issues fails → PRs must still render, issue section shows its own error.
    mockFetch([{ repo: "octo/hello", prs: [pr(3, "still visible")] }], [], { failIssues: true });
    const w1 = mount(GithubPane);
    await flushPromises();
    expect(w1.text()).toContain("still visible"); // PR dashboard not blanked
    expect(w1.text()).toContain("HTTP 500"); // issue section error

    // Reverse: /api/prs fails → issues still render.
    mockFetch([], [{ repo: "octo/hello", issues: [{ number: 9, title: "issue shows", author: "bob", updatedAt: new Date().toISOString(), url: "u9" }] }], {
      failPrs: true,
    });
    const w2 = mount(GithubPane);
    await flushPromises();
    expect(w2.text()).toContain("issue shows");
    expect(w2.text()).toContain("HTTP 500");
  });

  it("shows a per-repo error", async () => {
    mockFetch([{ repo: "octo/x", error: "no access" }]);
    const w = mount(GithubPane);
    await flushPromises();
    expect(w.text()).toContain("no access");
  });

  it("hints to configure repos when none are set", async () => {
    mockFetch([]);
    const w = mount(GithubPane);
    await flushPromises();
    expect(w.text()).toContain("No repositories configured");
  });

  it("shows the loading state where the lists go until the first read answers", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    mockFetch([{ repo: "octo/a", prs: [pr(1, "first")] }]);
    const answer = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        await gate;
        return answer(input);
      }),
    );
    const w = mount(GithubPane);
    await flushPromises();
    expect(w.find('[data-testid="github-loading"]').exists()).toBe(true);
    expect(w.text()).not.toContain("No repositories configured");
    expect(w.get('[data-testid="github-refresh"] .material-symbols-outlined').classes()).toContain("animate-spin");
    release();
    await flushPromises();
    expect(w.find('[data-testid="github-loading"]').exists()).toBe(false);
    expect(w.get('[data-testid="github-refresh"] .material-symbols-outlined').classes()).not.toContain("animate-spin");
    expect(w.text()).toContain("first");
  });

  it("keeps the lists on screen while reading again, spinning the reload button", async () => {
    mockFetch([{ repo: "octo/a", prs: [pr(1, "first")] }]);
    const w = mount(GithubPane);
    await flushPromises();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {})),
    );
    await w.get('[data-testid="github-refresh"]').trigger("click");
    expect(w.find('[data-testid="github-loading"]').exists()).toBe(false);
    expect(w.text()).toContain("first");
    expect(w.get('[data-testid="github-refresh"]').attributes("aria-busy")).toBe("true");
    expect(w.get('[data-testid="github-refresh"] .material-symbols-outlined').classes()).toContain("animate-spin");
  });

  it("tags an unregistered repo in both lists, and only that one", async () => {
    mockFetch(
      [
        { repo: "octo/hello", prs: [] },
        { repo: "octo/live", prs: [], unregistered: true },
      ],
      [
        { repo: "octo/hello", issues: [] },
        { repo: "octo/live", issues: [], unregistered: true },
      ],
    );
    const w = mount(GithubPane);
    await flushPromises();
    const headingOf = (tag: string): string[] => w.findAll(`[data-testid="${tag}"]`).map((t) => t.element.parentElement?.textContent ?? "");
    expect(headingOf("prs-repo-unregistered")).toEqual([expect.stringContaining("octo/live")]);
    expect(headingOf("issues-repo-unregistered")).toEqual([expect.stringContaining("octo/live")]);
  });

  it("lists repos in the configured order", async () => {
    mockFetch([
      { repo: "octo/first", prs: [pr(1, "one")] },
      { repo: "octo/second", prs: [pr(2, "two")] },
    ]);
    const w = mount(GithubPane);
    await flushPromises();
    const headings = w.findAll("h3").map((h) => h.text());
    expect(headings[0]).toContain("octo/first");
    expect(headings[1]).toContain("octo/second");
  });

  it("closes, and offers no control to widen it over a terminal", async () => {
    mockFetch([{ repo: "octo/first", prs: [pr(1, "one")] }]);
    const w = mount(GithubPane);
    await flushPromises();
    expect(w.find('[data-testid="github-expand-btn"]').exists()).toBe(false);
    await w.get('[aria-label="Close GitHub pane"]').trigger("click");
    expect(w.emitted("close")).toBeTruthy();
  });
});
