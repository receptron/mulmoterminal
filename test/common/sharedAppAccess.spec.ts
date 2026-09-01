import { describe, it, expect } from "vitest";
import { sharedAppAccessOf, type AccessSubject, type CollectionAccess, type SharedAppAccess } from "../../common/sharedAppAccess";

// The panel is a transcription of `firestore.rules`, so these cases are the SHAPES the matrix in
// mulmoserver's `test/rules/rules_matrix.ts` measures against the emulator: an invite-only app, an
// anonymous survey, a blog. What is pinned here is that the summary says the same thing the rules
// answer — a table that disagrees with the deployment is worse than no table.

/** The one collection under test, or a failure that names it — a `find` returning undefined would
 *  otherwise surface as "cannot read property access of undefined" three assertions later. */
function only(access: SharedAppAccess, cid: string): CollectionAccess {
  const found = access.collections.find((entry) => entry.cid === cid);
  if (found === undefined) throw new Error(`no collection ${cid} in the summary`);
  return found;
}
const reaches = (access: SharedAppAccess, cid: string, subject: AccessSubject): boolean => {
  const entry = only(access, cid).access[subject];
  return entry.read !== "none" || entry.create || entry.editOwn || entry.editAll;
};

const ROSTER = {
  members: {
    "owner@example.com": { "*": "owner" },
    "member@example.com": { "*": "participant" },
  },
};

describe("an INVITE-ONLY app — the #1926 shape", () => {
  // `public.submit` is declared and `public.enabled` is not. That is the NORMAL invite-only app:
  // the roster's own pages have no other way to write a record. It is not an app half-way to being
  // opened, and the panel must not read it as one.
  const app = {
    ...ROSTER,
    collections: { records: { statusField: "status" } },
    participantRead: ["records"],
  };
  const block = {
    submit: {
      records: { auth: "verifiedEmail", emailField: "by", createFields: ["by", "note", "status"], initialStatus: "new", selfUpdate: { new: ["note"] } },
    },
  };
  const access = sharedAppAccessOf(app, block, ["records"]);

  it("calls the app closed even though it declares a public submit", () => {
    expect(access.publicFace).toBe("declared");
  });

  it("gives a signed-in STRANGER nothing at all", () => {
    // The whole point. The aid and the cid are world-readable, so a summary that let this cell
    // read as anything but empty would be describing the hole #1926's fix closed.
    expect(only(access, "records").access.stranger).toEqual({ read: "none", create: false, editOwn: false, editAll: false });
    expect(reaches(access, "records", "stranger")).toBe(false);
  });

  it("gives a visitor with no account nothing either", () => {
    expect(reaches(access, "records", "visitor")).toBe(false);
  });

  it("lets a participant read the collection and edit their own row", () => {
    expect(only(access, "records").access.participant).toEqual({ read: "all", create: true, editOwn: true, editAll: false });
  });

  it("lets an owner do anything", () => {
    expect(only(access, "records").access.writer).toEqual({ read: "all", create: true, editOwn: true, editAll: true });
  });

  it("counts the people the roster actually puts in each row", () => {
    expect(only(access, "records").census).toEqual({ writers: 1, readers: 0, participants: 1 });
  });
});

describe("an app whose switch is ON", () => {
  const app = { ...ROSTER, collections: { answers: { statusField: "status" } } };
  const block = {
    enabled: true,
    read: [],
    submit: { answers: { auth: "anonymous", uidField: "uid", createFields: ["uid", "answer", "status"], initialStatus: "in" } },
  };
  const access = sharedAppAccessOf(app, block, ["answers"]);

  it("takes an anonymous visitor's submission, since `anonymous` is satisfied by the session the public page holds", () => {
    expect(only(access, "answers").access.visitor).toEqual({ read: "own", create: true, editOwn: false, editAll: false });
  });

  it("keeps everyone else's rows out of sight — nothing is in `public.read`", () => {
    expect(only(access, "answers").access.stranger.read).toBe("own");
    expect(access.publicFace).toBe("open");
  });

  it("opens the whole collection once it is named in `public.read`", () => {
    const opened = sharedAppAccessOf(app, { ...block, read: ["answers"] }, ["answers"]);
    expect(only(opened, "answers").access.visitor.read).toBe("all");
  });

  it("refuses a visitor who has no verified address when the stage asks for one", () => {
    const strict = sharedAppAccessOf(app, { ...block, submit: { answers: { ...block.submit.answers, auth: "verifiedEmail" } } }, ["answers"]);
    expect(only(strict, "answers").access.visitor.create).toBe(false);
    expect(only(strict, "answers").access.stranger.create).toBe(true);
  });
});

describe("a BLOG — the writer edits their own article forever", () => {
  // Modelled on `apps/ai-blogs`: a single status, no transitions, `audience: "participant"`, and
  // `submitOnly` so even an editor writes through the same path everybody else does.
  const app = {
    members: { "owner@example.com": { "*": "owner", articles: "participant" }, "writer@example.com": { "*": "participant" } },
    collections: { articles: { statusField: "status", submitOnly: true } },
  };
  const block = {
    enabled: true,
    read: ["articles"],
    submit: {
      articles: {
        auth: "verifiedEmail",
        audience: "participant",
        emailField: "by",
        createFields: ["by", "body", "status"],
        initialStatus: "published",
        selfUpdate: { published: ["body"] },
        selfDelete: ["published"],
      },
    },
  };
  const access = sharedAppAccessOf(app, block, ["articles"]);

  it("lets the world read the articles and write nothing", () => {
    expect(only(access, "articles").access.visitor).toEqual({ read: "all", create: false, editOwn: false, editAll: false });
    expect(only(access, "articles").access.stranger).toEqual({ read: "all", create: false, editOwn: false, editAll: false });
  });

  it("lets a participant publish and go on editing what they published", () => {
    expect(only(access, "articles").access.participant).toEqual({ read: "all", create: true, editOwn: true, editAll: false });
  });

  it('shuts a writer out of `audience: "participant"` and out of creating at all, because the collection is submitOnly', () => {
    expect(only(access, "articles").access.writer.create).toBe(false);
    expect(only(access, "articles").access.writer.editAll).toBe(true);
  });
});

describe("the submission window, evaluated rather than mentioned", () => {
  const app = { members: {}, collections: { topics: { statusField: "status" } } };
  const block = (window: Record<string, unknown>) => ({
    enabled: true,
    read: ["topics"],
    submit: { topics: { auth: "anonymous", uidField: "uid", createFields: ["uid", "status"], initialStatus: "open", window } },
  });
  const NOW = Date.UTC(2026, 8, 1);

  it("shuts the door on a window that has closed", () => {
    // `apps/roles` seals all three of its collections with `window.until` in the year 2000. A
    // summary that only said "there is a window" reported an open board nobody can post to.
    const access = sharedAppAccessOf(app, block({ untilMs: Date.UTC(2000, 0, 1) }), ["topics"], NOW);
    expect(only(access, "topics").access.visitor.create).toBe(false);
    expect(only(access, "topics").caveats[0]).toContain("has CLOSED");
  });

  it("shuts it on a window that has not opened", () => {
    const access = sharedAppAccessOf(app, block({ fromMs: Date.UTC(2030, 0, 1) }), ["topics"], NOW);
    expect(only(access, "topics").access.visitor.create).toBe(false);
    expect(only(access, "topics").caveats[0]).toContain("not opened yet");
  });

  it("leaves it open inside the window, and says the window is there", () => {
    const access = sharedAppAccessOf(app, block({ fromMs: Date.UTC(2020, 0, 1), untilMs: Date.UTC(2030, 0, 1) }), ["topics"], NOW);
    expect(only(access, "topics").access.visitor.create).toBe(true);
    expect(only(access, "topics").caveats[0]).toContain("open right now");
  });

  it("refuses to guess when the bound lives on another record", () => {
    const access = sharedAppAccessOf(app, block({ fromField: { collection: "classes", ref: "classId", field: "opensAt" } }), ["topics"], NOW);
    // Neither answer is available, so the table keeps the wider one and the caveat says why.
    expect(only(access, "topics").access.visitor.create).toBe(true);
    expect(only(access, "topics").caveats[0]).toContain("cannot say whether any one of them is open");
  });
});

describe("what the summary refuses to overstate", () => {
  it("keeps the stranded-row caveat off a collection the switch could never have opened", () => {
    // `audience: "participant"` refuses an outsider whatever `public.enabled` says, so there was no
    // open period for anyone to have submitted in. The caveat fired here against `apps/ai-blogs`.
    const access = sharedAppAccessOf(
      { members: {}, collections: { articles: { statusField: "status" } } },
      {
        enabled: true,
        read: ["articles"],
        submit: { articles: { auth: "verifiedEmail", audience: "participant", emailField: "by", createFields: ["by", "status"] } },
      },
      ["articles"],
    );
    expect(only(access, "articles").caveats).toEqual([]);
  });

  it("does not claim an own row for someone who could never create one", () => {
    // `emailField` reaches every verified account in the world. Without the creatability gate this
    // cell reads "own rows" for a stranger who has no way to make one — an alarm in the panel that
    // exists to answer exactly this question.
    const access = sharedAppAccessOf({ members: {} }, { submit: { records: { auth: "verifiedEmail", emailField: "by", createFields: ["by"] } } }, ["records"]);
    expect(only(access, "records").access.stranger.read).toBe("none");
    expect(only(access, "records").caveats).toContain(
      "Anyone who submitted while this collection was open still reads and edits that row of theirs, whatever it says above.",
    );
  });

  it("does not hand an emailField row to the visitor, who has a uid and no verified address", () => {
    // `auth: "none"` lets them submit, so the creatability gate is open; what stops them reaching
    // the row afterwards is `ownRow`'s `verified()` on the `emailField` branch, and nothing else.
    const access = sharedAppAccessOf(
      { members: {}, collections: { rsvps: { statusField: "status" } } },
      { enabled: true, submit: { rsvps: { auth: "none", emailField: "by", createFields: ["by", "status"], initialStatus: "in", selfUpdate: { in: ["by"] } } } },
      ["rsvps"],
    );
    expect(only(access, "rsvps").access.visitor).toEqual({ read: "none", create: true, editOwn: false, editAll: false });
    expect(only(access, "rsvps").access.stranger).toEqual({ read: "own", create: true, editOwn: true, editAll: false });
  });

  it("says nobody may edit anything when the collection is immutable", () => {
    const access = sharedAppAccessOf(
      { members: ROSTER.members, collections: { log: { statusField: "status", immutable: true } } },
      { enabled: true, read: ["log"], submit: { log: { auth: "none", uidField: "uid", createFields: ["uid", "status"], selfUpdate: { new: ["uid"] } } } },
      ["log"],
    );
    expect(only(access, "log").access.writer.editAll).toBe(false);
    expect(only(access, "log").access.visitor.editOwn).toBe(false);
  });

  it("grants no self-edit without a statusField, which is what the rules fail closed on", () => {
    const access = sharedAppAccessOf(
      { members: ROSTER.members },
      { enabled: true, submit: { notes: { auth: "none", uidField: "uid", createFields: ["uid"], selfUpdate: { "*": ["uid"] } } } },
      ["notes"],
    );
    expect(only(access, "notes").access.visitor.editOwn).toBe(false);
  });

  it("opens a collection to the whole roster through participantRead and peerVisibility", () => {
    const access = sharedAppAccessOf({ members: ROSTER.members, collections: { votes: { peerVisibility: "public" } }, participantRead: ["notes"] }, undefined, [
      "votes",
      "notes",
    ]);
    expect(only(access, "votes").access.participant.read).toBe("all");
    expect(only(access, "votes").access.stranger.read).toBe("none");
    expect(only(access, "notes").access.participant.read).toBe("all");
    expect(access.publicFace).toBe("none");
  });

  it("lists a collection that declares nothing at all, rather than leaving it out", () => {
    // A collection with no rule configuration, no public read and no submit is precisely the one
    // whose absence would be read as "not published".
    const access = sharedAppAccessOf({ members: ROSTER.members }, undefined, ["quiet"]);
    expect(only(access, "quiet").takesSubmissions).toBe(false);
    expect(reaches(access, "quiet", "stranger")).toBe(false);
    expect(only(access, "quiet").access.writer.read).toBe("all");
  });
});
