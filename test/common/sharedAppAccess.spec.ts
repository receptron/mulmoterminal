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
    expect(only(access, "records").access.stranger).toEqual({ read: "none", create: false, editOwn: false, editAll: false, repairMirror: false });
    expect(reaches(access, "records", "stranger")).toBe(false);
  });

  it("gives a visitor with no account nothing either", () => {
    expect(reaches(access, "records", "visitor")).toBe(false);
  });

  it("lets a participant read the collection and edit their own row", () => {
    expect(only(access, "records").access.participant).toEqual({ read: "all", create: true, editOwn: true, editAll: false, repairMirror: false });
  });

  it("lets an owner do anything", () => {
    expect(only(access, "records").access.writer).toEqual({ read: "all", create: true, editOwn: true, editAll: true, repairMirror: false });
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
    expect(only(access, "answers").access.visitor).toEqual({ read: "own", create: true, editOwn: false, editAll: false, repairMirror: false });
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
    expect(only(access, "articles").access.visitor).toEqual({ read: "all", create: false, editOwn: false, editAll: false, repairMirror: false });
    expect(only(access, "articles").access.stranger).toEqual({ read: "all", create: false, editOwn: false, editAll: false, repairMirror: false });
  });

  it("lets a participant publish and go on editing what they published", () => {
    expect(only(access, "articles").access.participant).toEqual({ read: "all", create: true, editOwn: true, editAll: false, repairMirror: false });
  });

  it('shuts a writer out of `audience: "participant"` and out of creating at all, because the collection is submitOnly', () => {
    expect(only(access, "articles").access.writer.create).toBe(false);
    expect(only(access, "articles").access.writer.editAll).toBe(true);
  });
});

describe("the submission window, evaluated rather than mentioned", () => {
  const app = { members: {}, collections: { topics: { statusField: "status" } } };
  // No `read` list on purpose: with the collection world-readable every cell would answer "all"
  // and the own-row assertion below could not tell the two apart.
  const block = (window: Record<string, unknown>) => ({
    enabled: true,
    submit: { topics: { auth: "anonymous", uidField: "uid", createFields: ["uid", "status"], initialStatus: "open", window, selfUpdate: { open: ["uid"] } } },
  });
  const NOW = Date.UTC(2026, 8, 1);

  it("shuts the door on a window that has closed", () => {
    // `apps/roles` seals all three of its collections with `window.until` in the year 2000. A
    // summary that only said "there is a window" reported an open board nobody can post to.
    const access = sharedAppAccessOf(app, block({ untilMs: Date.UTC(2000, 0, 1) }), ["topics"], NOW);
    expect(only(access, "topics").access.visitor.create).toBe(false);
    expect(only(access, "topics").caveats.join(" ")).toContain("has CLOSED");
    // AND the row they already submitted is still theirs. `ownRow` in the rules never asks about
    // the window, so erasing this cell when the window shuts is false reassurance at exactly the
    // moment the panel is most likely to be read.
    expect(only(access, "topics").access.visitor.read).toBe("own");
  });

  it("shuts it on a window that has not opened", () => {
    const access = sharedAppAccessOf(app, block({ fromMs: Date.UTC(2030, 0, 1) }), ["topics"], NOW);
    expect(only(access, "topics").access.visitor.create).toBe(false);
    expect(only(access, "topics").caveats.join(" ")).toContain("not opened yet");
  });

  it("leaves it open inside the window, and says the window is there", () => {
    const access = sharedAppAccessOf(app, block({ fromMs: Date.UTC(2020, 0, 1), untilMs: Date.UTC(2030, 0, 1) }), ["topics"], NOW);
    expect(only(access, "topics").access.visitor.create).toBe(true);
    expect(only(access, "topics").caveats.join(" ")).toContain("open right now");
  });

  it("refuses to guess when the bound lives on another record", () => {
    const access = sharedAppAccessOf(app, block({ fromField: { collection: "classes", ref: "classId", field: "opensAt" } }), ["topics"], NOW);
    // Neither answer is available, so the table keeps the wider one and the caveat says why.
    expect(only(access, "topics").access.visitor.create).toBe(true);
    expect(only(access, "topics").caveats.join(" ")).toContain("cannot say whether any one of them is open");
  });
});

describe("a status declaration that refuses every create by itself", () => {
  // Both fail CLOSED in the rules, and both are shapes a half-finished manifest really has. They
  // are modelled rather than caveated because the declaration alone decides them: nothing about
  // the record or the caller can rescue the create, which is exactly when the table may speak.
  const open = (c: Record<string, unknown>, initialStatus: string, createFields: string[] = ["a", "status"]) =>
    sharedAppAccessOf({ members: {}, collections: { answers: c } }, { enabled: true, submit: { answers: { auth: "none", createFields, initialStatus } } }, [
      "answers",
    ]);

  it("refuses when the submit names an initial status and the collection names no status field", () => {
    expect(only(open({}, "new"), "answers").access.visitor.create).toBe(false);
  });

  it("refuses when `transitions` does not list that status under `initial`", () => {
    expect(only(open({ statusField: "status", transitions: { open: ["closed"] } }, "new"), "answers").access.visitor.create).toBe(false);
  });

  it("allows it when the map lists it", () => {
    expect(only(open({ statusField: "status", transitions: { initial: ["new"], new: ["done"] } }, "new"), "answers").access.visitor.create).toBe(true);
  });

  it("refuses when `createFields` does not let the submitter send the status at all", () => {
    // `hasOnly(createFields)` and "the status field must be present at the declared value" are
    // then two conjuncts that contradict each other.
    expect(only(open({ statusField: "status" }, "new", ["a"]), "answers").access.visitor.create).toBe(false);
  });

  it("leaves a collection with no `transitions` alone", () => {
    expect(only(open({ statusField: "status" }, "new"), "answers").access.visitor.create).toBe(true);
  });
});

describe("a createFields list that cannot carry what the rules demand", () => {
  // `submitCreate` asks `hasOnly(createFields)` AND requires certain fields to be present. A field
  // the rules demand and the list does not allow makes those two contradict each other, and the
  // collection accepts nothing from anybody.
  const with_ = (submit: Record<string, unknown>, collection: Record<string, unknown> = {}) =>
    sharedAppAccessOf({ members: {}, collections: { answers: collection } }, { enabled: true, submit: { answers: { auth: "none", ...submit } } }, ["answers"]);

  it.each([
    ["the verified address it checks the submitter against", { auth: "verifiedEmail", emailField: "email", createFields: ["title"] }, {}],
    ["the uid field it binds the row by", { uidField: "uid", createFields: ["title"] }, {}],
    ["the field the document id is built from", { idFrom: "field", idField: "slot", createFields: ["title"] }, {}],
    ["the server-stamped field", { stampField: "at", createFields: ["title"] }, {}],
    ["the field a session gate matches on", { gateOn: { phase: "answering", match: "questionId" }, createFields: ["title"] }, {}],
    ["a field `validate.required` names", { validate: { required: ["title"] }, createFields: ["body"] }, {}],
    ["the field a `keyFields` entry indexes", { validate: { keyFields: [{ field: "kind", values: ["a"] }] }, createFields: ["title"] }, {}],
    ["the reference `refIn` builds the parent path from", { createFields: ["title"] }, { refIn: { collection: "topics", ref: "topicId" } }],
  ])("refuses every create when the list omits %s", (_name, submit, collection) => {
    expect(only(with_(submit, collection), "answers").access.visitor.create).toBe(false);
  });

  it("allows the create once the list carries them", () => {
    expect(only(with_({ uidField: "uid", stampField: "at", createFields: ["title", "uid", "at"] }), "answers").access.visitor.create).toBe(true);
  });

  it("does not demand an emailField the auth stage never reads", () => {
    // `authOk` reads it on the `verifiedEmail` branch and nowhere else; `ownRow` reads it on a
    // READ, which is not this question.
    expect(only(with_({ auth: "anonymous", emailField: "email", createFields: ["title"] }), "answers").access.visitor.create).toBe(true);
  });
});

describe("a withdrawal every sealed state takes back", () => {
  // `deleteWith` asks `!sealedNow(c)` before it reaches `selfDelete`, so a declaration whose every
  // withdrawable status is also sealed grants no withdrawal at all.
  const shape = (sealed: string[]) =>
    sharedAppAccessOf(
      { members: {}, collections: { drafts: { statusField: "status", sealed } } },
      {
        enabled: true,
        submit: { drafts: { auth: "anonymous", uidField: "uid", createFields: ["uid", "status"], initialStatus: "draft", selfDelete: ["draft"] } },
      },
      ["drafts"],
    );

  it("grants nothing when the sealed list covers every withdrawable status", () => {
    expect(only(shape(["draft"]), "drafts").access.visitor.editOwn).toBe(false);
    expect(only(shape(["draft"]), "drafts").caveats.join(" ")).not.toContain("withdraw");
  });

  it("grants it when one status is left", () => {
    expect(only(shape(["published"]), "drafts").access.visitor.editOwn).toBe(true);
  });
});

describe("a reveal-gated collection", () => {
  // `readWith` opens a gated row to every listed member once its parent reveals it. Reporting
  // `Nothing` for the participant row contradicted the deployed read rule; there is no "some rows"
  // state, so the table takes the wider answer and the caveat carries the condition.
  const access = sharedAppAccessOf(
    { members: { "guest@example.com": { "*": "participant" } }, collections: { answers: { revealGated: true, gatedFrom: "questions", revealBy: "revealed" } } },
    undefined,
    ["answers"],
  );

  it("lets the roster read it", () => {
    expect(only(access, "answers").access.participant.read).toBe("all");
  });

  it("leaves the outsiders where they were — the opening is roster-only", () => {
    expect(only(access, "answers").access.visitor.read).toBe("none");
    expect(only(access, "answers").access.stranger.read).toBe("none");
  });

  it("says the read only happens after the parent reveals it", () => {
    expect(only(access, "answers").caveats.join(" ")).toContain("ONCE ITS PARENT REVEALS IT");
  });
});

describe("what still binds an owner", () => {
  // The `Owner / editor` row is one cell for the whole collection, and these three are decided per
  // RECORD — by the status it is in, or by another record entirely. Without them the row reads
  // "Anything" about a collection whose owner cannot delete a closed topic.
  const access = sharedAppAccessOf(
    {
      members: { "owner@example.com": { "*": "owner" } },
      collections: {
        topics: {
          statusField: "status",
          transitions: { open: ["closed"] },
          sealed: ["closed"],
        },
        messages: { refIn: { collection: "topics", ref: "topicId", where: { field: "status", equals: "open" } } },
      },
    },
    undefined,
    ["topics", "messages"],
  );

  it("still calls the owner's write unrestricted in the table", () => {
    // The table cannot say "unless the record is closed" — that is what the caveats are for.
    expect(only(access, "topics").access.writer.editAll).toBe(true);
  });

  it("names the transitions and the seal", () => {
    const said = only(access, "topics").caveats.join(" ");
    expect(said).toContain("declared `transitions`");
    // DELETE only. `sealedNow` is asked by `deleteWith` and by nothing else, so "cannot be changed"
    // would make the panel stricter than the rules.
    expect(said).toContain("cannot be DELETED by anyone, the owner included");
    expect(said).toContain("fields can still be corrected");
  });

  it("names the parent a create has to match", () => {
    expect(only(access, "messages").caveats.join(" ")).toContain("`refIn` requires");
  });
});

describe("a roster key the rules can never match", () => {
  // `email() in a.members` is exact and Firebase lower-cases the token, so `Foo@Example.com`
  // grants that person nothing — and the file reads correctly to a human. Counting it printed
  // `Owner / editor (1)` over an app whose owner is locked out of their own roster.
  const access = sharedAppAccessOf(
    { members: { "Owner@Example.com": { "*": "owner" }, "guest@example.com": { "*": "participant" } }, collections: { records: {} } },
    undefined,
    ["records"],
  );

  it("is left out of the census", () => {
    expect(only(access, "records").census).toEqual({ writers: 0, readers: 0, participants: 1 });
  });

  it("is named, so the missing count has a reason", () => {
    expect(access.unmatchableRoster).toEqual(["Owner@Example.com"]);
  });
});

describe("the two write paths a closed window separates", () => {
  // `updateWith` carries `inWindow`; `deleteWith` does not. So after a window closes a submitter
  // may still WITHDRAW their row and may no longer EDIT it, and a summary that folded the two
  // together had to be wrong about one of them.
  const app = { members: {}, collections: { rsvps: { statusField: "status" } } };
  const shape = (window: Record<string, unknown>, self: Record<string, unknown>) => ({
    enabled: true,
    submit: { rsvps: { auth: "anonymous", uidField: "uid", createFields: ["uid", "status"], initialStatus: "in", window, ...self } },
  });
  const CLOSED = { untilMs: Date.UTC(2000, 0, 1) };
  const NOW = Date.UTC(2026, 8, 1);

  it("keeps the withdrawal a closed window does not take away", () => {
    const access = sharedAppAccessOf(app, shape(CLOSED, { selfDelete: ["in"] }), ["rsvps"], NOW);
    expect(only(access, "rsvps").access.visitor).toEqual({ read: "own", create: false, editOwn: true, editAll: false, repairMirror: false });
  });

  it("does not promise a withdrawal the declaration never named", () => {
    const access = sharedAppAccessOf(app, shape(CLOSED, { selfUpdate: { in: ["uid"] } }), ["rsvps"], NOW);
    const said = only(access, "rsvps").caveats.join(" ");
    expect(said).toContain("still reads their own row");
    expect(said).not.toContain("withdraw");
  });

  it("promises it where `selfDelete` names one", () => {
    const access = sharedAppAccessOf(app, shape(CLOSED, { selfDelete: ["in"] }), ["rsvps"], NOW);
    expect(only(access, "rsvps").caveats.join(" ")).toContain("may still withdraw it");
  });

  it("takes away the edit it does", () => {
    const access = sharedAppAccessOf(app, shape(CLOSED, { selfUpdate: { in: ["uid"] } }), ["rsvps"], NOW);
    expect(only(access, "rsvps").access.visitor).toEqual({ read: "own", create: false, editOwn: false, editAll: false, repairMirror: false });
  });
});

describe("a mirror is writable by everyone, and the table has to say so", () => {
  // `mirrorRepair` is the FIRST branch of `updateWith` and asks nothing about the caller — not even
  // `authed()`. A stale grid repairing itself is the whole point of the rule.
  const access = sharedAppAccessOf({ members: {}, collections: { slots: { mirrorOf: "bookings" } } }, undefined, ["slots"]);

  it("gives every subject the repair, whatever else they may not do", () => {
    expect(only(access, "slots").access.visitor).toEqual({ read: "none", create: false, editOwn: false, editAll: false, repairMirror: true });
    expect(only(access, "slots").access.stranger.repairMirror).toBe(true);
  });

  it("names the paired write on the submission side too", () => {
    // `mirrorClaimed` / `mirrorReleased` bind every create and delete, the writer branches
    // included. Without this a create that looks allowed in the table is refused for a reason
    // nothing on the panel names.
    const paired = sharedAppAccessOf(
      { members: {}, collections: { bookings: {} } },
      { enabled: true, submit: { bookings: { auth: "anonymous", uidField: "uid", createFields: ["uid"], mirror: "slots" } } },
      ["bookings"],
    );
    expect(only(paired, "bookings").caveats.join(" ")).toContain("move the slot it claims in `slots`");
  });

  it("says in words what the one field is", () => {
    expect(only(access, "slots").caveats.join(" ")).toContain("`state`");
  });
});

describe("a session gate", () => {
  it("is read under the key the rules read, which is `gateOn`", () => {
    // `gate` is produced by nothing. Checking it meant the caveat never appeared on any real app.
    const access = sharedAppAccessOf(
      { members: {}, collections: { answers: {} } },
      { enabled: true, submit: { answers: { auth: "anonymous", createFields: ["a"], gateOn: { phase: "answering", match: "questionId" } } } },
      ["answers"],
    );
    expect(only(access, "answers").caveats.join(" ")).toContain("session gate");
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
    expect(only(access, "records").caveats.join(" ")).toContain("still reads their own row");
  });

  it("does not hand an emailField row to the visitor, who has a uid and no verified address", () => {
    // `auth: "none"` lets them submit, so the creatability gate is open; what stops them reaching
    // the row afterwards is `ownRow`'s `verified()` on the `emailField` branch, and nothing else.
    const access = sharedAppAccessOf(
      { members: {}, collections: { rsvps: { statusField: "status" } } },
      { enabled: true, submit: { rsvps: { auth: "none", emailField: "by", createFields: ["by", "status"], initialStatus: "in", selfUpdate: { in: ["by"] } } } },
      ["rsvps"],
    );
    expect(only(access, "rsvps").access.visitor).toEqual({ read: "none", create: true, editOwn: false, editAll: false, repairMirror: false });
    expect(only(access, "rsvps").access.stranger).toEqual({ read: "own", create: true, editOwn: true, editAll: false, repairMirror: false });
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
