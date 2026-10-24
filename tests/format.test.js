import { test } from "node:test";
import assert from "node:assert/strict";
import { painter, passedLines, planLines, planMarkdown, wrap } from "../lib/format.js";

const plan = {
  date: "2026-10-24",
  slotMin: 30,
  summary: "Short and sweet.",
  items: [
    { skillId: "a", name: "Waltz jump", minutes: 20, why: "4 of 12 landed *Thursday*", facts: ["S1"], focus: "count of 3 <now>" },
    { skillId: "b", name: "Mazurka", minutes: 10, why: "New homework", facts: ["H1"], focus: "" },
  ],
};

test("wrapping keeps a date like Oct 7 on one line and indents what follows", () => {
  const lines = wrap("the spin you have not touched since Oct 7 at all", 41, "  ");
  assert.equal(lines.length, 2);
  assert.ok(lines[1].startsWith("  "));
  assert.ok(lines.some((l) => l.includes("Oct 7")), lines.join("|"));
  assert.deepEqual(wrap("", 10), []);
});

test("color only when asked", () => {
  assert.equal(painter(false)("green", "ok"), "ok");
  assert.equal(painter(true)("green", "ok"), "\x1b[32mok\x1b[0m");
});

test("the terminal plan and what the checks found", () => {
  assert.deepEqual(planLines({ source: "claude", plan }), ["Sat, Oct 24 · 30 mins", "Short and sweet.", "", "1. Waltz jump · 20 min", "   4 of 12 landed *Thursday*", '   Focus: "count of 3 <now>"', "2. Mazurka · 10 min", "   New homework"]);
  assert.equal(planLines({ source: "myskate", plan })[0], "Sat, Oct 24 · 30 mins  MySkate's own suggestion");
  assert.deepEqual(passedLines(plan), ["2 skills, all from the list offered", "30 of 30 minutes, in steps of 5", "every number in the reasons is in your log", "every focus is in your own words"]);
});

test("the Markdown plan escapes text from the model and the notes, and says where the plan came from", () => {
  const text = planMarkdown({ source: "claude", plan }, { today: "2026-10-23" });
  assert.ok(text.startsWith("# Practice plan for Sat, Oct 24 · 30 mins\n"));
  assert.ok(text.includes("4 of 12 landed \\*Thursday\\*"));
  assert.ok(text.includes('Focus: "count of 3 \\<now\\>"'));
  assert.ok(text.includes("Planned by Claude with MySkate Coach on Fri, Oct 23, 2026, and checked:"));
  const own = planMarkdown({ source: "myskate", plan, reason: "Claude's plan did not pass the checks twice." }, { today: "2026-10-23" });
  assert.ok(own.includes("MySkate's own suggestion, made by MySkate Coach on Fri, Oct 23, 2026. Claude's plan could not be used: Claude's plan did not pass the checks twice."));
});
