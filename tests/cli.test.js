/* The whole command, run as a real process against the stand-in for Claude Code (tests/fake-claude.mjs). */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FIXTURE, mySkate } from "./helpers.js";

const ROOT = new URL("..", import.meta.url).pathname;
const FAKE = join(ROOT, "tests", "fake-claude.mjs");
const fixture = (name) => join(ROOT, "tests", "fixtures", name);
const GOOD = `reply:${fixture("replies/good.json")}`;

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "coach-cli-"));
  const badFile = join(dir, "bad.json");
  const good = JSON.parse(readFileSync(fixture("replies/good.json"), "utf8"));
  good.items[1].minutes = 25;
  writeFileSync(badFile, JSON.stringify(good));
  return { dir, out: join(dir, "out"), home: join(dir, "home"), log: join(dir, "claude-runs.jsonl"), bad: `reply:${badFile}` };
}

/* Run the coach. Nothing from the real environment that could reach a real Claude Code or a real backup gets through. */
function coach(s, args, env = {}) {
  const r = spawnSync(process.execPath, [join(ROOT, "coach.mjs"), ...args], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, HOME: s.home, NO_COLOR: "1", COACH_TODAY: "2026-10-23", COACH_OUT: s.out, CLAUDE_BIN: FAKE, FAKE_CLAUDE_LOG: s.log, ...env },
  });
  return { code: r.status, out: r.stdout + r.stderr };
}
const asked = (s) => (existsSync(s.log) ? readFileSync(s.log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const runLogs = (s) => (existsSync(join(s.out, "runs")) ? readdirSync(join(s.out, "runs")).map((f) => JSON.parse(readFileSync(join(s.out, "runs", f), "utf8"))) : []);

test("help", () => {
  const r = coach(setup(), ["--help"]);
  assert.equal(r.code, 0);
  assert.match(r.out, /^MySkate Coach plans your next skating session/);
});

test("a good plan: checked, shown, saved, and logged; exit 0", () => {
  const s = setup();
  const r = coach(s, [FIXTURE], { FAKE_CLAUDE_REPLIES: GOOD });
  assert.equal(r.code, 0, r.out);
  for (const line of [
    "Reading backup.json",
    "  10 sessions, newest Thu, Oct 22",
    "Asking Claude for a 60-minute plan for Sat, Oct 24 (sonnet, no tools)",
    "  ✓ 5 skills, all from the list offered",
    "  ✓ 60 of 60 minutes, in steps of 5",
    "Sat, Oct 24 · 60 mins",
    "1. Backward crossovers to a backward outside edge glide · 10 min",
    '   Focus: "check the landing for a count of 3"',
    "Saved plans/2026-10-24.md",
  ]) assert.ok(r.out.includes(line), `shows: ${line}\n${r.out}`);
  assert.match(readFileSync(join(s.out, "plans", "2026-10-24.md"), "utf8"), /^# Practice plan for Sat, Oct 24 · 60 mins\n/);
  const [log] = runLogs(s);
  assert.equal(log.result.source, "claude");
  assert.equal(log.claude.signIn, "claude.ai");
  assert.ok(log.claude.args.includes("<prompts/coach.md>") && log.claude.args.includes("<prompts/reply.schema.json>"));
  assert.equal(asked(s).length, 1);
});

test("a plan that fails a check is fixed on the second try; exit 0", () => {
  const s = setup();
  const r = coach(s, [FIXTURE], { FAKE_CLAUDE_REPLIES: `${s.bad}|${GOOD}` });
  assert.equal(r.code, 0, r.out);
  assert.ok(r.out.includes("  ✗ The minutes add up to 65, not 60.\nAsking Claude again with 1 problem\nChecking the plan\n  ✓ passed on the second try"), r.out);
  assert.ok(asked(s)[1].brief.includes("Your last reply had these problems:\n- The minutes add up to 65, not 60."));
  assert.deepEqual(runLogs(s)[0].attempts.map((a) => a.problems.length), [1, 0]);
});

test("a plan that fails twice is not shown: MySkate's own plan is, with the reason; exit 3", () => {
  const s = setup();
  const r = coach(s, [FIXTURE], { FAKE_CLAUDE_REPLIES: s.bad });
  assert.equal(r.code, 3, r.out);
  assert.ok(r.out.includes("  ! Claude's plan could not be used: Claude's plan did not pass the checks twice."), r.out);
  assert.ok(r.out.includes("Sat, Oct 24 · 60 mins  MySkate's own suggestion"));
  assert.equal(runLogs(s)[0].result.source, "myskate");
});

test("Claude Code at a usage limit: no second try, MySkate's own plan says why; exit 3", () => {
  const s = setup();
  const r = coach(s, [FIXTURE], { FAKE_CLAUDE_REPLIES: `raw:${fixture("outputs/usage-limit.json")}` });
  assert.equal(r.code, 3, r.out);
  assert.ok(r.out.includes("  ✗ Claude Code is at a usage limit: You've hit your session limit · resets 3:45pm"), r.out);
  assert.equal(asked(s).length, 1);
});

test("an answer without a plan is retried; Claude Code's own schema giving up is retried too", () => {
  for (const first of [`raw:${fixture("outputs/no-plan.json")}`, `raw:${fixture("outputs/schema-gave-up.json")}`, `text:${fixture("replies/good.json")}`]) {
    const s = setup();
    const r = coach(s, [FIXTURE], { FAKE_CLAUDE_REPLIES: `${first}|${GOOD}` });
    assert.equal(r.code, 0, r.out);
  }
  const s = setup();
  assert.equal(coach(s, [FIXTURE], { FAKE_CLAUDE_REPLIES: `text:${fixture("replies/good.json")}` }).code, 0, "a plan in a ``` fence passes the first time");
  assert.equal(asked(s).length, 1);
});

test("not signed in, or signed in with an API key: Claude is never asked; exit 2", () => {
  const s = setup();
  const out = coach(s, [FIXTURE], { FAKE_CLAUDE_AUTH: JSON.stringify({ loggedIn: false, authMethod: "none" }) });
  assert.equal(out.code, 2);
  assert.ok(out.out.includes("Claude Code is not signed in on this Mac. Run: npm run signin"));
  const key = coach(s, [FIXTURE], { FAKE_CLAUDE_AUTH: JSON.stringify({ loggedIn: true, authMethod: "api_key" }) });
  assert.equal(key.code, 2);
  assert.ok(key.out.includes("signed in with an API key, which is billed per call"));
  assert.equal(asked(s).length, 0);
  assert.equal(runLogs(s).length, 0);
});

test("an API key in the environment never reaches Claude Code, and the skater is told", () => {
  const s = setup();
  const r = coach(s, [FIXTURE], { FAKE_CLAUDE_REPLIES: GOOD, ANTHROPIC_API_KEY: "sk-ant-test" });
  assert.equal(r.code, 0, r.out);
  assert.ok(r.out.includes("  ! Left out ANTHROPIC_API_KEY, so this run can't be billed per call."));
  assert.ok(!asked(s)[0].envNames.includes("ANTHROPIC_API_KEY"));
});

test("Claude Code not installed; exit 2", () => {
  const s = setup();
  const r = coach(s, [FIXTURE], { CLAUDE_BIN: join(s.dir, "nowhere", "claude") });
  assert.equal(r.code, 2);
  assert.ok(r.out.includes("Claude Code is not installed on this Mac."));
});

test("--brief shows what Claude would get and --myskate shows MySkate's plan, and neither asks Claude", () => {
  const s = setup();
  const brief = coach(s, [FIXTURE, "--brief"]);
  assert.equal(brief.code, 0);
  assert.ok(brief.out.includes("D1 Today is Fri, Oct 23, 2026. The plan is for Sat, Oct 24: 60 minutes on the ice."));
  const own = coach(s, [FIXTURE, "--myskate", "--slot", "45", "--today"]);
  assert.equal(own.code, 0);
  assert.ok(own.out.includes("Fri, Oct 23 · 45 mins  MySkate's own suggestion"), own.out);
  assert.equal(asked(s).length, 0);
});

test("finds the newest backup in Downloads or iCloud Drive, and says how to make one when there is none", async () => {
  const s = setup();
  const none = coach(s, ["--brief"]);
  assert.equal(none.code, 1);
  assert.ok(none.out.includes("No MySkate backup found in Downloads or iCloud Drive."));
  const icloud = join(s.home, "Library", "Mobile Documents", "com~apple~CloudDocs", "Downloads");
  mkdirSync(icloud, { recursive: true });
  writeFileSync(join(icloud, "myskate-backup-2026-10-23.json"), readFileSync(FIXTURE));
  const found = coach(s, ["--brief"]);
  assert.equal(found.code, 0, found.out);
  assert.ok(found.out.startsWith("Reading myskate-backup-2026-10-23.json"));
});

test("a locked backup needs a terminal to ask for the passphrase", async () => {
  const ms = await mySkate();
  const s = setup();
  mkdirSync(s.dir, { recursive: true });
  const locked = join(s.dir, "myskate-backup-2026-10-23-locked.json");
  writeFileSync(locked, await ms.crypto.encryptBackup(readFileSync(FIXTURE, "utf8"), "correct horse", { iterations: 1000 }));
  const r = coach(s, [locked]);
  assert.equal(r.code, 1);
  assert.ok(r.out.includes("That backup is locked with a passphrase."));
});

test("bad options are explained; exit 1", () => {
  const s = setup();
  for (const [args, words] of [
    [["--slot", "7"], "--slot must be 15 to 180 minutes, in steps of 5."],
    [["--slot", "200"], "--slot must be 15 to 180 minutes"],
    [["--slot", "47"], "--slot must be 15 to 180 minutes"],
    [["--date", "2026-10-01"], "--date must be a day like 2026-10-24, today or later."],
    [["--date", "soon"], "--date must be a day like"],
    [["--model", "sonnet; rm -rf"], "--model must be a model name"],
    [["--nope"], "Unknown option '--nope'"],
    [[FIXTURE, FIXTURE], "Give at most one backup file."],
  ]) {
    const r = coach(s, [FIXTURE, ...args].slice(args.includes(FIXTURE) ? 1 : 0));
    assert.equal(r.code, 1, `${args.join(" ")}: ${r.out}`);
    assert.ok(r.out.includes(words), `${args.join(" ")}: ${r.out}`);
  }
  assert.equal(asked(s).length, 0);
});
