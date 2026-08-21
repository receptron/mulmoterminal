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
import { APP_PROTOCOL, parseAuthoredApp } from "@receptron/sharedapp";
import { modalCallIn } from "../../../server/backends/sharedApp/modalCall.js";
import { formElementIn, readyNeverCalled } from "../../../server/backends/sharedApp/viewDefects.js";
import { readdirSync } from "node:fs";

const TEMPLATES = path.join(process.cwd(), "server", "skills", "mulmoterminal-shared-app", "templates");

/** The app templates themselves. `design.md` lives beside them and is guidance rather than an app:
 *  it declares no `app.json` and shows no page, so every check below would read it as a template
 *  that had lost everything. Named here once so a future sibling is excluded in one place. */
const TEMPLATE_FILES = readdirSync(TEMPLATES)
  .filter((name) => name.endsWith(".md") && name !== "design.md")
  .sort();

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

  it("live-poll.md deploys as written", () => {
    expect(problemsFor("live-poll.md", "host@example.com", [])).toEqual([]);
  });

  it("todo-board.md deploys as written", () => {
    expect(problemsFor("todo-board.md", "owner@example.com", [])).toEqual([]);
  });

  it("project-board.md deploys as written", () => {
    expect(problemsFor("project-board.md", "owner@example.com", [])).toEqual([]);
  });

  it("shows no page the sandbox would silently break", () => {
    // The frame has no `allow-modals` and no `allow-forms`, and the parent sends nothing until the
    // view says `ready()`. All three fail the same way — nothing drawn, nothing thrown — and a
    // template is copied VERBATIM, so a sample carrying one teaches the exact page an author then
    // ships and reports as broken. That is not hypothetical for any of them: `prompt()` was in
    // these samples once, and a `<form>` written from scratch (because no sample showed the
    // alternative) went to a public URL with a Submit button that did nothing.
    for (const file of TEMPLATE_FILES) {
      for (const [, block] of readFileSync(path.join(TEMPLATES, file), "utf8").matchAll(/^```html\n([\s\S]*?)\n```/gm)) {
        const html = block ?? "";
        expect(`${file}: ${modalCallIn(html) ?? ""}`).toBe(`${file}: `);
        expect(`${file}: form=${formElementIn(html)}`).toBe(`${file}: form=false`);
        expect(`${file}: readyMissing=${readyNeverCalled(html)}`).toBe(`${file}: readyMissing=false`);
      }
    }
  });

  it("gives every page a canvas of its own, on the root", () => {
    // A view is a document inside somebody else's frame, and the frames differ: the public site is
    // light, MulmoTerminal's pane is nearly black. A page that sets `color` and no background is
    // transparent, so the SAME HTML was black-on-white in one and black-on-black in the other —
    // unreadable, with nothing wrong in it. Every template was that page.
    //
    // The runtime lays white paper under all of them now (`publicViewSrcdoc`), which is why this
    // asserts the TEMPLATES rather than trusting it: a template is copied verbatim, so it is the
    // thing that teaches an author to state their own ground instead of inheriting one. It is also
    // what lets a page choose to be dark.
    //
    // ON THE ROOT, not on `body`: a background on the root element is what stops the first body's
    // from propagating to the canvas, so a page painting only `body` gets its colour on the body
    // box and the runtime's white around it.
    for (const file of TEMPLATE_FILES) {
      for (const [, block] of readFileSync(path.join(TEMPLATES, file), "utf8").matchAll(/^```html\n([\s\S]*?)\n```/gm)) {
        const sheet = /<style>([\s\S]*?)<\/style>/.exec(block ?? "")?.[1] ?? "";
        // Line by line rather than by one regex over the sheet: the rule is written on its own
        // line in every template, and a pattern spanning `{ … }` across newlines is the kind that
        // backtracks.
        const rule = sheet.split("\n").find((line) => line.trim().startsWith("html {")) ?? "";
        // Split into declarations rather than searched as text: `border-color:` ENDS with the
        // string `color:`, and `background-color:` ends with it too — so a page declaring
        // `html { background: #111; border-color: #333 }` would have passed the foreground half
        // below while rendering dark on dark, which is the exact failure both halves are here to
        // stop.
        const declared = rule
          .replace(/^[^{]*\{/, "")
          .split(";")
          .map((part) => part.trim().split(":")[0]?.trim() ?? "");
        const declares = (...properties: string[]): boolean => properties.some((property) => declared.includes(property));
        // Either spelling of the canvas, because both are the same decision.
        expect(`${file}: paints its root = ${declares("background", "background-color")}`).toBe(`${file}: paints its root = true`);
        // And the other half of it, since a canvas with no foreground is only half a decision.
        expect(`${file}: states its foreground = ${declares("color")}`).toBe(`${file}: states its foreground = true`);
        // The third, which is the one people leave out: `color-scheme` is what the UA reads for
        // form controls, scrollbars and its own defaults, so without it a reader whose OS is dark
        // gets dark widgets on this light paper. DECLARED, not `light` — a template that chooses
        // dark paper says `dark` here, and a test demanding the value would be the thing standing
        // in its way.
        expect(`${file}: states its scheme = ${declares("color-scheme")}`).toBe(`${file}: states its scheme = true`);
      }
    }
  });

  it("ships an HTML block for every page its app.json declares", () => {
    // A declared `path` is READ at deploy: `planAppViewTiers` opens each one and refuses the whole
    // operation when a file is missing. So a template that names two pages and shows neither does
    // not merely teach less — it teaches a declaration whose first deploy fails, and the author is
    // then editing files to recover. (Which is what the gym template did: it described a view in
    // prose, declared nothing, and its ranking was unbuildable from what it showed.)
    for (const file of TEMPLATE_FILES) {
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

  it("every template states the same publish contract, because no feature has one of its own", () => {
    // `protocol` is a FLOOR, and a template is copied VERBATIM — so the key is either in every one
    // of them or it teaches that declaring it is optional decoration.
    //
    // Asserted against the constant rather than a literal, so that the day a feature DOES move the
    // contract, this fails and says which samples were left behind. What it must not become is a
    // per-template number: `uidField` briefly had one (2.0.0, then 1.1.0), and pasting it into the
    // board sample alone was how that looked from here. It bought nothing — an older build refuses
    // an unknown key at its own manifest schema, before any version is compared — and a floor a
    // sample declares for a feature is a floor every author then copies. See U10 in
    // `plans/feat-shared-app-uid-identity.md`.
    for (const file of TEMPLATE_FILES) {
      const manifest = blocksOf(file).get("app.json") as Record<string, unknown> | undefined;
      expect(`${file}: ${String(manifest?.protocol)}`).toBe(`${file}: ${APP_PROTOCOL}`);
    }
  });

  it("makes every template choose its own colour rather than inherit one", () => {
    // A template is copied VERBATIM — the same reason the canvas rule above is asserted here. So
    // whatever colour a template ships is the colour of every app written from it, and seven
    // templates sharing one would mean every shared app in the world arriving in it.
    //
    // The palette is derived from a single `--hue`, so this reads that one number: it is the only
    // decision a page has to make to look like somebody made it, and the one an author skips.
    const hues = new Map<string, string>();
    for (const file of TEMPLATE_FILES) {
      const text = readFileSync(path.join(TEMPLATES, file), "utf8");
      const hue = /--hue:\s*([0-9.]+)\s*;/.exec(text)?.[1];
      // Declared at all: a template whose sheet lost its palette teaches the grey it fell back to.
      expect(`${file}: declares --hue = ${hue !== undefined}`).toBe(`${file}: declares --hue = true`);
      const already = hues.get(hue ?? "");
      const whose = already === undefined ? "its own" : "shared with " + already;
      expect(`${file}: --hue ${hue} is ${whose}`).toBe(`${file}: --hue ${hue} is its own`);
      hues.set(hue ?? "", file);
    }
    // And the guard on the guard, so this cannot pass over an empty list.
    expect(hues.size).toBe(TEMPLATE_FILES.length);
  });

  it("keeps the design guide's worked palette out of the templates", () => {
    // `design.md` carries a fuller stylesheet than any template ships, and tells the reader not to
    // publish its colours. A document that only ASKS to be re-coloured gets copied anyway — this is
    // what makes the ask true, and it is also why the guide's hue is one no template uses.
    const guide = readFileSync(path.join(TEMPLATES, "design.md"), "utf8");
    const example = /--hue:\s*([0-9.]+)\s*;/.exec(guide)?.[1];
    expect(`design.md: has a worked --hue = ${example !== undefined}`).toBe("design.md: has a worked --hue = true");
    for (const file of TEMPLATE_FILES) {
      const hue = /--hue:\s*([0-9.]+)\s*;/.exec(readFileSync(path.join(TEMPLATES, file), "utf8"))?.[1];
      expect(`${file}: copied the guide's hue = ${hue === example}`).toBe(`${file}: copied the guide's hue = false`);
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
    expect([...blocksOf("live-poll.md").keys()]).toEqual(expect.arrayContaining([".claude/skills/questions/schema.json", ".claude/skills/votes/schema.json"]));
    expect([...blocksOf("todo-board.md").keys()]).toEqual(expect.arrayContaining([".claude/skills/tasks/schema.json", ".claude/skills/claims/schema.json"]));
    expect([...blocksOf("project-board.md").keys()]).toEqual(
      expect.arrayContaining([".claude/skills/tasks/schema.json", ".claude/skills/names/schema.json", ".claude/skills/assignments/schema.json"]),
    );
  });
});
