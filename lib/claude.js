/* The only code that talks to the model. It runs Claude Code headless (claude -p) on the skater's own Claude Code sign-in:
   - never with an API key: the environment it gets leaves out every ANTHROPIC_* setting and the cloud-provider switches, and
     signedIn() refuses a Claude Code signed in any way other than a Claude subscription;
   - with no tools, no MCP servers, no hooks, no skills, and no CLAUDE.md (--tools "", --safe-mode, --strict-mcp-config, an empty
     working folder inside the workspace), so the model can only read the brief and answer;
   - with the instructions in prompts/coach.md and the reply's shape in prompts/reply.schema.json.
   It hands back what came back. Checking it is lib/check.js's job. */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { folders } from "./paths.js";

export const SYSTEM_PROMPT = readFileSync(new URL("../prompts/coach.md", import.meta.url), "utf8");
export const REPLY_SCHEMA = JSON.parse(readFileSync(new URL("../prompts/reply.schema.json", import.meta.url), "utf8"));
export const MODEL = "sonnet";
export const TIMEOUT_MS = 180_000;
/* Sign-in methods that use a Claude subscription (claude.ai login, or a token made by `claude setup-token`). */
export const SUBSCRIPTION = ["claude.ai", "oauth_token"];
const KEEP = 200_000; // characters of Claude Code's output kept for the run log

const isFile = (p) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

/* Where Claude Code is: CLAUDE_BIN, then `claude` on the PATH, then the copy inside the Claude desktop app (its newest version). */
export function findClaude(env = process.env, home = homedir()) {
  if (env.CLAUDE_BIN) return isFile(env.CLAUDE_BIN) ? env.CLAUDE_BIN : null;
  for (const dir of (env.PATH || "").split(delimiter)) if (dir && isFile(join(dir, "claude"))) return join(dir, "claude");
  return desktopCopy(home);
}

function desktopCopy(home) {
  const base = join(home, "Library", "Application Support", "Claude", "claude-code");
  if (!existsSync(base)) return null;
  const version = (v) => v.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const newestFirst = readdirSync(base).sort((a, b) => {
    const [x, y] = [version(a), version(b)];
    for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (y[i] || 0) - (x[i] || 0);
    return 0;
  });
  for (const v of newestFirst) {
    let builds = [];
    try {
      builds = readdirSync(join(base, v));
    } catch {
      continue;
    }
    for (const b of builds) {
      const bin = join(base, v, b, "claude.app", "Contents", "MacOS", "claude");
      if (isFile(bin)) return bin;
    }
  }
  return null;
}

/* The environment Claude Code runs with: the skater's own, minus anything that would make it use an API key or a cloud provider
   (billed per call) instead of their Claude Code sign-in, and minus the markers of a Claude Code session this may be started from.
   removed lists what was left out that would have changed who pays. */
export function cleanEnv(source = process.env) {
  const env = {};
  const removed = [];
  for (const [name, value] of Object.entries(source)) {
    if (/^ANTHROPIC_/.test(name) || /^CLAUDE_CODE_USE_/.test(name)) {
      if (/^(ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|CLAUDE_CODE_USE_.*)$/.test(name)) removed.push(name);
      continue;
    }
    if (name === "CLAUDECODE" || name === "CLAUDE_PID" || name === "CLAUDE_EFFORT" || (/^CLAUDE_(CODE|AGENT_SDK)_/.test(name) && name !== "CLAUDE_CODE_OAUTH_TOKEN")) continue;
    env[name] = value;
  }
  return { env, removed };
}

/* Run a program with some text on its stdin. Resolves with what it printed; never rejects. */
export function runProcess(bin, args, { input = "", env, cwd, timeoutMs = TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let done = false;
    let child;
    const finish = (extra) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code: null, signal: null, stdout, stderr, timedOut, error: null, ...extra });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child?.kill("SIGTERM");
      setTimeout(() => child?.kill("SIGKILL"), 3000).unref();
    }, timeoutMs);
    try {
      child = spawn(bin, args, { env, cwd, stdio: ["pipe", "pipe", "pipe"] });
    } catch (err) {
      finish({ error: String(err.message || err) });
      return;
    }
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (err) => finish({ error: String(err.message || err) }));
    child.on("close", (code, signal) => finish({ code, signal }));
    child.stdin.on("error", () => {}); // it may exit before reading everything
    child.stdin.end(input);
  });
}

/* Is Claude Code signed in with a Claude subscription? { ok, method, message }. */
export async function signedIn(bin, { env, run = runProcess } = {}) {
  const r = await run(bin, ["auth", "status", "--json"], { env, timeoutMs: 30_000 });
  let status = null;
  try {
    status = JSON.parse(r.stdout);
  } catch {
    /* not readable: treated as not signed in */
  }
  const method = status && typeof status.authMethod === "string" ? status.authMethod : "none";
  if (method === "none" || !status || status.loggedIn === false) return { ok: false, method, message: "Claude Code is not signed in on this Mac. Run: npm run signin" };
  if (!SUBSCRIPTION.includes(method)) {
    const how = method.startsWith("api_key") ? "an API key" : method === "third_party" ? "a cloud provider" : `"${method}"`;
    return { ok: false, method, message: `Claude Code is signed in with ${how}, which is billed per call. MySkate Coach only runs on a Claude subscription. Run: npm run signin` };
  }
  return { ok: true, method, message: "" };
}

/* The arguments for one plan. */
export function claudeArgs({ model = MODEL, schema = true } = {}) {
  const args = ["-p", "--output-format", "json", "--model", model, "--system-prompt", SYSTEM_PROMPT, "--tools", "", "--safe-mode", "--strict-mcp-config", "--disable-slash-commands", "--no-session-persistence"];
  if (schema) args.push("--json-schema", JSON.stringify(REPLY_SCHEMA));
  return args;
}

/* Ask Claude for a plan. The brief goes in on stdin. Returns { ok, reply, error, message, raw, meta }:
   - ok: true when Claude Code ran and answered. reply is its answer: the checked JSON (structured_output), or JSON found in its
     text, or the text itself. Whether it is a good plan is for lib/check.js to say.
   - ok: false when Claude Code itself failed: error is "not-signed-in", "usage-limit", "timeout", or "failed", with a message.
   raw is Claude Code's output as it came back, for the run log; meta is the time taken and what Claude Code reported.
   Claude Code runs in a new empty folder inside workdir (the coach's .run/, inside the workspace), removed after. */
export async function askClaude({ bin, prompt, model = MODEL, env, workdir = folders().work, timeoutMs = TIMEOUT_MS, schema = true, run = runProcess }) {
  mkdirSync(workdir, { recursive: true });
  const dir = mkdtempSync(join(workdir, "claude-"));
  /* Safe mode already leaves CLAUDE.md files and memory out; these say so again, since the folder sits inside the repository. */
  const quiet = { ...env, CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1", CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" };
  const started = Date.now();
  try {
    return readOutput(await run(bin, claudeArgs({ model, schema }), { input: prompt, env: quiet, cwd: dir, timeoutMs }), Date.now() - started);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const firstLine = (text) => String(text || "").trim().split("\n")[0].slice(0, 300);

/* Claude Code's JSON result, read. Exported for the tests. */
export function readOutput(r, durationMs = 0) {
  const raw = { code: r.code, stdout: String(r.stdout).slice(0, KEEP), stderr: String(r.stderr).slice(0, KEEP) };
  const meta = { durationMs };
  if (r.error) return { ok: false, error: "failed", message: `Claude Code could not start: ${r.error}`, raw, meta };
  if (r.timedOut) return { ok: false, error: "timeout", message: "Claude Code took too long to answer.", raw, meta };
  let out = null;
  try {
    out = JSON.parse(r.stdout);
  } catch {
    /* handled below */
  }
  if (!out || typeof out !== "object") return { ok: false, error: "failed", message: firstLine(r.stderr) || `Claude Code stopped (code ${r.code}) without a readable answer.`, raw, meta };
  const models = out.modelUsage && typeof out.modelUsage === "object" ? Object.keys(out.modelUsage) : [];
  Object.assign(meta, { model: models[0] || null, turns: out.num_turns ?? null, costEstimateUsd: out.total_cost_usd ?? null, usage: out.usage ?? null, subtype: out.subtype ?? null });
  const text = typeof out.result === "string" ? out.result : Array.isArray(out.errors) ? out.errors.join(" ") : "";

  /* Claude Code gave up on the reply's shape after its own retries: a model problem, so it is an answer for the checker to refuse. */
  if (out.subtype === "error_max_structured_output_retries") return { ok: true, reply: null, raw, meta };
  if (out.is_error === true || r.code !== 0) {
    if (/not logged in|\/login|failed to authenticate|oauth (token|session)/i.test(text)) return { ok: false, error: "not-signed-in", message: "Claude Code is not signed in, or its sign-in has expired. Run: npm run signin", raw, meta };
    if (/limit/i.test(text) && /(hit|reached|resets)/i.test(text)) return { ok: false, error: "usage-limit", message: `Claude Code is at a usage limit: ${firstLine(text)}`, raw, meta };
    return { ok: false, error: "failed", message: firstLine(text) || `Claude Code stopped with code ${r.code}.`, raw, meta };
  }
  if (out.structured_output !== undefined && out.structured_output !== null) return { ok: true, reply: out.structured_output, raw, meta };
  const found = jsonIn(text);
  return { ok: true, reply: found === undefined ? text : found, raw, meta };
}

/* The JSON in a text answer, with or without a ``` fence around it, or undefined. */
export function jsonIn(text) {
  const t = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  for (const candidate of [t, t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1)]) {
    try {
      if (candidate) return JSON.parse(candidate);
    } catch {
      /* try the next */
    }
  }
  return undefined;
}
