import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { askClaude, claudeArgs, cleanEnv, findClaude, jsonIn, readOutput, runProcess, signedIn, SYSTEM_PROMPT } from "../lib/claude.js";

const FAKE = new URL("./fake-claude.mjs", import.meta.url).pathname;
const fixture = (name) => new URL(`./fixtures/${name}`, import.meta.url).pathname;
const GOOD = JSON.parse(readFileSync(fixture("replies/good.json"), "utf8"));
const temp = () => mkdtempSync(join(tmpdir(), "coach-claude-"));

test("the environment leaves out API keys, cloud providers, and Claude Code session markers, and keeps the rest", () => {
  const { env, removed } = cleanEnv({
    PATH: "/usr/bin",
    HOME: "/Users/sam",
    ANTHROPIC_API_KEY: "sk-ant-xxx",
    ANTHROPIC_AUTH_TOKEN: "tok",
    ANTHROPIC_BASE_URL: "https://example.test",
    CLAUDE_CODE_USE_BEDROCK: "1",
    CLAUDECODE: "1",
    CLAUDE_CODE_ENTRYPOINT: "claude-desktop",
    CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH: "1",
    CLAUDE_AGENT_SDK_VERSION: "1",
    CLAUDE_CODE_OAUTH_TOKEN: "subscription-token",
    CLAUDE_CONFIG_DIR: "/Users/sam/.claude",
  });
  assert.deepEqual(Object.keys(env).sort(), ["CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CONFIG_DIR", "HOME", "PATH"]);
  assert.deepEqual(removed, ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_USE_BEDROCK"]);
});

test("finds Claude Code: CLAUDE_BIN, then the PATH, then the desktop app's newest copy", () => {
  const home = temp();
  const bin = (dir) => {
    mkdirSync(dir, { recursive: true });
    const p = join(dir, "claude");
    writeFileSync(p, "#!/bin/sh\n");
    chmodSync(p, 0o755);
    return p;
  };
  const app = (version, build) => bin(join(home, "Library", "Application Support", "Claude", "claude-code", version, build, "claude.app", "Contents", "MacOS"));
  app("2.1.9", "aaa");
  const newest = app("2.1.10", "bbb");
  assert.equal(findClaude({ PATH: "" }, home), newest, "2.1.10 is newer than 2.1.9");
  const onPath = bin(join(home, "bin"));
  assert.equal(findClaude({ PATH: `/nowhere:${join(home, "bin")}` }, home), onPath);
  assert.equal(findClaude({ CLAUDE_BIN: FAKE, PATH: join(home, "bin") }, home), FAKE);
  assert.equal(findClaude({ CLAUDE_BIN: join(home, "missing") }, home), null);
  assert.equal(findClaude({ PATH: "" }, temp()), null);
});

test("runs headless with no tools, nothing loaded from settings, no saved session, and the reply's shape", () => {
  const args = claudeArgs();
  assert.equal(args[0], "-p");
  assert.equal(args[args.indexOf("--tools") + 1], "");
  assert.equal(args[args.indexOf("--model") + 1], "sonnet");
  assert.equal(args[args.indexOf("--output-format") + 1], "json");
  assert.equal(args[args.indexOf("--system-prompt") + 1], SYSTEM_PROMPT);
  for (const flag of ["--safe-mode", "--strict-mcp-config", "--disable-slash-commands", "--no-session-persistence"]) assert.ok(args.includes(flag), flag);
  assert.deepEqual(JSON.parse(args[args.indexOf("--json-schema") + 1]).required, ["summary", "items"]);
  for (const flag of ["--bare", "--dangerously-skip-permissions", "--allow-dangerously-skip-permissions"]) assert.ok(!args.includes(flag), flag);
  assert.ok(!claudeArgs({ schema: false }).includes("--json-schema"));
  assert.equal(claudeArgs({ model: "opus" })[claudeArgs().indexOf("--model") + 1], "opus");
});

test("only a Claude subscription sign-in will do", async () => {
  const status = (s) => signedIn("claude", { run: async () => ({ code: 0, stdout: JSON.stringify(s) }) });
  assert.deepEqual(await status({ loggedIn: true, authMethod: "claude.ai" }), { ok: true, method: "claude.ai", message: "" });
  assert.equal((await status({ loggedIn: true, authMethod: "oauth_token" })).ok, true);
  for (const [method, words] of [["api_key", "an API key"], ["api_key_helper", "an API key"], ["third_party", "a cloud provider"]]) {
    const r = await status({ loggedIn: true, authMethod: method });
    assert.equal(r.ok, false);
    assert.ok(r.message.includes(`signed in with ${words}, which is billed per call`), r.message);
  }
  assert.match((await status({ loggedIn: false, authMethod: "none" })).message, /not signed in/);
  assert.equal((await signedIn("claude", { run: async () => ({ code: 1, stdout: "garbage" }) })).ok, false);
});

test("reads Claude Code's answer: the schema's JSON, JSON in text, or plain text for the checker to refuse", () => {
  const ok = (fields) => readOutput({ code: 0, stdout: JSON.stringify({ type: "result", subtype: "success", is_error: false, ...fields }) });
  assert.deepEqual(ok({ structured_output: GOOD }).reply, GOOD);
  assert.deepEqual(ok({ result: "```json\n" + JSON.stringify(GOOD) + "\n```" }).reply, GOOD);
  assert.deepEqual(ok({ result: "Here it is: " + JSON.stringify(GOOD) + " Enjoy!" }).reply, GOOD);
  const prose = ok({ result: "Work on your waltz jump." });
  assert.equal(prose.ok, true);
  assert.equal(prose.reply, "Work on your waltz jump.");
  const full = ok({ structured_output: GOOD, num_turns: 2, total_cost_usd: 0.02, modelUsage: { "claude-sonnet-x": {} } });
  assert.deepEqual([full.meta.model, full.meta.turns, full.meta.costEstimateUsd], ["claude-sonnet-x", 2, 0.02]);
});

test("reads Claude Code's failures as failures of Claude Code, not of the plan", () => {
  const run = (out, code = 1, extra = {}) => readOutput({ code, stdout: typeof out === "string" ? out : JSON.stringify(out), stderr: "", ...extra });
  assert.equal(run({ is_error: true, result: "Not logged in · Please run /login" }).error, "not-signed-in");
  assert.equal(run({ is_error: true, result: "Failed to authenticate: OAuth session expired and could not be refreshed" }).error, "not-signed-in");
  const limit = run({ is_error: true, result: "You've hit your session limit · resets 3:45pm" });
  assert.equal(limit.error, "usage-limit");
  assert.match(limit.message, /resets 3:45pm/);
  assert.deepEqual([run({ is_error: true, result: "Request rejected (429)" }).error, run({ is_error: true, result: "Request rejected (429)" }).message], ["failed", "Request rejected (429)"]);
  assert.match(run("not json", 1, { stderr: "Error: --json-schema is not a valid JSON Schema\nmore" }).message, /^Error: --json-schema is not a valid JSON Schema$/);
  assert.equal(readOutput({ timedOut: true, stdout: "", stderr: "" }).error, "timeout");
  assert.match(readOutput({ error: "spawn ENOENT", stdout: "", stderr: "" }).message, /could not start: spawn ENOENT/);
  /* Giving up on the reply's shape is the model's failure: an empty answer the checker will refuse and the retry can fix. */
  const gaveUp = run({ subtype: "error_max_structured_output_retries", is_error: true, errors: ["no luck"] });
  assert.deepEqual([gaveUp.ok, gaveUp.reply], [true, null]);
});

test("finds JSON in text, with or without a fence", () => {
  assert.deepEqual(jsonIn('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(jsonIn('{"a":1}'), { a: 1 });
  assert.deepEqual(jsonIn('Sure! {"a":{"b":2}} Hope that helps.'), { a: { b: 2 } });
  assert.equal(jsonIn("no json here"), undefined);
  assert.equal(jsonIn(""), undefined);
});

test("asks the stand-in for Claude Code: the brief on stdin, in an empty folder that is removed after, without the API key", async () => {
  const dir = temp();
  const log = join(dir, "runs.jsonl");
  const { env } = cleanEnv({ ...process.env, ANTHROPIC_API_KEY: "sk-ant-should-not-arrive", FAKE_CLAUDE_LOG: log, FAKE_CLAUDE_REPLIES: `reply:${fixture("replies/good.json")}` });
  const r = await askClaude({ bin: FAKE, prompt: "THE BRIEF", env, timeoutMs: 20_000 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.reply, GOOD);
  assert.equal(r.meta.model, "claude-sonnet-fake");
  const seen = JSON.parse(readFileSync(log, "utf8").trim());
  assert.equal(seen.brief, "THE BRIEF");
  assert.deepEqual(seen.cwdFiles, []);
  assert.ok(!existsSync(seen.cwd), "the empty folder is removed after the run");
  assert.ok(!seen.envNames.includes("ANTHROPIC_API_KEY"));
  assert.equal(seen.args[seen.args.indexOf("--tools") + 1], "");
});

test("stops a Claude Code that takes too long", async () => {
  const started = Date.now();
  const r = await runProcess(FAKE, ["-p"], { env: { ...process.env, FAKE_CLAUDE_REPLIES: `raw:${fixture("outputs/slow.json")}` }, timeoutMs: 400 });
  assert.equal(r.timedOut, true);
  assert.ok(Date.now() - started < 4000);
  assert.equal(readOutput(r).error, "timeout");
});

test("a Claude Code that cannot be started is a failure, not a crash", async () => {
  const r = await runProcess(join(temp(), "no-such-claude"), ["-p"], { timeoutMs: 2000 });
  assert.match(String(r.error), /ENOENT/);
  assert.equal(readOutput(r).error, "failed");
});
