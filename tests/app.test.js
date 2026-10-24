/* The app's server, run for real on a free port, with the stand-in for Claude Code (tests/fake-claude.mjs). */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import { join } from "node:path";
import { startServer } from "../app.mjs";
import { folders, ROOT } from "../lib/paths.js";
import { tempDir } from "./helpers.js";

const FAKE = join(ROOT, "tests", "fake-claude.mjs");
const fixture = (name) => join(ROOT, "tests", "fixtures", name);

async function withServer(env, fn) {
  const out = tempDir("app-");
  const server = await startServer({ port: 0, env: { PATH: process.env.PATH, HOME: join(out, "home"), COACH_TODAY: "2026-10-23", CLAUDE_BIN: FAKE, FAKE_CLAUDE_LOG: join(out, "claude.jsonl"), ...env }, dirs: folders(out) });
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`, out);
  } finally {
    server.close();
  }
}

/* A GET with a chosen Host header (fetch will not let a test set it). */
function get(base, path, host) {
  const u = new URL(path, base);
  return new Promise((resolve, reject) => {
    http.get({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, headers: host ? { host } : {} }, (res) => {
      let body = "";
      res.on("data", (d) => (body += d));
      res.on("end", () => resolve({ status: res.statusCode, type: res.headers["content-type"], body }));
    }).on("error", reject);
  });
}
const events = (body) => body.split("\n\n").filter((b) => b.startsWith("data: ")).map((b) => JSON.parse(b.slice(6)));

test("answers only on this Mac, and serves only the page's own files", async () => {
  await withServer({}, async (base) => {
    assert.equal((await get(base, "/", "evil.example")).status, 403);
    const page = await get(base, "/");
    assert.equal(page.status, 200);
    assert.match(page.body, /<title>MySkate Coach<\/title>/);
    assert.equal((await get(base, "/web/app.js")).status, 200);
    for (const p of ["/README.md", "/lib/claude.js", "/runs/x.json", "/tests/fixtures/backup.json", "/../MySkate/js/store.js", "/web/../coach.mjs", "/demo/runs/../../coach.mjs"]) {
      assert.equal((await get(base, p)).status, 404, p);
    }
  });
});

test("the status: MySkate found, the sign-in, and the backups to pick from (the made-up skater, then backups/)", async () => {
  await withServer({}, async (base, out) => {
    mkdirSync(join(out, "backups"), { recursive: true });
    writeFileSync(join(out, "backups", "myskate-backup-2026-10-23.json"), readFileSync(fixture("backup.json")));
    writeFileSync(join(out, "backups", "notes.txt"), "not a backup");
    const s = JSON.parse((await get(base, "/api/status")).body);
    assert.equal(s.mode, "live");
    assert.equal(s.mySkate, true);
    assert.deepEqual(s.signIn, { ok: true, message: "" });
    assert.deepEqual(s.backups.map((b) => b.id), ["sample", "myskate-backup-2026-10-23.json"]);
    assert.ok(!JSON.stringify(s).includes(out), "no paths are sent to the page");
  });
});

test("a run, step by step: read, brief, Claude, the checks, the plan, saved", async () => {
  await withServer({ FAKE_CLAUDE_REPLIES: `reply:${fixture("replies/good.json")}` }, async (base, out) => {
    const r = await get(base, "/api/plan?backup=sample&slot=60&day=tomorrow");
    assert.match(r.type, /text\/event-stream/);
    const evs = events(r.body);
    assert.deepEqual(evs.map((e) => e.type), ["reading", "read", "brief", "asking", "answered", "checked", "result", "saved", "done"]);
    const by = Object.fromEntries(evs.map((e) => [e.type, e.data]));
    assert.equal(by.read.sessions, 10);
    assert.equal(by.brief.facts, 32);
    assert.equal(by.brief.date, "2026-10-24");
    assert.equal(by.answered.ok, true);
    assert.deepEqual(by.checked.passed[0], "5 skills, all from the list offered");
    assert.equal(by.result.source, "claude");
    assert.equal(by.result.plan.items.length, 5);
    assert.ok(existsSync(join(out, by.saved.planFile)) && existsSync(join(out, by.saved.logFile)));
    const log = JSON.parse(readFileSync(join(out, by.saved.logFile), "utf8"));
    assert.deepEqual(log.events.map((e) => e.type), ["reading", "read", "brief", "asking", "answered", "checked", "result"], "the run log keeps the steps the page showed");
  });
});

test("a plan that fails twice ends with MySkate's own plan, and says why", async () => {
  const bad = join(tempDir("bad-"), "bad.json");
  const reply = JSON.parse(readFileSync(fixture("replies/good.json"), "utf8"));
  reply.items[1].minutes = 25;
  writeFileSync(bad, JSON.stringify(reply));
  await withServer({ FAKE_CLAUDE_REPLIES: `reply:${bad}` }, async (base) => {
    const evs = events((await get(base, "/api/plan?backup=sample&slot=60&day=today")).body);
    assert.deepEqual(evs.map((e) => e.type), ["reading", "read", "brief", "asking", "answered", "checked", "asking", "answered", "checked", "result", "saved", "done"]);
    const result = evs.find((e) => e.type === "result").data;
    assert.equal(result.source, "myskate");
    assert.equal(result.reason, "Claude's plan did not pass the checks twice.");
    assert.deepEqual(evs.find((e) => e.type === "checked").data.problems, ["The minutes add up to 65, not 60."]);
  });
});

test("bad requests and a Claude Code that is not signed in end with a plain message", async () => {
  await withServer({}, async (base) => {
    const err = async (q) => events((await get(base, "/api/plan?" + q)).body).find((e) => e.type === "error").data.message;
    assert.match(await err("backup=../../etc/passwd&slot=60"), /Pick one of the backups/);
    assert.match(await err("backup=sample&slot=47"), /15 to 180 minutes/);
  });
  await withServer({ FAKE_CLAUDE_AUTH: JSON.stringify({ loggedIn: true, authMethod: "api_key" }) }, async (base, out) => {
    const evs = events((await get(base, "/api/plan?backup=sample&slot=60")).body);
    assert.match(evs.find((e) => e.type === "error").data.message, /billed per call/);
    assert.ok(!existsSync(join(out, "claude.jsonl")), "Claude was never asked");
  });
});
