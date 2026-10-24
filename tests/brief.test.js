import { test } from "node:test";
import assert from "node:assert/strict";
import { makeBrief, numbersIn, planSize, shortName, cut, LIMITS } from "../lib/brief.js";
import { fixtureState, mySkate, TODAY } from "./helpers.js";

const W = "pre-free-skate.waltz-jump";
const U = "pre-free-skate.one-foot-upright-spin";
const X = "pre-free-skate.bkwd-xovers-bo-glide";
const Z = "pre-free-skate.mazurka";

async function brief(change = (s) => s, opts = {}) {
  const ms = await mySkate();
  const state = change(await fixtureState());
  return makeBrief(ms, state, { today: TODAY, date: "2026-10-24", slotMin: 60, ...opts });
}
const factText = (b, id) => b.factById.get(id).text;
const skillFact = (b, skillId) => b.facts.find((f) => f.id.startsWith("S") && f.skillId === skillId);

test("numbers in text, short names, and cutting", () => {
  assert.deepEqual(numbersIn("Landed 4 of 12 on Thu, Oct 22; 042 in all"), ["4", "12", "22", "42"]);
  assert.deepEqual(numbersIn("no numbers"), []);
  assert.equal(shortName("Mazurka (right or left)"), "Mazurka");
  assert.equal(shortName("One-foot upright spin (3+ revolutions, entry and free foot position optional)"), "One-foot upright spin");
  assert.equal(shortName("Waltz jump"), "Waltz jump");
  assert.equal(cut("  a   b  ", 10), "a b");
  assert.equal(cut("abcdefghijkl", 6), "abcde…");
});

test("a plan's size follows the length of the ice time", () => {
  assert.deepEqual(planSize(60), { minItems: 2, maxItems: 6 });
  assert.deepEqual(planSize(15), { minItems: 2, maxItems: 3 });
  assert.deepEqual(planSize(10), { minItems: 2, maxItems: 2 });
});

test("the general facts: the day, the levels, the last 4 weeks, and the recent sessions", async () => {
  const b = await brief();
  assert.equal(factText(b, "D1"), "Today is Fri, Oct 23, 2026. The plan is for Sat, Oct 24: 60 minutes on the ice.");
  assert.equal(factText(b, "L1"), "Levels: skating skills at Pre-Free Skate, jumps and spins at Pre-Free Skate.");
  assert.equal(factText(b, "W1"), "Last 4 weeks: 9 sessions, 7 hrs 59 mins on the ice.");
  assert.equal(factText(b, "R1"), "Thu, Oct 22 (yesterday): 55 minutes on the ice, 4 skills rated.");
  assert.equal(factText(b, "R5"), "Sat, Oct 10 (13 days ago): 57 minutes on the ice, 3 skills rated.");
  assert.equal(b.factById.has("R6"), false);
  assert.ok(["D1", "L1", "W1", "R1"].every((id) => b.factById.get(id).skillId === ""));
});

test("open homework, open goals, the test, and the next competition, but nothing finished or past", async () => {
  const b = await brief();
  assert.equal(factText(b, "H1"), 'Homework from the coach for Backward crossovers to a backward outside edge glide, due Mon, Oct 26 (in 3 days): "3 sets of back crossovers each way before every session".');
  assert.equal(b.factById.get("H1").skillId, X);
  assert.equal(factText(b, "H2"), 'Homework from the coach for Mazurka, due Sat, Oct 31 (in 8 days): "Try the mazurka on both sides, slowly".');
  assert.equal(b.factById.has("H3"), false, "done homework is left out");
  assert.equal(factText(b, "G1"), "Goal: Waltz jump to 4 stars by Sun, Nov 15 (in 23 days); now 3 stars.");
  assert.equal(b.factById.has("G2"), false, "a goal already met is left out");
  assert.equal(factText(b, "T1"), "Test: the Pre-preliminary skating skills test on Mon, Nov 16 (in 24 days).");
  assert.match(factText(b, "E1"), /^Competition: Fall Classic on Sun, Nov 8 \(in 16 days\)\. Their program for it has Waltz jump; Two forward crossovers .*; One-foot upright spin\.$/);
  assert.ok(!b.text.includes("Summer Skate"), "a past competition is left out");
});

test("each skill's fact uses MySkate's own numbers and the skater's own words", async () => {
  const b = await brief();
  const waltz = skillFact(b, W).text;
  assert.match(waltz, /^Waltz jump \[pre-free-skate\.waltz-jump\]: jump, a goal, in the Fall Classic program, on their level, practiced lately\./);
  assert.ok(waltz.includes("Latest 3 stars on Thu, Oct 22, best 3, rated in 9 sessions, last ratings 2, 3, 3."));
  assert.ok(waltz.includes("Landed 4 of 12 on Thu, Oct 22; 42 of 108 in all (39%)."));
  assert.ok(waltz.includes("Last practiced Thu, Oct 22 (yesterday)."));
  assert.ok(waltz.includes("MySkate's own pick: needs work."));
  assert.ok(waltz.includes('Their cue: "Bend the knee and check the landing for a count of 3".'));
  assert.ok(waltz.includes('Their notes: "Landed better after slowing the entry" (Tue, Oct 20); "Rushed the entry" (Sat, Oct 17).'));
  const spin = skillFact(b, U).text;
  assert.ok(spin.includes("Latest 2 stars on Wed, Oct 7") && spin.includes("Last practiced Wed, Oct 7 (16 days ago)."));
  assert.ok(skillFact(b, X).text.includes("Earned (4 stars or more)."));
  assert.ok(skillFact(b, Z).text.includes("Not tried yet.") && skillFact(b, Z).text.includes("MySkate's own pick: new."));
  assert.deepEqual(b.ownWords.get(W), ["Bend the knee and check the landing for a count of 3", "Landed better after slowing the entry", "Rushed the entry"]);
  assert.deepEqual(b.ownWords.get(X), ["3 sets of back crossovers each way before every session"]);
  assert.deepEqual(b.ownWords.get("pre-free-skate.bkwd-inside-pivots"), []);
});

test("the skills to choose from: homework first, then goals, the program, the levels, the test, and the next level", async () => {
  const b = await brief();
  const ids = b.candidates.map((c) => c.skillId);
  assert.deepEqual(ids.slice(0, 5), [X, Z, W, "pre-free-skate.xover-mohawk-sequence", U]);
  assert.ok(ids.includes("pre-free-skate.bkwd-inside-pivots"), "bonus skills on the level are offered");
  assert.ok(ids.includes("ss.pre-preliminary.waltz-eight"), "the test's skills are offered");
  assert.ok(ids.includes("free-skate-1.toe-loop"), "the next level is offered");
  assert.ok(!ids.includes("free-skate-2.salchow"), "two levels up is not");
  assert.equal(new Set(ids).size, ids.length);
  b.candidates.forEach((c, i) => assert.equal(c.factId, `S${i + 1}`));
  for (const id of ids) assert.equal(b.text.split(`- ${id} (`).length, 2, `${id} is listed once`);
  assert.ok(b.text.endsWith("Reply with 2 to 6 skills. Minutes come in steps of 5, at least 5 each, and add up to exactly 60."));
});

test("never sends the skater's name, friends, costs, rinks, blades, or card", async () => {
  const b = await brief();
  for (const word of ["Sam", "Alex", "Tacoma", "Lakeside", "card-sam", "Freestyle blades", "$", "cost", "Stretch after skating"]) {
    assert.ok(!b.text.includes(word), `the brief does not mention ${word}`);
  }
});

test("works for a skater with no sessions, no homework, no goals, no test, and no competition", async () => {
  const b = await brief((s) => ({ ...s, sessions: [], homework: [], goals: [], events: [], programs: [], cues: {}, profile: { ...s.profile, test: null } }));
  assert.equal(factText(b, "R1"), "No sessions logged yet.");
  assert.equal(factText(b, "W1"), "Last 4 weeks: 0 sessions, 0 mins on the ice.");
  assert.ok(!b.factById.has("H1") && !b.factById.has("G1") && !b.factById.has("T1") && !b.factById.has("E1"));
  assert.ok(b.candidates.length >= 8, "the level's skills are still offered");
  assert.ok(b.candidates.every((c) => skillFact(b, c.skillId).text.includes("Not tried yet.")));
});

test("a competition more than 60 days away and a test date already past are left out", async () => {
  const b = await brief((s) => ({
    ...s,
    events: s.events.map((e) => (e.id === "ev1" ? { ...e, date: "2027-01-10" } : e)),
    profile: { ...s.profile, test: { id: "pre-preliminary", date: "2026-10-01" } },
  }));
  assert.ok(!b.factById.has("E1"));
  assert.ok(!b.factById.has("T1"));
  assert.ok(!b.candidates.some((c) => c.tags.some((t) => t.includes("program") || t.includes("test"))));
});

test("offers at most 60 skills, however many were practiced", async () => {
  const ms = await mySkate();
  const all = [...ms.catalog.skills.keys()];
  const b = await brief((s) => ({ ...s, sessions: [...s.sessions, { ...s.sessions[9], id: "big", entries: all.map((skillId) => ({ skillId, stars: 2, landed: 0, attempts: 0, note: "" })) }] }));
  assert.equal(b.candidates.length, LIMITS.candidates);
});
