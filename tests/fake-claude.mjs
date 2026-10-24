#!/usr/bin/env node
/* A stand-in for Claude Code in the tests, so no test ever calls the model. It answers `auth status` the way Claude Code does
   (FAKE_CLAUDE_AUTH sets the answer) and, for a plan, prints the next recorded answer in FAKE_CLAUDE_REPLIES, a list split by "|":
     reply:<file>  a success with the file's JSON as structured_output (what --json-schema gives)
     text:<file>   a success with the file's JSON as text in a ``` fence (what a run without the schema gives)
     raw:<file>    the file printed as it is, except "exit", "sleep", and "stderr", which set the exit code, a delay, and stderr
   The last answer repeats. Each plan run adds a line to FAKE_CLAUDE_LOG: the arguments, the brief it got on stdin, the folder it
   ran in and what was in it, and the names (never the values) of its environment variables. */
import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs";

const args = process.argv.slice(2);
if (args[0] === "auth") {
  const status = process.env.FAKE_CLAUDE_AUTH ? JSON.parse(process.env.FAKE_CLAUDE_AUTH) : { loggedIn: true, authMethod: "claude.ai" };
  process.stdout.write(JSON.stringify(status, null, 2));
  process.exit(status.loggedIn ? 0 : 1);
}

const brief = readFileSync(0, "utf8");
const log = process.env.FAKE_CLAUDE_LOG;
const runs = log && existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean).length : 0;
if (log) appendFileSync(log, JSON.stringify({ args, brief, cwd: process.cwd(), cwdFiles: readdirSync(process.cwd()), envNames: Object.keys(process.env) }) + "\n");

const answers = (process.env.FAKE_CLAUDE_REPLIES || "").split("|").filter(Boolean);
const [kind, file] = (answers[Math.min(runs, answers.length - 1)] || "raw:").split(/:(.*)/s);
const read = () => JSON.parse(readFileSync(file, "utf8"));
const success = (fields) => ({ type: "result", subtype: "success", is_error: false, num_turns: 1, duration_ms: 1200, total_cost_usd: 0.01, usage: { input_tokens: 3000, output_tokens: 400 }, modelUsage: { "claude-sonnet-fake": { inputTokens: 3000, outputTokens: 400 } }, ...fields });

if (kind === "reply") process.stdout.write(JSON.stringify(success({ result: "", structured_output: read() })));
else if (kind === "text") process.stdout.write(JSON.stringify(success({ result: "```json\n" + JSON.stringify(read(), null, 2) + "\n```" })));
else {
  const { exit = 0, sleep = 0, stderr = "", ...out } = file ? read() : {};
  if (sleep) await new Promise((r) => setTimeout(r, sleep));
  if (stderr) process.stderr.write(stderr);
  if (Object.keys(out).length) process.stdout.write(JSON.stringify(out));
  process.exit(exit);
}
