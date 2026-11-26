// The seam that carries "your issue is not being updated" from the server to the cell (#1369).
//
// Worth its own file because a mistake here is invisible everywhere else: the poll swallowed this
// response entirely before, and if the field name drifted, `postWorkComment` would go back to
// swallowing it while every other spec still passed.
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { ref } from "vue";
import { useWorkItem } from "../../../src/composables/useWorkItem";
import { setIssueWorkComments } from "../../../src/composables/issueWorkComments";
import { dirKeyOf } from "../../../src/composables/dirAddress";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  setIssueWorkComments(false);
  vi.restoreAllMocks();
});
beforeEach(() => setIssueWorkComments(true));

const PHASE = { phase: "none", pr: null, issue: 1234, issueUrl: "https://github.com/o/r/issues/1234" };

// The phase poll answers the same thing every time; only what /api/work-comment says varies.
const stubFetch = (workComment: unknown, ok = true) => {
  globalThis.fetch = vi.fn((url: unknown) => {
    const body = String(url).includes("/api/work-comment") ? workComment : PHASE;
    return Promise.resolve({ ok, json: async () => body });
  }) as unknown as typeof fetch;
};

const settle = () => vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(2));

describe("useWorkItem reports why the issue was not updated", () => {
  it("holds the cause the server named", async () => {
    stubFetch({ posted: false, reason: "gh-failed", failure: "permission" });
    const { commentFailure, refresh } = useWorkItem(ref("/dir"));
    await refresh();
    await settle();
    await vi.waitFor(() => expect(commentFailure.value).toBe("permission"));
  });

  it("holds nothing when the comment landed", async () => {
    stubFetch({ posted: true, closed: false });
    const { commentFailure, refresh } = useWorkItem(ref("/dir"));
    await refresh();
    await settle();
    expect(commentFailure.value).toBeNull();
  });

  // The notice has to come back DOWN once the login is fixed, without waiting for a reload — so
  // the next milestone assigns the result rather than only recording a failure.
  it("drops the cause once a later milestone succeeds", async () => {
    let phase: unknown = PHASE;
    let answer: unknown = { posted: false, reason: "gh-failed", failure: "auth" };
    globalThis.fetch = vi.fn((url: unknown) =>
      Promise.resolve({ ok: true, json: async () => (String(url).includes("/api/work-comment") ? answer : phase) }),
    ) as unknown as typeof fetch;

    const { commentFailure, refresh } = useWorkItem(ref("/dir"));
    await refresh();
    await vi.waitFor(() => expect(commentFailure.value).toBe("auth"));

    // A PR appearing is the next milestone this cell watches happen, so it asks again.
    phase = { ...PHASE, pr: 1240 };
    answer = { posted: true, closed: false };
    await refresh();
    await vi.waitFor(() => expect(commentFailure.value).toBeNull());
  });

  // "Nothing to add" and "the setting is off" are not failures, and a notice for either would be
  // reporting a problem that does not exist.
  it("holds nothing when there was simply nothing to say", async () => {
    stubFetch({ posted: false, reason: "already" });
    const { commentFailure, refresh } = useWorkItem(ref("/dir"));
    await refresh();
    await settle();
    expect(commentFailure.value).toBeNull();
  });

  // A cause this build has never heard of comes from a server that is not this one, or is newer
  // than this one — either way the wording switch has no entry for it.
  it("ignores a cause it cannot word", async () => {
    stubFetch({ posted: false, reason: "gh-failed", failure: "teapot" });
    const { commentFailure, refresh } = useWorkItem(ref("/dir"));
    await refresh();
    await settle();
    expect(commentFailure.value).toBeNull();
  });

  // The POST outlives the phase fetch that started it, and `permission` is a per-repository
  // answer — so a cell that moved on must not inherit a verdict about the repo it left.
  it("ignores a cause for a directory the cell has already left", async () => {
    let releaseComment: (body: unknown) => void = () => {};
    const pending = new Promise<unknown>((resolve) => (releaseComment = resolve));
    globalThis.fetch = vi.fn((url: unknown) =>
      String(url).includes("/api/work-comment") ? Promise.resolve({ ok: true, json: () => pending }) : Promise.resolve({ ok: true, json: async () => PHASE }),
    ) as unknown as typeof fetch;

    const dir = ref<string | null>("/dir");
    const { commentFailure, refresh } = useWorkItem(dir);
    await refresh(); // the work-comment POST is now in flight
    dir.value = "/somewhere-else";
    await refresh(); // a newer request supersedes it

    releaseComment({ posted: false, reason: "gh-failed", failure: "permission" });
    await pending;
    await Promise.resolve();
    expect(commentFailure.value).toBeNull();
  });

  // The notice is about an issue in a directory. Once the cell has neither, it would be claiming a
  // problem the user cannot act on from there.
  it("drops the cause when the cell loses its directory", async () => {
    stubFetch({ posted: false, reason: "gh-failed", failure: "permission" });
    const dir = ref<string | null>("/dir");
    const { commentFailure, refresh } = useWorkItem(dir);
    await refresh();
    await vi.waitFor(() => expect(commentFailure.value).toBe("permission"));

    dir.value = null;
    await refresh();
    expect(commentFailure.value).toBeNull();
  });

  it("drops the cause when the branch no longer has an issue", async () => {
    let phase: unknown = PHASE;
    globalThis.fetch = vi.fn((url: unknown) =>
      Promise.resolve({
        ok: true,
        json: async () => (String(url).includes("/api/work-comment") ? { posted: false, reason: "gh-failed", failure: "auth" } : phase),
      }),
    ) as unknown as typeof fetch;

    const { commentFailure, refresh } = useWorkItem(ref("/dir"));
    await refresh();
    await vi.waitFor(() => expect(commentFailure.value).toBe("auth"));

    phase = { ...PHASE, issue: null, issueUrl: null };
    await refresh();
    expect(commentFailure.value).toBeNull();
  });

  // The guard against over-clearing. A cause is recorded on a MILESTONE, and every poll between
  // milestones reports nothing — so clearing whenever no post is attempted would take the notice
  // down one tick after it appeared, restoring the silence this whole feature removes.
  it("keeps the cause through the ordinary polls that report nothing", async () => {
    stubFetch({ posted: false, reason: "gh-failed", failure: "permission" });
    const { commentFailure, refresh } = useWorkItem(ref("/dir"));
    await refresh();
    await vi.waitFor(() => expect(commentFailure.value).toBe("permission"));

    await refresh(); // same issue, no new milestone: nothing to say, nothing to un-say
    await refresh();
    expect(commentFailure.value).toBe("permission");
  });

  // Switching the setting off is exactly what a user reaches for when the notice tells them their
  // login cannot write. Leaving it up afterwards would argue with the switch they just used.
  it("drops the cause when the setting is switched off", async () => {
    stubFetch({ posted: false, reason: "gh-failed", failure: "permission" });
    const { commentFailure, refresh } = useWorkItem(ref("/dir"));
    await refresh();
    await vi.waitFor(() => expect(commentFailure.value).toBe("permission"));

    setIssueWorkComments(false);
    await refresh();
    expect(commentFailure.value).toBeNull();
  });

  it("says nothing at all while the setting is off", async () => {
    setIssueWorkComments(false);
    stubFetch({ posted: false, reason: "gh-failed", failure: "permission" });
    const { commentFailure, refresh } = useWorkItem(ref("/dir"));
    await refresh();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(commentFailure.value).toBeNull();
  });
});

// A remote directory's work item is read through the gateway, but its comment is a write this
// server would post for its own repository, so it is not posted (#3506).
describe("useWorkItem on a remote directory", () => {
  it("reads the phase from the host and posts no comment", async () => {
    stubFetch({ posted: true, closed: false });
    const { item, refresh } = useWorkItem(ref(dirKeyOf("lx", "/srv/p")));
    await refresh();
    await vi.waitFor(() => expect(item.value.issue).toBe(1234));
    const urls = vi.mocked(globalThis.fetch).mock.calls.map(([url]) => String(url));
    expect(urls).toEqual(["/remote/lx/api/pr-phase?cwd=%2Fsrv%2Fp"]);
  });
});
