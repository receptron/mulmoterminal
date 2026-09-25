// @vitest-environment node
import { describe, it, expect } from "vitest";
import { hearingSchema, unansweredQuestions, askedQuestions, type Hearing, type HearingAnswers } from "../../../common/blueprint/hearing";

const hearing: Hearing = hearingSchema.parse({
  questions: [
    { id: "domain", label: "Domain", why: "who may sign in", kind: "text" },
    { id: "external", label: "External users?", why: "changes the usecase", kind: "boolean" },
    { id: "externalWho", label: "Who?", why: "scope", kind: "text", showIf: { id: "external", equals: true } },
    { id: "roles", label: "Roles", why: "claims", kind: "multiselect", options: ["member", "admin"] },
    { id: "note", label: "Anything else", why: "free", kind: "text", required: false },
  ],
});

const ids = (answers: HearingAnswers) => unansweredQuestions(hearing, answers).map((q) => q.id);

describe("unansweredQuestions", () => {
  it("asks every required, unconditional question when nothing is known", () => {
    expect(ids({})).toEqual(["domain", "external", "roles"]);
  });

  it("asks only the gaps of a supplied spec", () => {
    expect(ids({ domain: "example.com", roles: ["admin"] })).toEqual(["external"]);
  });

  it("asks a conditional question once its condition holds", () => {
    expect(ids({ domain: "example.com", external: true, roles: ["member"] })).toEqual(["externalWho"]);
  });

  it("does not ask a conditional question when the condition fails", () => {
    expect(ids({ domain: "example.com", external: false, roles: ["member"] })).toEqual([]);
  });

  it("treats blank strings and empty selections as unanswered", () => {
    expect(ids({ domain: "   ", external: false, roles: [] })).toEqual(["domain", "roles"]);
  });

  it("counts false and zero as answers", () => {
    const numeric = hearingSchema.parse({ questions: [{ id: "users", label: "Users", why: "size", kind: "number" }] });
    expect(unansweredQuestions(numeric, { users: 0 })).toEqual([]);
  });
});

describe("askedQuestions", () => {
  const askedIds = (h: Hearing, answers: HearingAnswers) => askedQuestions(h, answers).map((q) => q.id);

  it("compares the condition strictly", () => {
    expect(askedIds(hearing, { external: "true" })).not.toContain("externalWho");
    expect(askedIds(hearing, { external: true })).toContain("externalWho");
  });

  // q1 -> q2 -> q3: a stale answer to q2 must not open q3 once q2 itself is no longer asked.
  const chain = hearingSchema.parse({
    questions: [
      { id: "q1", label: "q1", why: "w", kind: "boolean" },
      { id: "q2", label: "q2", why: "w", kind: "boolean", showIf: { id: "q1", equals: true } },
      { id: "q3", label: "q3", why: "w", kind: "text", showIf: { id: "q2", equals: true } },
    ],
  });

  it("follows a chain of conditions", () => {
    expect(askedIds(chain, { q1: true, q2: true })).toEqual(["q1", "q2", "q3"]);
  });

  it("closes the whole chain when its head is closed, whatever stale answers remain", () => {
    expect(askedIds(chain, { q1: false, q2: true })).toEqual(["q1"]);
    expect(unansweredQuestions(chain, { q1: false, q2: true }).map((q) => q.id)).toEqual([]);
  });
});

describe("hearingSchema", () => {
  const q = (id: string, extra: Record<string, unknown> = {}) => ({ id, label: id, why: "w", kind: "text", ...extra });

  it.each([
    ["duplicate ids", [q("a"), q("a")]],
    ["a select with no options", [q("a", { kind: "select" })]],
    ["a condition on a later question", [q("a", { showIf: { id: "b", equals: true } }), q("b")]],
    ["a condition on itself", [q("a", { showIf: { id: "a", equals: true } })]],
    ["a condition on an unknown question", [q("a", { showIf: { id: "zzz", equals: 1 } })]],
    ["no questions", []],
    ["a missing why", [{ id: "a", label: "a", kind: "text" }]],
  ])("rejects %s", (_label, questions) => {
    expect(hearingSchema.safeParse({ questions }).success).toBe(false);
  });

  it("defaults required to true", () => {
    expect(hearingSchema.parse({ questions: [q("a")] }).questions[0].required).toBe(true);
  });
});
