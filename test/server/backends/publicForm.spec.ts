// @vitest-environment node
//
// The public page cannot read the schema — `schemaRead` is `readerOf || publicRead || partRead`,
// and the person answering a survey is none of those. So what it CAN read has to be enough to draw
// the form, and this is the projection that makes it so.
import { describe, it, expect } from "vitest";
import { parseAuthoredApp } from "@receptron/sharedapp";
import { oversizeProblem, publicFormOf, publicInputProblems } from "../../../server/backends/sharedApp/publicForm.js";
import { schemasOf } from "../../../server/backends/sharedApp/context.js";

const schema = {
  title: "Responses",
  icon: "reviews",
  primaryKey: "id",
  storage: { type: "firestore" as const },
  fields: {
    id: { type: "string" as const, label: "ID", primary: true, required: true },
    name: { type: "string" as const, label: "お名前" },
    score: { type: "enum" as const, label: "満足度", values: ["1", "2", "3", "4", "5"] },
    comment: { type: "text" as const, label: "ご感想" },
    status: { type: "string" as const, label: "状態" },
  },
};

// The repository's collection, as publish reads it. `statusField` comes from the manifest beside
// it — one operation writes both, so there is no version of one to pair with another version of
// the other. (It used to come from the STAGED document, because publish promoted that.)
const schemas = [{ cid: "responses", schema }];

const authored = (submit: Record<string, unknown>) => {
  const parsed = parseAuthoredApp(
    JSON.stringify({
      aid: "a1",
      members: { "o@e.com": { "*": "owner" } },
      collections: { responses: { submitOnly: true, statusField: "status" } },
      public: { enabled: true, read: [], submit },
    }),
  );
  if (!parsed.ok) throw new Error(parsed.problems.join("; "));
  return parsed.app;
};

const surveySubmit = {
  responses: { auth: "verifiedEmail", emailField: "email", createFields: ["name", "score", "comment"] },
};

describe("publicFormOf", () => {
  it("gives the page a label, a type and an enum's choices", () => {
    expect(publicFormOf(authored(surveySubmit), schemas)).toEqual({
      responses: {
        fields: {
          name: { label: "お名前", type: "string" },
          score: { label: "満足度", type: "enum", values: ["1", "2", "3", "4", "5"] },
          comment: { label: "ご感想", type: "text" },
        },
        // Not `status`, and not guessable: the create rule requires the initial value to land in
        // the field `collections[cid].statusField` names, and core's config projection does not
        // carry it. A page that assumed the name would be refused.
        statusField: "status",
      },
    });
  });

  it("publishes only what the visitor may write", () => {
    // `createFields` is the rules' whitelist for a public create, so a field outside it cannot be
    // submitted — and publishing its label would put the app's internal vocabulary on a
    // world-readable document for nobody's benefit.
    const form = publicFormOf(authored(surveySubmit), schemas);
    expect(Object.keys(form.responses?.fields ?? {})).not.toContain("status");
    expect(Object.keys(form.responses?.fields ?? {})).not.toContain("id");
  });

  it("marks a field the rules will insist on — from either declaration", async () => {
    // Two places can insist and the page has to honour both: the schema's own `required`, and
    // `public.submit[cid].validate.required`, which is what the deployed rules check on a public
    // create. Dropped, the visitor meets it as a permission error naming no field.
    const withRequired = {
      ...schema,
      fields: { ...schema.fields, name: { type: "string" as const, label: "お名前", required: true } },
    };
    const form = publicFormOf(
      authored({ responses: { auth: "verifiedEmail", emailField: "email", createFields: ["name", "score", "comment"], validate: { required: ["score"] } } }),
      [{ cid: "responses", schema: withRequired }],
    );
    expect(form.responses?.fields.name).toMatchObject({ required: true });
    expect(form.responses?.fields.score).toMatchObject({ required: true });
    // And nothing is marked that neither declaration asked for.
    expect(form.responses?.fields.comment).not.toHaveProperty("required");
  });

  it("names the status field the rules will check, whatever it is called", async () => {
    // `status` is a convention, not a rule. The create rule reads `collections[cid].statusField`,
    // so a collection that calls it `state` refuses a submission that writes `status` — and the
    // visitor cannot learn the name from anywhere else.
    //
    // The manifest is what publish writes, so the manifest is what the page is told about.
    const parsed = parseAuthoredApp(
      JSON.stringify({
        aid: "a1",
        members: { "o@e.com": { "*": "owner" } },
        collections: { responses: { submitOnly: true, statusField: "state" } },
        public: {
          enabled: true,
          read: [],
          submit: { responses: { auth: "verifiedEmail", emailField: "email", createFields: ["name"], initialStatus: "submitted" } },
        },
      }),
    );
    if (!parsed.ok) throw new Error(parsed.problems.join("; "));
    expect(publicFormOf(parsed.app, schemas).responses?.statusField).toBe("state");
  });

  it("says nothing about a collection the app does not open", () => {
    expect(publicFormOf(authored({}), schemas)).toEqual({});
  });

  it("skips a submit whose collection this repository does not have, rather than publishing an empty form", () => {
    // An empty entry reads as a form that failed to load; absence is a fact the page can state.
    expect(publicFormOf(authored({ waitlist: { auth: "verifiedEmail", emailField: "email", createFields: ["name"] } }), schemas)).toEqual({});
  });

  it("ignores a createFields entry the schema does not declare", () => {
    // Including `toString`: an own-property guard is what keeps an Object.prototype member from
    // being published as a field nobody wrote.
    const form = publicFormOf(authored({ responses: { auth: "verifiedEmail", emailField: "email", createFields: ["name", "toString", "nope"] } }), schemas);
    expect(form.responses?.fields).toEqual({ name: { label: "お名前", type: "string" } });
  });
});

describe("the field the page stamps rather than asks", () => {
  // `stampField` is in `createFields` because the rules refuse any key outside
  // that list — not because a visitor answers it. Drawing it would invite an
  // answer the rules then deny, and omitting it from the form entirely would
  // leave the page with no way to learn the name.
  const stamped = authored({
    responses: { auth: "verifiedEmail", emailField: "email", createFields: ["name", "createdAt"], stampField: "createdAt" },
  });
  const withStamp = [
    {
      cid: "responses",
      schema: { ...schema, fields: { ...schema.fields, createdAt: { type: "datetime" as const, label: "受付日時" } } },
    },
  ];

  it("is named on the form and not drawn as an input", () => {
    const form = publicFormOf(stamped, withStamp);
    expect(form.responses?.stampField).toBe("createdAt");
    expect(Object.keys(form.responses?.fields ?? {})).toEqual(["name"]);
  });

  it("keeps a form whose only create field is the stamp", () => {
    // "Count me in": `idFrom: "auth.uid"` plus a server timestamp is a complete
    // submission — the identity of whoever pressed the button and the moment
    // they did. It draws no inputs, and it is still a form: without an entry the
    // page has no submit target and no way to learn the field the rules insist
    // on, for a declaration core accepts.
    const oneClick = authored({
      responses: { auth: "verifiedEmail", idFrom: "auth.uid", createFields: ["createdAt"], stampField: "createdAt" },
    });
    const form = publicFormOf(oneClick, withStamp);
    // `statusField` rides along as it does for any collection whose declaration names one — the
    // page needs it whether or not it draws anything.
    expect(form.responses).toEqual({ fields: {}, stampField: "createdAt", statusField: "status" });
  });

  it("still drops a collection that draws nothing and stamps nothing", () => {
    // The guard this sits beside is not weakened: an empty entry with nothing
    // behind it reads as a form that failed to load.
    expect(publicFormOf(authored({ responses: { auth: "verifiedEmail", createFields: ["nope"] } }), schemas).responses).toBeUndefined();
  });

  it("is absent when nothing is stamped", () => {
    expect(publicFormOf(authored(surveySubmit), schemas).responses?.stampField).toBeUndefined();
  });
});

describe("the field the page takes from the session rather than asks", () => {
  // `uidField` is the stamp's sharper twin. The stamp draws a box nothing can usefully be typed
  // into; a uid draws one a visitor CAN complete, and `uidOk` refuses every value they could put
  // in it — so the box is not merely useless, it is a way to be denied.
  const withUid = [{ cid: "responses", schema: { ...schema, fields: { ...schema.fields, uid: { type: "string" as const, label: "uid" } } } }];
  const claimed = authored({
    responses: { auth: "verifiedEmail", uidField: "uid", createFields: ["name", "uid"] },
  });

  it("is not drawn as an input", () => {
    expect(Object.keys(publicFormOf(claimed, withUid).responses?.fields ?? {})).toEqual(["name"]);
  });

  it("keeps a form whose only create field is the uid", () => {
    // The same "count me in" as the stamp's, for an app whose document id is spent on the thing
    // being claimed: the whole submission is who pressed the button.
    const oneClick = authored({ responses: { auth: "verifiedEmail", uidField: "uid", createFields: ["uid"] } });
    expect(publicFormOf(oneClick, withUid).responses).toEqual({ fields: {}, statusField: "status" });
  });

  it("leaves the address drawn, which is the other identity field", () => {
    // Deliberately not the same treatment: every reader already skips the address at draw time,
    // and a visitor can legitimately see it back on their own row. What is excluded above is what
    // no reader can render usefully.
    //
    // The address is IN createFields here, which is the point of the case — asserted against a
    // declaration that does not carry it, this would pass whatever the projection did.
    const withEmail = [{ cid: "responses", schema: { ...schema, fields: { ...schema.fields, email: { type: "email" as const, label: "メール" } } } }];
    const named = authored({ responses: { auth: "verifiedEmail", emailField: "email", createFields: ["name", "email"] } });
    expect(Object.keys(publicFormOf(named, withEmail).responses?.fields ?? {})).toEqual(["name", "email"]);
  });
});

describe("fields a stranger cannot be asked for", () => {
  // `createFields` is not only what the page draws from — it is the whitelist the deployed rules
  // judge a public create by. So a computed field left in it is a value from the internet landing
  // in a field the host is supposed to compute; dropping it from the form alone would not stop it.
  const withField = (name: string, spec: Record<string, unknown>) => [{ cid: "responses", schema: { ...schema, fields: { ...schema.fields, [name]: spec } } }];

  it("does not draw a computed field", () => {
    const app = authored({ responses: { auth: "verifiedEmail", emailField: "email", createFields: ["name", "flagged"] } });
    const form = publicFormOf(app, withField("flagged", { type: "flag", label: "要対応", where: { field: "score", in: ["1"] } }));
    expect(Object.keys(form.responses?.fields ?? {})).toEqual(["name"]);
  });

  it("does not draw a field it cannot describe", () => {
    const app = authored({ responses: { auth: "verifiedEmail", emailField: "email", createFields: ["name", "owner"] } });
    const form = publicFormOf(app, withField("owner", { type: "ref", label: "担当", to: "people" }));
    expect(Object.keys(form.responses?.fields ?? {})).toEqual(["name"]);
  });
});

describe("oversizeProblem", () => {
  it("says nothing about a form that fits", () => {
    expect(oversizeProblem({ form: publicFormOf(authored(surveySubmit), schemas) })).toBeNull();
  });

  it("stops a form too big for the one document a visitor may read", () => {
    const values = Array.from({ length: 80000 }, (_, index) => `choice-${index}`);
    const problem = oversizeProblem({ form: { responses: { fields: { score: { label: "満足度", type: "enum", values } } } } });
    expect(problem).toContain("one Firestore document");
  });
});

describe("publicInputProblems", () => {
  // The gate that runs before any write — `declarationProblems`, shared by deploy, publish and
  // check — so the author is told while it is still a declaration.
  const collection = (fields: Record<string, unknown>) =>
    schemasOf([{ slug: "responses", schema: { ...schema, fields: { ...schema.fields, ...fields } } } as never]);

  it("says nothing about a form of plain fields", () => {
    expect(publicInputProblems(authored(surveySubmit), collection({}))).toEqual([]);
  });

  it("refuses a computed field, naming it and saying what to do", () => {
    const app = authored({ responses: { auth: "verifiedEmail", emailField: "email", createFields: ["name", "flagged"] } });
    const problems = publicInputProblems(app, collection({ flagged: { type: "flag", label: "要対応", where: { field: "score", in: ["1"] } } }));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("'flagged'");
    expect(problems[0]).toContain("computed by the host");
  });

  it("refuses a field the public page cannot draw", () => {
    const app = authored({ responses: { auth: "verifiedEmail", emailField: "email", createFields: ["owner"] } });
    const problems = publicInputProblems(app, collection({ owner: { type: "ref", label: "担当", to: "people" } }));
    expect(problems[0]).toContain("cannot draw one");
  });

  it("leaves a collection it has no schema for to the checks that own that", () => {
    const app = authored({ ghost: { auth: "verifiedEmail", emailField: "email", createFields: ["name"] } });
    expect(publicInputProblems(app, collection({}))).toEqual([]);
  });
});

describe("the status field the page writes", () => {
  // The rules check `collections[cid].statusField` on the app document, and publish writes that
  // from the manifest in the same operation as this form — so the two cannot disagree. They could
  // when publish promoted a STAGED copy: deploy with `state`, edit `app.json` to `status`,
  // publish, and the page wrote a key the promoted rule refused with nothing to say why.
  it("comes from the manifest publish writes beside it", () => {
    const app = authored(surveySubmit);
    expect(publicFormOf(app, schemas).responses?.statusField).toBe("status");
  });

  it("is absent when the declaration names none", () => {
    const parsed = parseAuthoredApp(
      JSON.stringify({
        aid: "a1",
        members: { "o@e.com": { "*": "owner" } },
        collections: { responses: { submitOnly: true } },
        public: { enabled: true, read: [], submit: surveySubmit },
      }),
    );
    if (!parsed.ok) throw new Error(parsed.problems.join("; "));
    expect(publicFormOf(parsed.app, schemas).responses?.statusField).toBeUndefined();
  });
});

describe("a createFields entry the schema does not declare", () => {
  // It used to be asked twice: the deploy gate read the working tree, publish read the STAGED
  // schemas, and a field added to both the schema and `createFields` without a re-deploy would
  // publish rules demanding a field the form could not draw. One version now, one answer.
  const app = authored({ responses: { auth: "verifiedEmail", emailField: "email", createFields: ["name", "referrer"] } });

  it("passes against a schema that has the field", () => {
    const withNew = { ...schema, fields: { ...schema.fields, referrer: { type: "string" as const, label: "きっかけ" } } };
    expect(publicInputProblems(app, [{ cid: "responses", schema: withNew }])).toEqual([]);
  });

  it("is refused against one that does not", () => {
    const problems = publicInputProblems(app, [{ cid: "responses", schema }]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("does not declare a field called 'referrer'");
  });
});
