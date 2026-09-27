// Reads .blueprint/targets.json — the plan the survey writes and each round updates — and answers one
// question per mode. Exit 0 is yes. Modes:
//   survey    the plan is well formed, every target is still to do, it is within the agreed count, CI
//             gaps the base recorded come first as a "ci" target, and — when the person asked for the
//             ratchet and the repository has none — "tooling" targets follow before anything else
//   progress  the plan is well formed and more targets are finished than at the last passing round
//   prs       prints "<id> <pull request URL> <accepted states>" per finished target, for prs.sh to ask gh
//   more      some target is still to do (the tranche step's repeatWhile)
//   report    .blueprint/refactor-report.md names every target, and — when scoria measured before — the
//             after measurement exists and every dimension whose score fell is named in the report
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const KINDS = ["ci", "tooling", "decompose", "dedupe", "test", "dead-code", "types", "other"];
const STATUSES = ["todo", "done", "skipped"];
const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const PLAN = ".blueprint/targets.json";
const PROGRESS = ".blueprint/.targets-finished";

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

function targetProblem(target) {
  if (typeof target !== "object" || target === null) return "a target is not an object";
  if (typeof target.id !== "string" || !ID_RE.test(target.id)) return `bad id ${JSON.stringify(target.id)}`;
  if (!KINDS.includes(target.kind)) return `${target.id}: kind must be one of ${KINDS.join(", ")}`;
  if (typeof target.title !== "string" || !target.title) return `${target.id}: no title`;
  if (!Array.isArray(target.files) || target.files.length === 0) return `${target.id}: no files`;
  if (!STATUSES.includes(target.status)) return `${target.id}: status must be one of ${STATUSES.join(", ")}`;
  if (target.status === "done" && !/^https:\/\/github\.com\/.+\/pull\/\d+$/.test(target.pr ?? "")) return `${target.id}: done without a pull request URL`;
  if (target.status === "skipped" && !(typeof target.note === "string" && target.note.trim())) return `${target.id}: skipped without a note saying why`;
  return null;
}

function readPlan() {
  if (!existsSync(PLAN)) fail(`missing ${PLAN}`);
  let plan;
  try {
    plan = JSON.parse(readFileSync(PLAN, "utf8"));
  } catch (err) {
    fail(`${PLAN} is not JSON: ${err.message}`);
  }
  if (!Array.isArray(plan?.targets)) fail(`${PLAN} needs a "targets" array`);
  const problem = plan.targets.map(targetProblem).find((found) => found !== null);
  if (problem) fail(`${PLAN}: ${problem}`);
  const ids = plan.targets.map((target) => target.id);
  if (new Set(ids).size !== ids.length) fail(`${PLAN}: target ids repeat`);
  return plan.targets;
}

function answers() {
  try {
    return JSON.parse(readFileSync(".blueprint/answers.json", "utf8"));
  } catch {
    return {};
  }
}

const AUTO_MERGE = "CI が緑なら自動でマージする";

function agreedCount() {
  const { maxChanges } = answers();
  return typeof maxChanges === "number" && maxChanges > 0 ? maxChanges : Infinity;
}

function ciGaps() {
  try {
    const { gaps } = JSON.parse(readFileSync(".blueprint/ci.json", "utf8"));
    return Array.isArray(gaps) ? gaps : [];
  } catch {
    return [];
  }
}

function readJsonFile(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

// Dimensions scoria scored in both runs whose score is lower after — a fall the report must explain.
function fallenDimensions(before, after) {
  const scores = (report) => new Map((report?.dimensions ?? []).filter((d) => typeof d.score === "number").map((d) => [d.dimension, d.score]));
  const was = scores(before);
  return [...scores(after)].filter(([dimension, score]) => was.has(dimension) && score < was.get(dimension)).map(([dimension]) => dimension);
}

const finished = (targets) => targets.filter((target) => target.status !== "todo").length;

const MODES = {
  survey() {
    const targets = readPlan();
    if (!existsSync(".blueprint/spec.md") || !readFileSync(".blueprint/spec.md", "utf8").trim()) fail("missing .blueprint/spec.md, the plan the person reads");
    if (targets.some((target) => target.status !== "todo")) fail("a fresh plan has every target still to do");
    if (targets.length > agreedCount()) fail(`the plan has ${targets.length} targets; the agreed limit is ${agreedCount()}`);
    const afterCi = targets.filter((target) => target.kind !== "ci");
    if (answers().ratchet === true && !existsSync("eslint-suppressions.json") && afterCi[0]?.kind !== "tooling") {
      fail('the ratchet was asked for and the repository has none, so "tooling" targets (ever-better bootstrap, then freeze) come right after any "ci" one');
    }
    if (ciGaps().length > 0 && targets[0]?.kind !== "ci")
      fail('CI is missing gates (.blueprint/ci.json), so the first target must be the "ci" one that adds them');
  },
  progress() {
    const targets = readPlan();
    if (targets.length === 0) return;
    const before = existsSync(PROGRESS) ? Number(readFileSync(PROGRESS, "utf8")) || 0 : 0;
    const now = finished(targets);
    if (now <= before) fail(`no target was finished this round (${now} finished, as before); mark it done with its pull request, or skipped with a note`);
    writeFileSync(PROGRESS, String(now));
  },
  prs() {
    const accepted = answers().merge === AUTO_MERGE ? "MERGED" : "OPEN,MERGED";
    readPlan()
      .filter((target) => target.status === "done")
      .forEach((target) => console.log(`${target.id} ${target.pr} ${accepted}`));
  },
  more() {
    if (!readPlan().some((target) => target.status === "todo")) process.exit(1);
  },
  report() {
    const targets = readPlan();
    const file = ".blueprint/refactor-report.md";
    if (!existsSync(file)) fail(`missing ${file}`);
    const report = readFileSync(file, "utf8");
    const unnamed = targets.filter((target) => !report.includes(target.id)).map((target) => target.id);
    if (unnamed.length) fail(`the report does not mention: ${unnamed.join(", ")}`);
    if (!existsSync(".blueprint/scoria-before.json")) return;
    const after = readJsonFile(".blueprint/scoria-after.json");
    if (!after) fail("scoria measured before the work, so .blueprint/scoria-after.json must hold the measurement after it");
    const unexplained = fallenDimensions(readJsonFile(".blueprint/scoria-before.json"), after).filter((dimension) => !report.includes(dimension));
    if (unexplained.length) fail(`scoria scored these lower after the work, and the report does not say why: ${unexplained.join(", ")}`);
  },
};

const mode = MODES[process.argv[2]];
if (!mode) fail(`unknown mode ${process.argv[2]}; one of ${Object.keys(MODES).join(", ")}`);
mode();
