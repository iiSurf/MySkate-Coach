import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeBrief } from "../lib/brief.js";
import { checkPlan } from "../lib/check.js";
import { mySkatePlan } from "../lib/fallback.js";
import { coach, retryPrompt, runLog, writeLog } from "../lib/pipeline.js";
import { fixtureState, mySkate, tempDir, TODAY } from "./helpers.js";

const GOOD = JSON.parse(readFileSync(new URL("./fixtures/replies/good.json", import.meta.url), "utf8"));
const changed = (fn) => {
  const r = structuredClone(GOOD);
  fn(r);
  return r;
};
const TOO_LONG = changed((r) => (r.items[1].minutes = 25));
const answer = (reply) => ({ ok: true, reply, meta: { durationMs: 5 }, raw: { code: 0, stdout: "{}", stderr: "" } });

/* A stand-in for askClaude that gives these answers in turn and remembers each prompt. */
function asker(...answers) {
  const prompts = [];
  const ask = async (prompt) => {
    prompts.push(prompt);
    return answers[Math.min(prompts.length - 1, answers.length - 1)];
  };
  return { ask, prompts };
}

async function run(...answers) {
  const ms = await mySkate();
  const state = await fixtureState();
  const a = asker(...answers);
  const events = [];
  const on = { asking: (n) => events.push(`asking ${n}`), checked: (n, c) => events.push(`checked ${n} ${c.ok}`), failed: (n) => events.push(`failed ${n}`) };
  const result = await coach({ ms, state, today: TODAY, date: "2026-10-24", slotMin: 60, ask: a.ask, on });
  return { ...result, prompts: a.prompts, events, ms, state };
}

test("a good plan the first time is Claude's plan, asked once", async () => {
  const r = await run(answer(GOOD));
  assert.equal(r.source, "claude");
  assert.equal(r.retried, false);
  assert.equal(r.attempts.length, 1);
  assert.equal(r.plan.items.length, 5);
  assert.equal(r.prompts[0], r.brief.text);
  assert.deepEqual(r.events, ["asking 1", "checked 1 true"]);
});

test("a plan that fails the checks goes back once with the list of problems, and the fixed one is used", async () => {
  const r = await run(answer(TOO_LONG), answer(GOOD));
  assert.equal(r.source, "claude");
  assert.equal(r.retried, true);
  assert.deepEqual(r.attempts[0].problems, ["The minutes add up to 65, not 60."]);
  assert.ok(r.prompts[1].startsWith(r.brief.text));
  assert.ok(r.prompts[1].includes("Your last reply had these problems:\n- The minutes add up to 65, not 60.\n"));
  assert.ok(r.prompts[1].includes('"minutes": 25'));
  assert.ok(r.prompts[1].endsWith("Reply again with the whole plan, with every problem fixed."));
  assert.deepEqual(r.events, ["asking 1", "checked 1 false", "asking 2", "checked 2 true"]);
});

test("a plan that fails twice is not used: MySkate's own plan is, and it says why", async () => {
  const r = await run(answer(TOO_LONG));
  assert.equal(r.source, "myskate");
  assert.equal(r.reason, "Claude's plan did not pass the checks twice.");
  assert.equal(r.attempts.length, 2);
  assert.equal(r.plan.summary, "The skills MySkate itself suggests next, with your ice time shared out evenly.");
});

test("an answer that is not JSON, or no answer at all, is retried like any other failed check", async () => {
  const text = await run(answer("Work on your waltz jump."), answer(GOOD));
  assert.deepEqual(text.attempts[0].problems, ["The reply is not a JSON object."]);
  assert.ok(text.prompts[1].includes("Your last reply was:\nWork on your waltz jump.\n"));
  assert.equal(text.source, "claude");
  const none = await run(answer(null), answer(GOOD));
  assert.deepEqual(none.attempts[0].problems, ["The reply is not a JSON object."]);
  assert.equal(none.source, "claude");
});

test("when Claude Code itself fails, it is not asked again, and MySkate's own plan says why", async () => {
  const r = await run({ ok: false, error: "usage-limit", message: "Claude Code is at a usage limit: You've hit your session limit · resets 3:45pm", meta: {}, raw: null }, answer(GOOD));
  assert.equal(r.source, "myskate");
  assert.equal(r.attempts.length, 1);
  assert.equal(r.reason, "Claude Code is at a usage limit: You've hit your session limit · resets 3:45pm");
  assert.deepEqual(r.events, ["asking 1", "failed 1"]);
});

test("MySkate's own plan is the app's own suggestion, shares the ice time the app's way, and passes the same checks", async () => {
  const ms = await mySkate();
  const state = await fixtureState();
  for (const [slotMin, minutes] of [[60, [15, 15, 15, 15]], [45, [15, 15, 15]], [30, [15, 15]], [120, [20, 20, 20, 20, 20, 20]], [15, [10, 5]]]) {
    const brief = makeBrief(ms, state, { today: TODAY, date: "2026-10-24", slotMin });
    const plan = mySkatePlan(ms, state, brief);
    assert.deepEqual(plan.items.map((i) => i.minutes), minutes, `${slotMin} minutes`);
    /* MySkate's suggestions first; when it has too few (here at 120 minutes), the top of the brief's list fills the rest. */
    const expected = ms.stats.suggestNext(state, ms.catalog, ms.stats.skillStats(state.sessions), TODAY, minutes.length).map((s) => s.skillId);
    for (const c of brief.candidates) if (expected.length < minutes.length && !expected.includes(c.skillId)) expected.push(c.skillId);
    assert.deepEqual(plan.items.map((i) => i.skillId), expected);
    const reply = { summary: plan.summary, items: plan.items.map(({ name, ...rest }) => rest) };
    assert.deepEqual(checkPlan(reply, brief, ms.catalog).problems, [], `${slotMin} minutes passes the checks`);
  }
  const big = mySkatePlan(ms, state, makeBrief(ms, state, { today: TODAY, date: "2026-10-24", slotMin: 120 }));
  assert.equal(big.items[5].why, "MySkate's own pick: on your list");
});

test("the retry prompt shows the last reply as it was", async () => {
  const ms = await mySkate();
  const brief = makeBrief(ms, await fixtureState(), { today: TODAY, date: "2026-10-24", slotMin: 60 });
  const text = retryPrompt(brief, { items: [] }, ["The plan has 0 skills; it needs 2 to 6.", 'The plan has no "summary".']);
  assert.ok(text.includes('- The plan has 0 skills; it needs 2 to 6.\n- The plan has no "summary".'));
  assert.ok(text.includes('Your last reply was:\n{\n  "items": []\n}'));
});

test("the run log keeps every attempt, its problems, and the result, and is written where asked", async () => {
  const r = await run(answer(TOO_LONG), answer(GOOD));
  const log = runLog({ result: r, backup: { file: "myskate-backup-2026-10-23.json", sessions: 10 }, claude: { model: "sonnet" }, systemPrompt: "PROMPT", startedAt: "a", finishedAt: "b" });
  assert.deepEqual(log.attempts.map((a) => a.problems), [["The minutes add up to 65, not 60."], []]);
  assert.deepEqual(log.result.source, "claude");
  assert.equal(log.attempts[1].prompt, r.prompts[1]);
  assert.deepEqual(log.brief, { date: "2026-10-24", slotMin: 60, skillsOffered: 19, facts: 32 });
  const dir = tempDir("runs-");
  const now = new Date(2026, 9, 23, 21, 14, 5);
  const first = writeLog(dir, log, now);
  const second = writeLog(dir, log, now);
  assert.ok(first.endsWith("2026-10-23-211405.json"));
  assert.ok(second.endsWith("2026-10-23-211405-2.json"));
  assert.deepEqual(JSON.parse(readFileSync(first, "utf8")).result.plan.items.length, 5);
});
