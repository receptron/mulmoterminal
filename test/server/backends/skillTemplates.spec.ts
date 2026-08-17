// @vitest-environment node
//
// The app templates the skill hands an LLM, run through the REAL gate.
//
// A template is copied verbatim by an agent that cannot check it, into a
// repository where the first feedback is a deploy. Every failure mode this
// declaration language has — a field name that misses, a role with nothing to
// compare, a window that can never open — is silent at the point of copying
// and fatal afterwards. So the samples are held to the same refusals a real
// `check` applies, which is the only way a sample stays true as the rules move.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { CollectionSchema } from "@mulmoclaude/core/collection";
import { declarationProblems } from "../../../server/backends/sharedApp/context.js";
import { parseAuthoredApp } from "@receptron/sharedapp";
import { modalCallIn } from "../../../server/backends/sharedApp/modalCall.js";
import { formElementIn, readyNeverCalled } from "../../../server/backends/sharedApp/viewDefects.js";
import { readdirSync } from "node:fs";

const TEMPLATES = path.join(process.cwd(), "server", "skills", "mulmoterminal-shared-app", "templates");

/** The JSON blocks of one template, keyed by the heading above them. The
 *  headings are the file paths an author writes, so the mapping is the
 *  template's own instruction rather than an ordering this test invented. */
function blocksOf(file: string): Map<string, unknown> {
  const text = readFileSync(path.join(TEMPLATES, file), "utf8");
  const blocks = new Map<string, unknown>();
  const pattern = /^## (.+?)\n\n```json\n([\s\S]*?)\n```/gm;
  for (const [, heading, json] of text.matchAll(pattern)) {
    if (heading === undefined || json === undefined) continue;
    blocks.set(heading.trim(), JSON.parse(json));
  }
  return blocks;
}

/** An ordinary shared collection the template mentions but does not spell out —
 *  a staff list, a price list. Their shape teaches nothing, and leaving them
 *  undeclared here would make the roster's per-collection roles look like
 *  typos. */
const plain = (slug: string): CollectionSchema => ({
  title: slug,
  icon: "list",
  primaryKey: "id",
  storage: { type: "firestore" },
  fields: { id: { type: "string", label: "ID", primary: true, required: true } },
});

function problemsFor(file: string, owner: string, extraCids: readonly string[]) {
  const blocks = blocksOf(file);
  const manifest = blocks.get("app.json");
  expect(manifest, `${file} must show an \`## app.json\` block`).toBeTruthy();
  // The `aid` in a template is prose on purpose — `init` mints it, and a
  // sample carrying a real one invites an agent to paste somebody's app id.
  const parsed = parseAuthoredApp(JSON.stringify({ ...(manifest as object), aid: "app_template" }));
  if (!parsed.ok) throw new Error(`${file}: app.json does not parse — ${parsed.problems.join("; ")}`);

  const collections = [
    ...[...blocks.entries()]
      .filter(([heading]) => heading.endsWith("/schema.json"))
      .map(([heading, schema]) => ({ slug: heading.split("/").at(-2) ?? heading, schema: schema as CollectionSchema })),
    ...extraCids.map((slug) => ({ slug, schema: plain(slug) })),
  ];
  return declarationProblems(parsed.app, collections as never, { email: owner, uid: "u-owner" });
}

describe("the shared-app templates", () => {
  it("salon.md deploys as written", () => {
    expect(problemsFor("salon.md", "owner@salon.jp", ["stylists", "services"])).toEqual([]);
  });

  it("gym.md deploys as written", () => {
    expect(problemsFor("gym.md", "owner@gym.jp", [])).toEqual([]);
  });

  it("meeting-room.md deploys as written", () => {
    expect(problemsFor("meeting-room.md", "facility@example.co.jp", ["rooms"])).toEqual([]);
  });

  it("survey.md deploys as written", () => {
    expect(problemsFor("survey.md", "owner@example.jp", [])).toEqual([]);
  });

  it("shows no page the sandbox would silently break", () => {
    // The frame has no `allow-modals` and no `allow-forms`, and the parent sends nothing until the
    // view says `ready()`. All three fail the same way — nothing drawn, nothing thrown — and a
    // template is copied VERBATIM, so a sample carrying one teaches the exact page an author then
    // ships and reports as broken. That is not hypothetical for any of them: `prompt()` was in
    // these samples once, and a `<form>` written from scratch (because no sample showed the
    // alternative) went to a public URL with a Submit button that did nothing.
    for (const file of readdirSync(TEMPLATES).filter((name) => name.endsWith(".md"))) {
      for (const [, block] of readFileSync(path.join(TEMPLATES, file), "utf8").matchAll(/^```html\n([\s\S]*?)\n```/gm)) {
        const html = block ?? "";
        expect(`${file}: ${modalCallIn(html) ?? ""}`).toBe(`${file}: `);
        expect(`${file}: form=${formElementIn(html)}`).toBe(`${file}: form=false`);
        expect(`${file}: readyMissing=${readyNeverCalled(html)}`).toBe(`${file}: readyMissing=false`);
      }
    }
  });

  it("ships an HTML block for every page its app.json declares", () => {
    // A declared `path` is READ at deploy: `planAppViewTiers` opens each one and refuses the whole
    // operation when a file is missing. So a template that names two pages and shows neither does
    // not merely teach less — it teaches a declaration whose first deploy fails, and the author is
    // then editing files to recover. (Which is what the gym template did: it described a view in
    // prose, declared nothing, and its ranking was unbuildable from what it showed.)
    for (const file of readdirSync(TEMPLATES).filter((name) => name.endsWith(".md"))) {
      const text = readFileSync(path.join(TEMPLATES, file), "utf8");
      const manifest = blocksOf(file).get("app.json") as { views?: { path?: string }[] } | undefined;
      const declared = (manifest?.views ?? []).map((view) => view.path).filter((value): value is string => typeof value === "string");
      const lines = text.split("\n");
      const isHeading = (line: string): boolean => /^#{2,3} /.test(line);
      for (const declaredPath of declared) {
        // The section that introduces the page — a heading STARTING with the path, because that
        // heading is the template's own instruction about which file the author writes — and the
        // fenced html block that must be inside it, before the next heading.
        const start = lines.findIndex((line) => isHeading(line) && line.replace(/^#{2,3} /, "").startsWith(declaredPath));
        const rest = start === -1 ? [] : lines.slice(start + 1);
        const end = rest.findIndex(isHeading);
        const body = (end === -1 ? rest : rest.slice(0, end)).join("\n");
        const heading = start === -1 ? "has no section" : "has a section";
        expect(`${file}: ${declaredPath} ${heading}`).toBe(`${file}: ${declaredPath} has a section`);
        const shown = body.includes("```html") ? "shows HTML" : "shows no HTML";
        expect(`${file}: ${declaredPath} ${shown}`).toBe(`${file}: ${declaredPath} shows HTML`);
      }
    }
  });

  it("each template shows every collection whose shape carries a decision", () => {
    // A guard on the guard: if a template stopped showing its schemas the
    // checks above would still pass, against nothing.
    expect([...blocksOf("salon.md").keys()]).toEqual(expect.arrayContaining([".claude/skills/bookings/schema.json", ".claude/skills/slots/schema.json"]));
    expect([...blocksOf("gym.md").keys()]).toEqual(expect.arrayContaining([".claude/skills/classes/schema.json", ".claude/skills/bookings/schema.json"]));
    expect([...blocksOf("meeting-room.md").keys()]).toEqual(
      expect.arrayContaining([".claude/skills/bookings/schema.json", ".claude/skills/slots/schema.json"]),
    );
    expect([...blocksOf("survey.md").keys()]).toEqual(expect.arrayContaining([".claude/skills/questions/schema.json", ".claude/skills/responses/schema.json"]));
  });
});
