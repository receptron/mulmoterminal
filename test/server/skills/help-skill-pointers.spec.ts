// @vitest-environment node
// The help skill is an index of WHERE to read, and an index is only worth shipping while its
// pointers are real: a renamed guide page or a moved route would otherwise send a user to a file that
// is not there, with nothing failing anywhere (the same reasoning as faqEntries.ts for the bug-report
// FAQ). So every path, guide page, route and skill the SKILL.md names in backticks is checked here.
import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { BUNDLED_SKILL_NAMES } from "../../../common/bundledSkills.js";
import { helpSources } from "../../../server/help/help-sources.js";

const ROOT = process.cwd();
const SKILL = readFileSync(path.join(ROOT, "server", "skills", "mulmoterminal-help", "SKILL.md"), "utf8");
// What the route would answer for a git checkout at the repo root: the `files.<key>` placeholders the
// skill uses resolve through the same function, so the two cannot drift.
const SOURCES = helpSources(ROOT, "0.0.0", "git");

const spans = (): string[] => [...SKILL.matchAll(/`([^`\n]+)`/g)].map((match) => match[1] ?? "");
// A span with a placeholder, a glob, a shell fragment or a URL is an instruction, not a pointer.
const isLiteral = (span: string): boolean => !/[<>$*|() ]/.test(span) && !span.startsWith("http");
const literals = spans().filter(isLiteral);

const REPO_PATH = /^(docs|server|common|src|bin|README\.md|package\.json)(\/|$)/;
const GUIDE_PAGE = /^[a-z][a-z0-9-]*\.md$/;
const FILES_KEY = /^files\.([A-Za-z]+)/;
const URLS_KEY = /^urls\.([A-Za-z]+)$/;
const SKILL_NAME = /^\/?(mulmoterminal-[a-z-]+)/;
const ROUTE = /^\/api\//;

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith(".ts") ? [full] : [];
  });
const registeredRoutes = (): string[] =>
  sourceFiles(path.join(ROOT, "server")).flatMap((file) => [...readFileSync(file, "utf8").matchAll(/"(\/api\/[^"]*)"/g)].map((match) => match[1] ?? ""));

describe("mulmoterminal-help points at things that exist", () => {
  it("names at least one of each kind, so an edit that drops them all is noticed", () => {
    expect(literals.some((span) => REPO_PATH.test(span))).toBe(true);
    expect(literals.some((span) => GUIDE_PAGE.test(span))).toBe(true);
    expect(literals.some((span) => FILES_KEY.test(span))).toBe(true);
    expect(literals.some((span) => ROUTE.test(span))).toBe(true);
  });

  it("every repo path exists", () => {
    const missing = literals.filter((span) => REPO_PATH.test(span)).filter((span) => !existsSync(path.join(ROOT, span)));
    expect(missing).toEqual([]);
  });

  // A bare page name is a guide page, and the skill reads it in the user's language: both must ship.
  it("every guide page exists in English and in Japanese", () => {
    const pages = literals.filter((span) => GUIDE_PAGE.test(span));
    const missing = pages.flatMap((page) =>
      ["en", "ja"].filter((lang) => !existsSync(path.join(ROOT, "docs", "guide", lang, page))).map((lang) => `${lang}/${page}`),
    );
    expect(missing).toEqual([]);
  });

  it("every files.<key> is a field the route answers, and what hangs off it exists", () => {
    const files: Record<string, string> = SOURCES.files;
    const bad = literals
      .map((span) => FILES_KEY.exec(span))
      .flatMap((match) => (match === null ? [] : [{ key: match[1] ?? "", rest: match.input.slice(match[0].length) }]))
      .filter(({ key, rest }) => files[key] === undefined || !existsSync(path.join(files[key], rest)));
    expect(bad).toEqual([]);
  });

  it("every urls.<key> is a field the route answers", () => {
    const urls: Record<string, string> = SOURCES.urls;
    const bad = literals.map((span) => URLS_KEY.exec(span)?.[1]).filter((key): key is string => key !== undefined && urls[key] === undefined);
    expect(bad).toEqual([]);
  });

  it("every skill it hands off to is bundled", () => {
    const named = literals.map((span) => SKILL_NAME.exec(span)?.[1]).filter((name): name is string => name !== undefined);
    const unknown = named.filter((name) => !BUNDLED_SKILL_NAMES.some((bundled) => bundled === name));
    expect(unknown).toEqual([]);
  });

  // A route is named up to its first parameter or query (`/api/whats-new/version/`), so the check is
  // "some registered route starts with this", against the string literals the server registers.
  it("every /api route is one the server registers", () => {
    const registered = registeredRoutes();
    const named = spans()
      .filter((span) => ROUTE.test(span))
      .map((span) => span.split(/[<?]/)[0] ?? "");
    expect(named.length).toBeGreaterThan(0);
    const unknown = named.filter((route) => !registered.some((candidate) => candidate.startsWith(route)));
    expect(unknown).toEqual([]);
  });
});
