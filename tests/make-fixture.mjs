/* Makes tests/fixtures/backup.json: a made-up MySkate backup for the tests (no real person's data). It is built with MySkate's
   own code, so it has exactly the shape a real backup has. Run it again after changing it: node tests/make-fixture.mjs */

import { writeFileSync } from "node:fs";
import { findMySkate, loadMySkate } from "../lib/myskate.js";

const ms = await loadMySkate(findMySkate());
const NOW = new Date(2026, 9, 23, 19, 30); // Fri, Oct 23, 2026, 7:30 pm

const W = "pre-free-skate.waltz-jump";
const U = "pre-free-skate.one-foot-upright-spin";
const M = "pre-free-skate.fi-open-mohawk";
const X = "pre-free-skate.bkwd-xovers-bo-glide";
const T = "pre-free-skate.bo-to-fo-transition";
const Q = "pre-free-skate.xover-mohawk-sequence";
const Z = "pre-free-skate.mazurka";

let n = 0;
/* A session: its day, minutes on the ice, and [skill, stars, landed, attempts, note] for each skill rated. */
function session(date, minutes, entries, cost = 18) {
  n += 1;
  return {
    id: `s${n}`,
    date,
    startedAt: `${date}T13:00:00.000Z`,
    bookedMin: 60,
    onIceSec: minutes * 60,
    entries: entries.map(([skillId, stars, landed = 0, attempts = 0, note = ""]) => ({ skillId, stars, landed, attempts, note })),
    note: "",
    cost,
  };
}

const state = ms.store.defaultState(NOW);
Object.assign(state.profile, {
  name: "Sam",
  levels: { skills: "lts-freeskate/pre-free-skate", jumps: "lts-freeskate/pre-free-skate" },
  defaultSlotMin: 60,
  onboarded: true,
  tourSeen: true,
  defaultCost: 18,
  cardId: "card-sam",
  test: { id: "pre-preliminary", date: "2026-11-16" },
});
state.blades = { name: "Freestyle blades", limitHours: 25, baseHours: 3, lifetimeBase: 40, countedFrom: "2026-09-01T12:00:00.000Z" };
state.plan = { slotMin: 60, skillIds: [] };
state.sessions = [
  session("2026-09-21", 50, [[W, 2, 3, 10], [U, 2], [M, 3], [X, 3]]),
  session("2026-09-26", 55, [[W, 2, 4, 12], [X, 3], [T, 2]]),
  session("2026-09-30", 52, [[M, 4], [W, 2, 5, 12], [U, 2, 0, 0, "Traveling a lot, stay on the ball of the foot"]]),
  session("2026-10-03", 58, [[X, 4], [T, 3], [Q, 2]], 22),
  session("2026-10-07", 50, [[U, 2], [W, 3, 6, 12], [M, 4]]),
  session("2026-10-10", 57, [[X, 4], [Q, 2], [W, 3, 5, 12]]),
  session("2026-10-14", 45, [[T, 3], [W, 3, 7, 14]]),
  session("2026-10-17", 55, [[M, 5], [Q, 3], [W, 2, 3, 12, "Rushed the entry"]]),
  session("2026-10-20", 52, [[X, 4], [T, 3], [W, 3, 5, 12, "Landed better after slowing the entry"]]),
  session("2026-10-22", 55, [[W, 3, 4, 12], [Q, 3], [T, 3], [M, 4, 0, 0, "Keep the free hip square"]]),
];
state.cues = {
  [W]: "Bend the knee and check the landing for a count of 3",
  [U]: "Find the ball of the foot, arms in slowly",
};
state.homework = [
  { id: "hw1", text: "3 sets of back crossovers each way before every session", skillId: X, due: "2026-10-26", done: false, created: "2026-10-17" },
  { id: "hw2", text: "Try the mazurka on both sides, slowly", skillId: Z, due: "2026-10-31", done: false, created: "2026-10-20" },
  { id: "hw3", text: "Stretch after skating", skillId: "", due: "", done: true, doneOn: "2026-10-18", created: "2026-10-10" },
];
state.goals = [
  { id: "g1", skillId: W, target: 4, date: "2026-11-15", created: "2026-10-01" },
  { id: "g2", skillId: M, target: 4, date: "", created: "2026-09-20" },
];
state.events = [
  { id: "ev0", name: "Summer Skate", date: "2026-08-15", place: "Lakeside Ice Arena", result: { programId: "", placing: 2, of: 6, note: "Fun!" } },
  { id: "ev1", name: "Fall Classic", date: "2026-11-08", place: "Lakeside Ice Arena" },
];
state.programs = [
  {
    id: "pr1",
    name: "Fall Classic free skate",
    eventId: "ev1",
    lengthSec: 90,
    kind: "free",
    elements: [
      { id: "e1", label: "Waltz jump", type: "jump", skillId: W, x: 0.3, y: 0.4, at: 12, dur: 4 },
      { id: "e2", label: "Crossover mohawk sequence", type: "steps", skillId: Q, x: 0.6, y: 0.5, at: 30, dur: 12 },
      { id: "e3", label: "One-foot upright spin", type: "spin", skillId: U, x: 0.5, y: 0.5, at: 70, dur: 8 },
    ],
  },
];
state.friends = [{ id: "f1", name: "Alex", level: 5, xpWeek: 120, xpTotal: 2400, streak: 3, badges: 9, hours: 41.5, updatedAt: "2026-10-20T18:00:00.000Z" }];
state.rinks = [{ id: "r1", name: "Lakeside Ice Arena", city: "Tacoma" }];

const clean = ms.store.sanitizeState(JSON.parse(JSON.stringify(state)), { now: NOW });
const out = new URL("./fixtures/backup.json", import.meta.url);
writeFileSync(out, ms.store.exportJSON(clean, NOW) + "\n");
console.log("wrote", out.pathname, `(${clean.sessions.length} sessions)`);
