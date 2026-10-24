import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeBrief } from "../lib/brief.js";
import { checkPlan } from "../lib/check.js";
import { fixtureState, mySkate, TODAY } from "./helpers.js";

const GOOD = JSON.parse(readFileSync(new URL("./fixtures/replies/good.json", import.meta.url), "utf8"));

let setup = null;
async function check(change = () => {}) {
  if (!setup) {
    const ms = await mySkate();
    setup = { ms, brief: makeBrief(ms, await fixtureState(), { today: TODAY, date: "2026-10-24", slotMin: 60 }) };
  }
  const reply = structuredClone(GOOD);
  const changed = change(reply);
  return checkPlan(changed === undefined ? reply : changed, setup.brief, setup.ms.catalog);
}
const only = async (change) => (await check(change)).problems;

test("a good reply passes, as it is, with each skill's name added", async () => {
  const r = await check();
  assert.deepEqual(r.problems, []);
  assert.equal(r.ok, true);
  assert.equal(r.plan.date, "2026-10-24");
  assert.equal(r.plan.slotMin, 60);
  assert.equal(r.plan.summary, GOOD.summary);
  assert.deepEqual(r.plan.items.map((i) => [i.name, i.minutes]), [
    ["Backward crossovers to a backward outside edge glide", 10],
    ["Waltz jump", 20],
    ["One-foot upright spin", 15],
    ["Mazurka", 10],
    ["Two forward crossovers into a forward inside mohawk, step down and cross behind, one backward crossover, step to a forward inside edge", 5],
  ]);
  assert.equal(r.plan.items[1].focus, "check the landing for a count of 3");
});

test("a reply that is not a plan at all", async () => {
  assert.deepEqual(await only(() => null), ["The reply is not a JSON object."]);
  assert.deepEqual(await only(() => [GOOD]), ["The reply is not a JSON object."]);
  assert.deepEqual(await only(() => "a plan"), ["The reply is not a JSON object."]);
  assert.deepEqual(await only((r) => ({ summary: r.summary })), ['The reply has no "items" list.']);
});

test("skills must be real, offered, and only once", async () => {
  assert.deepEqual(await only((r) => void (r.items[0].skillId = "free-skate-1.toe-loops")), [
    'Skill 1 ("free-skate-1.toe-loops") is not a MySkate skill.',
  ]);
  assert.deepEqual(await only((r) => void (r.items[0].skillId = "free-skate-2.salchow")), [
    'Skill 1 ("free-skate-2.salchow") is a MySkate skill but not one of the skills offered.',
  ]);
  const twice = await only((r) => void (r.items[4] = { ...r.items[3] }));
  assert.ok(twice.includes('Skill 5 ("pre-free-skate.mazurka") is in the plan twice.'));
  assert.deepEqual(await only((r) => void delete r.items[0].skillId), ["Skill 1 has no skillId."]);
});

test("between 2 and 6 skills", async () => {
  const one = await only((r) => void (r.items = [{ ...r.items[1], minutes: 60 }]));
  assert.deepEqual(one, ["The plan has 1 skills; it needs 2 to 6."]);
  const seven = await only((r) => {
    const extra = { skillId: "pre-free-skate.fi-open-mohawk", minutes: 5, why: "Earned, a quick refresh", facts: ["S6"], focus: "" };
    const more = { skillId: "pre-free-skate.bo-to-fo-transition", minutes: 5, why: "3 stars now", facts: ["S7"], focus: "" };
    r.items[1].minutes = 10;
    r.items.push(extra, more);
  });
  assert.deepEqual(seven, ["The plan has 7 skills; it needs 2 to 6."]);
});

test("minutes come in steps of 5, at least 5, and fill the ice time exactly", async () => {
  assert.deepEqual(await only((r) => void (r.items[1].minutes = 25)), ["The minutes add up to 65, not 60."]);
  assert.deepEqual(await only((r) => void (r.items[1].minutes = 15)), ["The minutes add up to 55, not 60."]);
  const twelve = await only((r) => void (r.items[0].minutes = 12));
  assert.deepEqual(twelve, ['Skill 1 ("pre-free-skate.bkwd-xovers-bo-glide") has 12 minutes; minutes must be a whole number in steps of 5, at least 5.']);
  const text = await only((r) => void (r.items[0].minutes = "10"));
  assert.deepEqual(text, ['Skill 1 ("pre-free-skate.bkwd-xovers-bo-glide") has "10" minutes; minutes must be a whole number in steps of 5, at least 5.']);
  assert.match((await only((r) => void (r.items[0].minutes = 0)))[0], /has 0 minutes/);
  assert.match((await only((r) => void delete r.items[0].minutes))[0], /has no minutes/);
});

test("every number in a reason must be in a fact the reason cites", async () => {
  assert.deepEqual(await only((r) => void (r.items[1].why = "8 of 12 landed Thursday")), [
    'Skill 2 ("pre-free-skate.waltz-jump"): the reason uses 8, which is not in the facts it cites.',
  ]);
  /* 16 days is in the spin's fact, but not in the waltz jump's, so it cannot be used there. */
  assert.deepEqual(await only((r) => void (r.items[1].why = "not practiced in 16 days or 5 weeks")), [
    'Skill 2 ("pre-free-skate.waltz-jump"): the reason uses 16, 5, which are not in the facts it cites.',
  ]);
  /* The check is that each number is somewhere in the cited facts, not that the sentence is true: 2 is one of the waltz jump's
     last ratings, so "2 weeks" gets through. README.md says so. */
  assert.deepEqual(await only((r) => void (r.items[1].why = "not practiced in 2 weeks")), []);
  /* A number from a cited general fact is fine (E1 has 16 days), and so are the skill's own minutes. */
  assert.deepEqual(await only((r) => void (r.items[4].why = "Competition in 16 days; 5 quick minutes")), []);
  /* Clock times count as two numbers. */
  assert.match((await only((r) => void (r.items[2].why = "Spin at 1:45")))[0], /uses 1, 45, which are not/);
});

test("a reason is short, on one line, and there", async () => {
  assert.match((await only((r) => void (r.items[0].why = "x".repeat(91))))[0], /the reason is 91 characters; at most 90/);
  assert.match((await only((r) => void (r.items[0].why = "Homework\ndue Monday")))[0], /line break/);
  assert.deepEqual(await only((r) => void (r.items[0].why = "  ")), ['Skill 1 ("pre-free-skate.bkwd-xovers-bo-glide") has no reason ("why").']);
});

test("a reason cites 1 to 4 real facts, each about this skill or about the whole session", async () => {
  assert.deepEqual(await only((r) => void (r.items[0].facts = [])), ['Skill 1 ("pre-free-skate.bkwd-xovers-bo-glide") must cite 1 to 4 fact ids.']);
  assert.match((await only((r) => void (r.items[0].facts = ["H1", "S1", "D1", "L1", "W1"])))[0], /must cite 1 to 4 fact ids/);
  assert.deepEqual(await only((r) => void (r.items[0].facts = ["H1", "S99"])), ['Skill 1 ("pre-free-skate.bkwd-xovers-bo-glide") cites S99, which is not a fact.']);
  assert.deepEqual(await only((r) => void (r.items[1].facts = ["S3", "S5"])), ['Skill 2 ("pre-free-skate.waltz-jump") cites S5, which is about another skill.']);
  assert.match((await only((r) => void (r.items[0].facts = "H1")))[0], /must cite 1 to 4 fact ids/);
});

test("a focus is copied from the skater's own words for that skill, in any case or quotes", async () => {
  assert.deepEqual(await only((r) => void (r.items[1].focus = "“Check the landing for a count of 3.”")), []);
  assert.deepEqual(await only((r) => void (r.items[1].focus = "Rushed the entry")), []);
  assert.deepEqual(await only((r) => void (r.items[1].focus = "Keep your arms tight on the landing")), [
    'Skill 2 ("pre-free-skate.waltz-jump"): the focus is not copied word for word from the skater\'s own cue, notes, or homework for this skill.',
  ]);
  /* Words from another skill's notes do not count. */
  assert.match((await only((r) => void (r.items[1].focus = "Keep the free hip square")))[0], /not copied word for word/);
  assert.match((await only((r) => void (r.items[3].focus = "on")))[0], /not copied word for word/);
  assert.match((await only((r) => void (r.items[3].focus = 3)))[0], /the focus must be text/);
  assert.deepEqual(await only((r) => void delete r.items[3].focus), []);
});

test("the summary is short and uses only numbers from the facts", async () => {
  assert.deepEqual(await only((r) => void (r.summary = "Waltz jump: you landed 11 of 12 last time")), ["The summary uses 11, which is not in the facts."]);
  assert.deepEqual(await only((r) => void (r.summary = "60 minutes, 5 skills, homework first")), []);
  assert.deepEqual(await only((r) => void (r.summary = "")), ['The plan has no "summary".']);
  assert.match((await only((r) => void (r.summary = "y".repeat(141))))[0], /141 characters; at most 140/);
});

test("lists every problem at once, in order, so one retry can fix them all", async () => {
  const problems = await only((r) => {
    r.items[0].skillId = "nope";
    r.items[1].why = "11 of 12";
    r.items[2].minutes = 20;
    r.summary = "";
  });
  assert.deepEqual(problems, [
    'Skill 1 ("nope") is not a MySkate skill.',
    'Skill 2 ("pre-free-skate.waltz-jump"): the reason uses 11, which is not in the facts it cites.',
    "The minutes add up to 65, not 60.",
    'The plan has no "summary".',
  ]);
});
