// The declaration's field names, checked against the schemas they name.
//
// Three keys in `app.json` point at a FIELD rather than declaring one, and all
// three are read by the deployed rules at write time:
//
//   `collections.<cid>.assigneeField`     — whose row is this
//   `public.submit.<cid>.uidField`        — who submitted this
//   `public.submit.<cid>.stampField`      — when did this reach the queue
//   `public.submit.<cid>.window.fromField` — when does this one open
//
// A name that misses, or a field of the wrong type, is not a weaker app. The
// rules read the value, find nothing or find something they cannot compare,
// and DENY — every time, for everybody, with no message. So the check belongs
// where the author is still holding the declaration.
//
// It lives in MulmoTerminal rather than in the publisher's own `publishChecks` because it needs
// the schemas, and `PublishableCollection` deliberately carries only a cid and a primary key.
// `publicInputProblems` in ./publicForm.ts is the same split for the same reason.
//
// It used to run TWICE — once against the working tree and once, at publish, against what a
// previous DEPLOY had staged, because publish promoted that configuration while writing the roster
// from the manifest, and nothing checked that pair. Publish writes both halves from this manifest
// now (`plans/feat-shared-app-no-staging.md`), so there is one version and one answer.
import type { CollectionFieldType, CollectionSchema } from "@mulmoclaude/core/collection";
import { schemaRefProblems, type AuthoredApp } from "@receptron/sharedapp";

/** What a member's address can be compared against.
 *
 *  The rules compare the field's value with `request.auth.token.email`, so it
 *  holds an ADDRESS. Notably NOT `ref`: a ref stores the target record's
 *  primary-key slug, and a roster is keyed by address — the two match only if
 *  the staff collection happens to be keyed by email, which is not something
 *  this check can know or should assume. */
const ADDRESS_TYPES: ReadonlySet<CollectionFieldType> = new Set<CollectionFieldType>(["string", "email"]);

/** What the document id of a window's target can be read out of. */
const REF_TYPES: ReadonlySet<CollectionFieldType> = new Set<CollectionFieldType>(["string", "ref"]);

interface Sources {
  /** `collections[cid]`, as the declaration carries it. */
  assigneeFieldOf: (cid: string) => string | undefined;
  schemaOf: (cid: string) => CollectionSchema | undefined;
  /** The cids the declaration knows about, for the roster pairing. */
  cids: readonly string[];
}

/** Against the working tree, which is what publish writes. */
export function scopedFieldProblems(app: AuthoredApp, schemas: readonly { cid: string; schema: CollectionSchema }[]): string[] {
  const byCid = new Map(schemas.map((entry) => [entry.cid, entry.schema]));
  const sources: Sources = {
    assigneeFieldOf: (cid) => app.collections?.[cid]?.assigneeField,
    schemaOf: (cid) => byCid.get(cid),
    cids: Object.keys(app.collections ?? {}),
  };
  // The publisher's own `schemaRefProblems` is the other half of the same question — the fields a
  // RULE reads off another record (`idIn.where.field`, the window bounds) — and it is here rather
  // than in the declaration gate for the reason this file exists: it needs the schemas.
  return [...schemaRefProblems(app, [...schemas]), ...fieldProblems(app, sources)];
}

function fieldProblems(app: AuthoredApp, sources: Sources): string[] {
  return [...assigneeFieldProblems(sources), ...uidFieldProblems(app, sources), ...stampFieldProblems(app, sources), ...windowFieldProblems(app, sources)];
}

/** The field carrying the submitter's uid.
 *
 *  A uid is an opaque string, so the type list is the same one an address is checked against minus
 *  `email` — declaring it as `email` would draw an input the schema says is an address and the
 *  rules compare with a session id. Nothing renders it either way: the page fills it in and keeps
 *  it off the form, exactly as it does the stamp.
 *
 *  Missing from the schema, the field is dropped from every projection that reads the schema and
 *  the record is written without it — so `uidOk` refuses the create, and `ownRow` would have
 *  refused the read back. Both silent. */
function uidFieldProblems(app: AuthoredApp, sources: Sources): string[] {
  return Object.entries(app.public?.submit ?? {}).flatMap(([cid, submit]) => {
    const name = submit.uidField;
    const schema = sources.schemaOf(cid);
    if (name === undefined || schema === undefined) return [];
    const spec = fieldOf(schema, name);
    if (spec === undefined) {
      return [
        `public.submit.${cid}.uidField names '${name}', which ${describe(cid)} does not declare. The rules compare that field with the submitter's own uid, ` +
          `so every submission is refused — and the person's own rows are unreachable to them afterwards.`,
      ];
    }
    if (spec.type === "string") return [];
    return [
      `public.submit.${cid}.uidField names '${name}', which is a '${spec.type}' field. A uid is an opaque string the page fills in from the session — ` +
        `declare it as a plain string. (It is never drawn as an input, so nothing is lost by the schema calling it what it is.)`,
    ];
  });
}

/** The field that says whose row it is. */
function assigneeFieldProblems(sources: Sources): string[] {
  return sources.cids.flatMap((cid) => {
    const name = sources.assigneeFieldOf(cid);
    const schema = sources.schemaOf(cid);
    if (name === undefined || schema === undefined) return [];
    const spec = fieldOf(schema, name);
    if (spec === undefined) {
      return [
        `collections.${cid}.assigneeField names '${name}', which ${describe(cid)} does not declare. The rules compare that field with the signed-in address ` +
          `to decide whose row it is, so every write by an assignee is refused — and nobody else notices.`,
      ];
    }
    if (ADDRESS_TYPES.has(spec.type)) return [];
    return [
      `collections.${cid}.assigneeField names '${name}', which is a '${spec.type}' field. It has to hold an ` +
        `email ADDRESS, because that is the only thing the rules can compare a member against. A ref stores the target's primary key, not an address — declare a ` +
        `plain string or email field beside it and let the ref stay the thing the UI renders.`,
    ];
  });
}

/** The field pinned to the server clock. */
function stampFieldProblems(app: AuthoredApp, sources: Sources): string[] {
  return Object.entries(app.public?.submit ?? {}).flatMap(([cid, submit]) => {
    const name = submit.stampField;
    const schema = sources.schemaOf(cid);
    if (name === undefined || schema === undefined) return [];
    const spec = fieldOf(schema, name);
    if (spec === undefined) {
      return [
        `public.submit.${cid}.stampField names '${name}', which ${describe(cid)} does not declare. The rules require the record to CARRY the server time ` +
          `in that field, so nothing can be submitted at all.`,
      ];
    }
    if (spec.type === "datetime") return [];
    return [
      `public.submit.${cid}.stampField names '${name}', which is a '${spec.type}' field. What the rules write ` +
        `there is \`request.time\`, a timestamp — declare it as \`datetime\`, or the comparison is a type error and every submission is denied.`,
    ];
  });
}

/** The bound that lives on another record. */
function windowFieldProblems(app: AuthoredApp, sources: Sources): string[] {
  return Object.entries(app.public?.submit ?? {}).flatMap(([cid, submit]) => {
    const ref = submit.window?.fromField;
    const schema = sources.schemaOf(cid);
    if (ref === undefined || schema === undefined) return [];
    const problems: string[] = [];
    const refSpec = fieldOf(schema, ref.ref);
    if (refSpec === undefined) {
      problems.push(
        `public.submit.${cid}.window.fromField.ref names '${ref.ref}', which ${describe(cid)} does not declare. That field is where the rules read WHICH ` +
          `record carries the opening time, so without it nothing opens.`,
      );
    } else if (!REF_TYPES.has(refSpec.type)) {
      problems.push(
        `public.submit.${cid}.window.fromField.ref names '${ref.ref}', a '${refSpec.type}' field. The rules build a document id out of its value, so it has to be a ` +
          `string or a ref.`,
      );
    }
    const target = sources.schemaOf(ref.collection);
    // An unknown target collection is core's refusal (`windowRefProblems`);
    // saying it twice would make one mistake read as two.
    if (target === undefined) return problems;
    const opens = fieldOf(target, ref.field);
    if (opens === undefined) {
      problems.push(
        `public.submit.${cid}.window.fromField.field names '${ref.field}', which ${describe(ref.collection)} does not declare. Each record there has to ` +
          `carry its own opening time, or the window never opens for any of them.`,
      );
    } else if (opens.type !== "number") {
      problems.push(
        `public.submit.${cid}.window.fromField.field names '${ref.field}', which is a '${opens.type}' field in '${ref.collection}'. It must be a 'number' holding ` +
          `EPOCH MILLIS: the rules compare it with \`request.time.toMillis()\`, and comparing that with anything else is a type error that denies every submission. ` +
          `Whoever schedules the record computes the value ("three days before, at 08:00" is business knowledge, and the rules have no usable date arithmetic).`,
      );
    }
    return problems;
  });
}

const describe = (cid: string) => `'${cid}'`;

/** Own-property guarded: a declaration naming `toString` must MISS here rather
 *  than read an Object.prototype member and pass as a declared field. */
function fieldOf(schema: CollectionSchema, name: string) {
  return Object.hasOwn(schema.fields, name) ? schema.fields[name] : undefined;
}
