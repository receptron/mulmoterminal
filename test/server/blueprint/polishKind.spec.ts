// @vitest-environment node
// The kinds of document polish offers, and the genre chaff measures each by. The interview's options are the
// kinds' options, word for word: an option the list does not know would measure by no genre at all.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CHAFF_DEFAULT_STYLE, FIX_SHELVED, FOLDER_STYLE, genreArgs, genreOf, readKinds, shelvedArgs } from "../../../blueprints/polish/checks/kind.mjs";
import { PACKS } from "./docsPackHarness";

// `npx chaffjs@0.21 genres`. A kind naming a genre chaff lacks stops every chaff run of the build (chaff refuses an
// unknown genre), so a genre renamed upstream shows here first.
const CHAFF_GENRES = [
  "technical/spec",
  "technical/readme",
  "blog/tech",
  "blog/essay",
  "blog/owned-media",
  "business/proposal",
  "business/report",
  "business/email",
  "business/press-release",
  "business/meeting-notes",
  "legal/contract",
  "legal/statute",
  "legal/judgment",
  "legal/patent",
  "docs/manual",
  "docs/faq",
  "docs/glossary",
  "academic/paper",
  "literature/fiction",
  "literature/essay",
  "literature/poetry",
  "literature/play",
  "speech/address",
  "speech/transcript",
];

const kinds = readKinds(join(PACKS, "polish"));
const hearing = JSON.parse(readFileSync(join(PACKS, "polish", "hearing.json"), "utf8"));
const kindQuestion = hearing.questions.find((question: { id: string }) => question.id === "kind");

describe("polish: the kinds of document", () => {
  it("are the interview's options, in its order, with the one left to chaff first and the default", () => {
    expect(kindQuestion.options).toEqual(kinds.map((kind) => kind.option));
    expect(kindQuestion.default).toBe(kinds[0]?.option);
    expect(kinds[0]?.genre).toBeNull();
    expect(kindQuestion.showIf).toEqual({ id: "style", equals: CHAFF_DEFAULT_STYLE });
  });

  it("measure each kind as its own genre", () => {
    expect(Object.fromEntries(kinds.map((kind) => [kind.option, kind.genre]))).toEqual({
      "指定しない（chaff に任せる）": null,
      "ブログ（技術記事）": "blog/tech",
      "ブログ（エッセイ・読み物）": "blog/essay",
      "会社のサイトの記事（オウンドメディア）": "blog/owned-media",
      報告書: "business/report",
      "提案書・企画書": "business/proposal",
      メール: "business/email",
      プレスリリース: "business/press-release",
      議事録: "business/meeting-notes",
      "マニュアル・手順書": "docs/manual",
      "README・技術文書": "technical/readme",
      仕様書: "technical/spec",
      "契約書・利用規約": "legal/contract",
      "規程・社内規則": "legal/statute",
      "よくある質問（FAQ）": "docs/faq",
      用語集: "docs/glossary",
      判決文: "legal/judgment",
      特許明細書: "legal/patent",
      論文: "academic/paper",
      "小説・物語": "literature/fiction",
      "文学のエッセイ・随筆": "literature/essay",
      詩: "literature/poetry",
      "戯曲・脚本": "literature/play",
      "演説・挨拶の原稿": "speech/address",
      "書き起こし（会見・会議での発言の記録）": "speech/transcript",
    });
  });

  it("offer every genre chaff has", () => {
    expect(kinds.flatMap((kind) => (kind.genre === null ? [] : [kind.genre])).sort()).toEqual([...CHAFF_GENRES].sort());
  });

  it("each name a genre chaff has, each only once", () => {
    const genres = kinds.flatMap((kind) => (kind.genre === null ? [] : [kind.genre]));
    genres.forEach((genre) => expect(CHAFF_GENRES).toContain(genre));
    expect(new Set(genres).size).toBe(genres.length);
  });

  it("picks the genre only with chaff's own style", () => {
    expect(genreOf({ style: CHAFF_DEFAULT_STYLE, kind: "報告書" }, kinds)).toBe("business/report");
    expect(genreOf({ style: CHAFF_DEFAULT_STYLE, kind: "議事録" }, kinds)).toBe("business/meeting-notes");
    expect(genreOf({ style: CHAFF_DEFAULT_STYLE, kind: "契約書・利用規約" }, kinds)).toBe("legal/contract");
    expect(genreOf({ style: CHAFF_DEFAULT_STYLE, kind: "規程・社内規則" }, kinds)).toBe("legal/statute");
    expect(genreOf({ style: CHAFF_DEFAULT_STYLE, kind: "マニュアル・手順書" }, kinds)).toBe("docs/manual");
    expect(genreOf({ style: "このフォルダの規約（STYLE.md と chaff.yaml）", kind: "報告書" }, kinds)).toBeNull();
  });

  it.each([
    ["a kind left to chaff", { style: CHAFF_DEFAULT_STYLE, kind: "指定しない（chaff に任せる）" }],
    ["no kind", { style: CHAFF_DEFAULT_STYLE }],
    ["an unknown kind", { style: CHAFF_DEFAULT_STYLE, kind: "短歌" }],
    ["a kind that is not text", { style: CHAFF_DEFAULT_STYLE, kind: 3 }],
    ["no answers", null],
    ["answers that are not an object", "報告書"],
  ])("picks none for %s", (_label, answers) => {
    expect(genreOf(answers, kinds)).toBeNull();
  });

  it("turns a genre into chaff's argument, and none into nothing", () => {
    expect(genreArgs("blog/tech")).toEqual(["--genre", "blog/tech"]);
    expect(genreArgs(null)).toEqual([]);
  });
});

describe("polish: the findings a baseline shelved", () => {
  it("are shown only when the folder's style is used and the person asked for them", () => {
    expect(shelvedArgs({ style: FOLDER_STYLE, shelved: FIX_SHELVED })).toEqual(["--show-baseline"]);
    expect(shelvedArgs({ style: FOLDER_STYLE, shelved: "新しい指摘だけ" })).toEqual([]);
    expect(shelvedArgs({ style: FOLDER_STYLE })).toEqual([]);
    expect(shelvedArgs({ style: CHAFF_DEFAULT_STYLE, shelved: FIX_SHELVED })).toEqual([]);
    expect(shelvedArgs(null)).toEqual([]);
  });

  it("name the interview's own option and style", () => {
    const question = hearing.questions.find((entry: { id: string }) => entry.id === "shelved");
    expect(question.options).toContain(FIX_SHELVED);
    expect(question.showIf).toEqual({ id: "style", equals: FOLDER_STYLE });
    expect(question.needsPath).toEqual({ [FIX_SHELVED]: ".chaff-baseline.json" });
    expect(hearing.questions.find((entry: { id: string }) => entry.id === "style").options).toContain(FOLDER_STYLE);
  });
});
