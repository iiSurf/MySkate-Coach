/* Saving a finished run, the same way for the command and the app: the plan as Markdown in plans/, and the run log in runs/
   (the brief, every attempt, the problems found, the result, and, from the app, the steps it showed). Both stay on this Mac. */

import { mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { claudeArgs, SYSTEM_PROMPT } from "./claude.js";
import { planMarkdown } from "./format.js";
import { runLog, writeLog } from "./pipeline.js";

/* Returns { planFile, logFile }, each relative to dirs.out. */
export function saveRun({ result, today, date, dirs, backupPath, backup, bin, model, signIn, startedAt, finishedAt, events }) {
  mkdirSync(dirs.plans, { recursive: true });
  const planPath = join(dirs.plans, `${date}.md`);
  writeFileSync(planPath, planMarkdown(result, { today }));
  const args = claudeArgs({ model }).map((a) => (a === SYSTEM_PROMPT ? "<prompts/coach.md>" : a.startsWith("{") ? "<prompts/reply.schema.json>" : a));
  const log = runLog({
    result,
    backup: { file: backupPath, exportedAt: backup.exportedAt, locked: backup.locked, ...backup.summary },
    claude: { bin, model, signIn, args },
    systemPrompt: SYSTEM_PROMPT,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
  });
  if (events) log.events = events;
  const logPath = writeLog(dirs.runs, log, startedAt);
  return { planFile: relative(dirs.out, planPath), logFile: relative(dirs.out, logPath) };
}
