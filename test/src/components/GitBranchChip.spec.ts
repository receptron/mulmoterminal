import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import GitBranchChip from "../../../src/components/GitBranchChip.vue";
import type { GitStatus } from "../../../src/composables/useGitStatus";

const base: GitStatus = { repo: true, branch: "main", detached: false, dirty: 0, ahead: 0, behind: 0, upstream: false };

const render = (status: GitStatus | null, hideDirty = false) => mount(GitBranchChip, { props: { status, hideDirty } });

describe("GitBranchChip", () => {
  it("renders nothing when status is null", () => {
    expect(render(null).find('[data-testid="git-chip"]').exists()).toBe(false);
  });

  it("renders nothing for a non-git dir (repo:false)", () => {
    expect(
      render({ ...base, repo: false, branch: null })
        .find('[data-testid="git-chip"]')
        .exists(),
    ).toBe(false);
  });

  it("shows the branch name on a clean repo", () => {
    const w = render(base);
    expect(w.find('[data-testid="git-chip"]').exists()).toBe(true);
    expect(w.find('[data-testid="git-branch"]').text()).toContain("main");
    expect(w.find('[data-testid="git-dirty"]').exists()).toBe(false);
  });

  it("shows the dirty count when there are uncommitted changes", () => {
    const w = render({ ...base, dirty: 3 });
    expect(w.find('[data-testid="git-dirty"]').text()).toBe("●3");
  });

  it("hides the dirty count when hideDirty is set (worktree cell)", () => {
    const w = render({ ...base, dirty: 3 }, true);
    expect(w.find('[data-testid="git-dirty"]').exists()).toBe(false);
    expect(w.find('[data-testid="git-branch"]').text()).toContain("main");
  });

  it("shows ahead/behind only when an upstream exists", () => {
    const noUpstream = render({ ...base, ahead: 2, behind: 1, upstream: false });
    expect(noUpstream.findAll('[data-testid="git-ab"]')).toHaveLength(0);
    const withUpstream = render({ ...base, ahead: 2, behind: 1, upstream: true });
    const abs = withUpstream.findAll('[data-testid="git-ab"]').map((n) => n.text());
    expect(abs).toEqual(["↑2", "↓1"]);
  });

  it("labels a detached HEAD", () => {
    const w = render({ ...base, branch: null, detached: true });
    expect(w.find('[data-testid="git-branch"]').text()).toContain("detached");
  });
});
