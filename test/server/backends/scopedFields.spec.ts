// @vitest-environment node
//
// Three keys in `app.json` name a FIELD the deployed rules read at write time.
// A name that misses, or a field of a type the rules cannot compare, does not
// weaken the app — it denies every write it governs, silently, for everybody.
// So each case below states the refusal AND the neighbouring declaration that
// must still pass.
import { describe, it, expect } from "vitest";
import { parseAuthoredApp } from "@receptron/sharedapp";
import type { CollectionSchema } from "@mulmoclaude/core/collection";
import { scopedFieldProblems } from "../../../server/backends/sharedApp/scopedFields.js";

const bookings: CollectionSchema = {
  title: "Bookings",
  icon: "event",
  primaryKey: "id",
  storage: { type: "firestore" },
  fields: {
    id: { type: "string", label: "ID", primary: true, required: true },
    stylistEmail: { type: "email", label: "担当" },
    stylist: { type: "ref", label: "担当（表示）", to: "stylists" },
    classId: { type: "string", label: "クラス" },
    createdAt: { type: "datetime", label: "申込日時" },
    note: { type: "string", label: "メモ" },
  },
};

const classes: CollectionSchema = {
  title: "Classes",
  icon: "fitness_center",
  primaryKey: "id",
  storage: { type: "firestore" },
  fields: {
    id: { type: "string", label: "ID", primary: true, required: true },
    opensAt: { type: "number", label: "解禁（epoch millis）" },
    startsAt: { type: "datetime", label: "開始" },
  },
};

const SCHEMAS = [
  { cid: "bookings", schema: bookings },
  { cid: "classes", schema: classes },
];

const app = (body: Record<string, unknown>) => {
  const parsed = parseAuthoredApp(JSON.stringify({ aid: "a1", members: { "o@e.com": { "*": "owner" } }, ...body }));
  if (!parsed.ok) throw new Error(parsed.problems.join("; "));
  return parsed.app;
};

const problemsFor = (body: Record<string, unknown>) => scopedFieldProblems(app(body), SCHEMAS);

describe("assigneeField — whose row is this", () => {
  it("accepts a field that holds an address", () => {
    expect(problemsFor({ collections: { bookings: { assigneeField: "stylistEmail" } } })).toEqual([]);
  });

  it("refuses a name the collection does not declare", () => {
    const problems = problemsFor({ collections: { bookings: { assigneeField: "stylist_email" } } });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("'stylist_email'");
    expect(problems[0]).toContain("nobody else notices");
  });

  it("refuses a ref, which stores a primary key and not an address", () => {
    // The trap this exists for: `stylist` is the natural-looking answer, it
    // renders correctly in the UI, and it can never equal a signed-in address.
    const problems = problemsFor({ collections: { bookings: { assigneeField: "stylist" } } });
    expect(problems[0]).toContain("has to hold an email ADDRESS");
  });
});

describe("stampField — when did this reach the queue", () => {
  const submit = (extra: Record<string, unknown>) => ({
    public: {
      enabled: true,
      submit: { bookings: { auth: "verifiedEmail", createFields: ["classId", "createdAt"], ...extra } },
    },
  });

  it("accepts a datetime field", () => {
    expect(problemsFor(submit({ stampField: "createdAt" }))).toEqual([]);
  });

  it("refuses a name the collection does not declare", () => {
    const problems = problemsFor(submit({ stampField: "submittedAt" }));
    expect(problems[0]).toContain("nothing can be submitted at all");
  });

  it("refuses a field the rules cannot write a timestamp into", () => {
    const problems = problemsFor(submit({ stampField: "note" }));
    expect(problems[0]).toContain("declare it as `datetime`");
  });
});

describe("uidField — who submitted this", () => {
  // The key an app declares when its document id is spent on exclusivity: identity has to live in
  // a field, and this is the one that carries no address into a row the app may publish.
  const submit = (extra: Record<string, unknown>) => ({
    public: {
      enabled: true,
      submit: { bookings: { auth: "verifiedEmail", createFields: ["classId", "note"], ...extra } },
    },
  });

  it("accepts a plain string", () => {
    expect(problemsFor(submit({ uidField: "note" }))).toEqual([]);
  });

  it("refuses a name the collection does not declare", () => {
    // Both halves are silent: the field is dropped from every projection that reads the schema, so
    // the record goes out without it and `uidOk` refuses the create — and had it been written, the
    // person could not have read their own rows back either.
    const problems = problemsFor(submit({ uidField: "uid" }));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("'uid'");
    expect(problems[0]).toContain("unreachable to them afterwards");
  });

  it("refuses a field declared as something a uid is not", () => {
    // `email` is the tempting one — it is the OTHER identity field, and the schema would then say
    // "address" about a value the rules compare with a session id.
    const problems = problemsFor(submit({ uidField: "stylistEmail" }));
    expect(problems[0]).toContain("declare it as a plain string");
  });
});

describe("window.fromField — when does this one open", () => {
  const withWindow = (fromField: Record<string, string>) => ({
    public: {
      enabled: true,
      submit: { bookings: { auth: "verifiedEmail", createFields: ["classId"], window: { fromField } } },
    },
  });

  it("accepts a ref into a collection that carries epoch millis", () => {
    expect(problemsFor(withWindow({ ref: "classId", collection: "classes", field: "opensAt" }))).toEqual([]);
  });

  it("refuses a bound the target does not carry", () => {
    const problems = problemsFor(withWindow({ ref: "classId", collection: "classes", field: "opens" }));
    expect(problems.join("\n")).toContain("the window never opens for any of them");
  });

  it("refuses a datetime bound, which the rules cannot compare with a clock", () => {
    // `request.time.toMillis()` is a number. Comparing it with a Timestamp is
    // a type error, and a rules type error denies — so the app would look
    // right and take no submissions at all.
    const problems = problemsFor(withWindow({ ref: "classId", collection: "classes", field: "startsAt" }));
    expect(problems.join("\n")).toContain("must be a 'number' holding EPOCH");
  });

  it("says nothing about an unknown target collection, which core already refuses", () => {
    // One mistake must read as one problem. `windowRefProblems` in core names
    // the unknown collection; repeating it here would make the author look for
    // two.
    expect(problemsFor(withWindow({ ref: "classId", collection: "sessions", field: "opensAt" }))).toEqual([]);
  });

  it("refuses a ref field the collection does not declare", () => {
    const problems = problemsFor(withWindow({ ref: "lessonId", collection: "classes", field: "opensAt" }));
    expect(problems[0]).toContain("without it nothing opens");
  });
});

describe("a declaration that names none of them", () => {
  it("is left alone", () => {
    expect(problemsFor({ collections: { bookings: { statusField: "status" } } })).toEqual([]);
  });
});

// --- the pair publish writes ------------------------------------------------
//
// publish writes the rule configuration, the schemas and the roster in ONE operation, from this
// manifest. There used to be a second half here: a check against what a previous DEPLOY had
// staged, because publish promoted that configuration while writing the roster from the manifest,
// so an `assignee` could land beside a configuration carrying no `assigneeField` and be refused
// every write with nothing anywhere to say why. That state is unreachable now
// (`plans/feat-shared-app-no-staging.md`), and the tests for it went with the code.

const STYLIST = "anna@salon.jp";

describe("the roster and the field it is compared by", () => {
  const roster = { "o@e.com": { "*": "owner" }, [STYLIST]: { bookings: "assignee" } };

  it("passes when the declaration carries the field", () => {
    const declared = app({ members: roster, collections: { bookings: { assigneeField: "stylistEmail" } } });
    expect(scopedFieldProblems(declared, [{ cid: "bookings", schema: bookings }])).toEqual([]);
  });

  it("refuses a field the SCHEMA does not have", () => {
    const declared = app({ members: roster, collections: { bookings: { assigneeField: "stylistEmail" } } });
    const stale: CollectionSchema = { ...bookings, fields: { id: { type: "string", label: "ID", primary: true, required: true } } };
    const problems = scopedFieldProblems(declared, [{ cid: "bookings", schema: stale }]);
    expect(problems[0]).toContain("assigneeField names 'stylistEmail'");
    expect(problems[0]).toContain("'bookings'");
  });

  it("says nothing about a collection this repository does not have", () => {
    const declared = app({ members: roster, collections: { bookings: { assigneeField: "stylistEmail" } } });
    expect(scopedFieldProblems(declared, [{ cid: "classes", schema: classes }])).toEqual([]);
  });

  it("checks the stamped field against the schema too", () => {
    const declared = app({
      public: { enabled: true, submit: { bookings: { auth: "verifiedEmail", createFields: ["createdAt"], stampField: "createdAt" } } },
    });
    const stale: CollectionSchema = { ...bookings, fields: { id: { type: "string", label: "ID", primary: true, required: true } } };
    const problems = scopedFieldProblems(declared, [{ cid: "bookings", schema: stale }]);
    expect(problems[0]).toContain("stampField names 'createdAt'");
  });
});

describe("the fields a RULE reads off another record", () => {
  // `scopedFieldProblems` answers with the publisher's `schemaRefProblems` as well as its own
  // checks: `idIn.where.field` and the two window bounds are read by the rules off a DIFFERENT
  // collection's records, and only a schema can say whether the name exists. This pins the wiring
  // — the half that reaches `publishGate` through this one function.
  it("refuses a window bound the target collection does not declare", () => {
    const declared = app({
      public: {
        enabled: true,
        submit: {
          bookings: {
            auth: "verifiedEmail",
            createFields: ["classId"],
            window: { fromField: { ref: "classId", collection: "classes", field: "nosuchfield" } },
          },
        },
      },
    });
    const problems = scopedFieldProblems(declared, [
      { cid: "bookings", schema: bookings },
      { cid: "classes", schema: classes },
    ]);
    expect(problems.join("\n")).toContain("window.fromField.field names 'nosuchfield'");
  });
});
