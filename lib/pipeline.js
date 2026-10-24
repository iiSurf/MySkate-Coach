/* One run of the coach: the brief, Claude's plan, the checks, one retry with the list of problems, and MySkate's own plan if
   Claude's still fails or Claude Code cannot answer. The run log keeps all of it, so a bad plan can be traced to the model or to
   the code. */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeBrief } from "./brief.js";
import { checkPlan } from "./check.js";
import { mySkatePlan } from "./fallback.js";

export const TRIES = 2;

/* The brief again, with what was wrong last time. */
export function retryPrompt(brief, reply, problems) {
  return [
    brief.text,
    "",
    "Your last reply had these problems:",
    ...problems.map((p) => `- ${p}`),
    "",
    "Your last reply was:",
    typeof reply === "string" ? reply : JSON.stringify(reply, null, 2),
    "",
    "Reply again with the whole plan, with every problem fixed.",
  ].join("\n");
}

/* Plan one session. ask(prompt) is lib/claude.js's askClaude (or a stand-in in the tests). on.asking(n), on.checked(n, result),
   and on.failed(n, attempt) report progress. Returns { source: "claude" | "myskate", plan, retried, reason, brief, attempts }. */
export async function coach({ ms, state, today, date, slotMin, ask, on = {} }) {
  const brief = makeBrief(ms, state, { today, date, slotMin });
  const attempts = [];
  let prompt = brief.text;
  let plan = null;
  for (let n = 1; n <= TRIES && !plan; n++) {
    on.asking?.(n);
    const answer = await ask(prompt);
    const attempt = { n, prompt, ok: answer.ok, error: answer.error ?? null, message: answer.message ?? "", meta: answer.meta ?? {}, raw: answer.raw ?? null, reply: answer.ok ? (answer.reply ?? null) : null, problems: [] };
    attempts.push(attempt);
    /* Claude Code itself failed (not signed in, a usage limit, too slow): asking again would not help. */
    if (!answer.ok) {
      on.failed?.(n, attempt);
      break;
    }
    const checked = checkPlan(attempt.reply, brief, ms.catalog);
    attempt.problems = checked.problems;
    on.checked?.(n, checked);
    if (checked.ok) plan = checked.plan;
    else prompt = retryPrompt(brief, attempt.reply, checked.problems);
  }
  if (plan) return { source: "claude", plan, retried: attempts.length > 1, reason: "", brief, attempts };
  const last = attempts[attempts.length - 1];
  const reason = last && !last.ok ? last.message : `Claude's plan did not pass the checks ${attempts.length === 1 ? "" : "twice"}`.trim() + ".";
  return { source: "myskate", plan: mySkatePlan(ms, state, brief, "The skills MySkate itself suggests next, with your ice time shared out evenly."), retried: attempts.length > 1, reason, brief, attempts };
}

/* The run log. It holds the skater's own data, so it stays on this Mac: runs/ is never committed. */
export function runLog({ result, backup, claude = {}, systemPrompt = "", startedAt, finishedAt }) {
  return {
    app: "MySkate Coach",
    log: 1,
    startedAt,
    finishedAt,
    backup,
    claude,
    systemPrompt,
    brief: { date: result.brief.date, slotMin: result.brief.slotMin, skillsOffered: result.brief.candidates.length, facts: result.brief.facts.length },
    attempts: result.attempts.map(({ n, prompt, ok, error, message, meta, raw, reply, problems }) => ({ n, ok, error, message, problems, reply, meta, raw, prompt })),
    result: { source: result.source, retried: result.retried, reason: result.reason, plan: result.plan },
  };
}

/* Write a run log into dir, named for when the run started: runs/2026-10-23-211405.json. Returns its path. */
export function writeLog(dir, log, now = new Date()) {
  mkdirSync(dir, { recursive: true });
  const p = (n) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  let path = join(dir, `${stamp}.json`);
  for (let i = 2; existsSync(path); i++) path = join(dir, `${stamp}-${i}.json`);
  writeFileSync(path, JSON.stringify(log, null, 2) + "\n");
  return path;
}
