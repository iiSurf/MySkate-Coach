#!/usr/bin/env node
/* MySkate Coach: plans your next skating session from your newest MySkate backup. Claude makes the plan; plain code checks it.
   README.md says what Claude does and what the code checks. Exit codes: 0 Claude's plan (or nothing went wrong), 1 a problem with
   what was given (no backup, a bad option), 2 Claude Code is missing or not signed in with a subscription, 3 Claude's plan could not
   be used so MySkate's own plan was shown, 4 a bug in MySkate Coach itself. */

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { basename } from "node:path";
import { parseArgs } from "node:util";
import { findNewestBackup, readBackup } from "./lib/backup.js";
import { makeBrief } from "./lib/brief.js";
import { askClaude, cleanEnv, findClaude, MODEL, signedIn } from "./lib/claude.js";
import { addDays, dayOf, daysBetween, fmtDay, isDay } from "./lib/dates.js";
import { mySkatePlan } from "./lib/fallback.js";
import { painter, passedLines, planLines } from "./lib/format.js";
import { findMySkate, loadMySkate } from "./lib/myskate.js";
import { folders, isInside, WORKSPACE } from "./lib/paths.js";
import { coach } from "./lib/pipeline.js";
import { saveRun } from "./lib/run.js";

/* Everything the coach reads and writes is inside the workspace (lib/paths.js). COACH_OUT moves its folders, for the tests. */
const DIRS = folders();
const EXIT = { ok: 0, input: 1, claude: 2, fallback: 3, bug: 4 };
const INSTALL = "Install it with: curl -fsSL https://claude.ai/install.sh | bash (https://code.claude.com/docs/en/setup), then run: npm run signin";

const HELP = `MySkate Coach plans your next skating session from your newest MySkate backup.
Claude makes the plan; plain code checks it before you see it.

  npm run coach                         plan tomorrow's session from your newest backup
  npm run coach -- path/to/backup.json  use this backup
  npm run coach -- --slot 45            your ice time in minutes (15 to 180, in steps of 5)
  npm run coach -- --today              plan today's session (or --date 2026-10-24)
  npm run coach -- --brief              show what Claude would be given, and stop
  npm run coach -- --myskate            MySkate's own suggestion, without Claude
  npm run coach -- --model opus         another Claude model (default: ${MODEL})
  npm run signin                        sign Claude Code in with your Claude account (once)

The coach only works inside your workspace folder. Put your backup in its backups folder:
In MySkate: Profile, then Save a backup, then move the file into MySkate-Coach/backups.`;

const color = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const c = painter(color);
const width = Math.min(process.stdout.columns || 80, 100);
const say = (line = "") => console.log(line);
const good = (text) => say(`  ${c("green", "✓")} ${text}`);
const bad = (text) => say(`  ${c("red", "✗")} ${text}`);
const note = (text) => say(`  ${c("yellow", "!")} ${text}`);
const plural = (n, one) => `${n} ${n === 1 ? one : one + "s"}`;

async function main(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: { slot: { type: "string" }, date: { type: "string" }, today: { type: "boolean" }, model: { type: "string" }, brief: { type: "boolean" }, myskate: { type: "boolean" }, signin: { type: "boolean" }, help: { type: "boolean", short: "h" } },
    });
  } catch (err) {
    say(err.message);
    say("See: npm run coach -- --help");
    return EXIT.input;
  }
  const { values: o, positionals } = parsed;
  if (o.help) {
    say(HELP);
    return EXIT.ok;
  }
  if (o.signin) return signin();

  /* The day, the model, and MySkate. COACH_TODAY is only for the tests, so they see the same week every day. */
  const today = isDay(process.env.COACH_TODAY) ? process.env.COACH_TODAY : dayOf(new Date());
  let date = o.today ? today : addDays(today, 1);
  if (o.date !== undefined) {
    if (!isDay(o.date) || o.date < today) {
      say(`--date must be a day like ${addDays(today, 1)}, today or later.`);
      return EXIT.input;
    }
    date = o.date;
  }
  const model = o.model ?? MODEL;
  if (!/^[\w.[\]-]{1,60}$/.test(model)) {
    say("--model must be a model name, like sonnet or opus.");
    return EXIT.input;
  }
  if (positionals.length > 1) {
    say("Give at most one backup file.");
    return EXIT.input;
  }
  const dir = findMySkate();
  if (!dir) {
    say("MySkate Coach needs MySkate in the folder next to it (../MySkate), or MYSKATE_DIR set to where it is.");
    say("Get it with: git clone https://github.com/iiSurf/MySkate");
    return EXIT.input;
  }
  const ms = await loadMySkate(dir);

  /* The backup: the one given, or the newest in the coach's backups folder. Nothing outside the workspace is read. */
  if (!isInside(DIRS.out, WORKSPACE)) {
    say(`COACH_OUT must be inside ${WORKSPACE}.`);
    return EXIT.input;
  }
  mkdirSync(DIRS.backups, { recursive: true });
  let path = positionals[0];
  if (!path) {
    const found = findNewestBackup([DIRS.backups]);
    if (!found) {
      say(`No MySkate backup in ${DIRS.backups}`);
      say("In MySkate: Profile, then Save a backup, then move the file into that folder.");
      return EXIT.input;
    }
    path = found.path;
  }
  say(`Reading ${basename(path)}`);
  const backup = await readBackup(path, ms, { workspace: WORKSPACE, askPassphrase: process.stdin.isTTY ? () => askHidden("  Passphrase for this locked backup (not shown): ") : undefined });
  if (!backup.ok) {
    say(backup.error);
    return EXIT.input;
  }
  const { state, summary } = backup;
  say(c("dim", `  ${plural(summary.sessions, "session")}${summary.last ? `, newest ${fmtDay(summary.last)}` : ""}${backup.locked ? ", unlocked" : ""}`));
  if (summary.last && daysBetween(summary.last, today) > 14) note(`Your newest session is from ${fmtDay(summary.last)}. If you've skated since, save a new backup in MySkate.`);
  else if (backup.exportedAt && daysBetween(dayOf(new Date(backup.exportedAt)), today) > 7) note(`This backup was saved ${fmtDay(dayOf(new Date(backup.exportedAt)))}. If you've skated since, save a new one in MySkate.`);

  /* The ice time: what was asked for, or the skater's usual one. */
  let slotMin = Math.min(180, Math.max(15, Math.round(state.profile.defaultSlotMin / 5) * 5));
  if (o.slot !== undefined) {
    const n = Number(o.slot);
    if (!Number.isInteger(n) || n < 15 || n > 180 || n % 5 !== 0) {
      say("--slot must be 15 to 180 minutes, in steps of 5.");
      return EXIT.input;
    }
    slotMin = n;
  }

  if (o.brief) {
    say();
    say(makeBrief(ms, state, { today, date, slotMin }).text);
    return EXIT.ok;
  }
  if (o.myskate) {
    const plan = mySkatePlan(ms, state, makeBrief(ms, state, { today, date, slotMin }), "The skills MySkate itself suggests next, without Claude.");
    say();
    planLines({ source: "myskate", plan }, { color, width }).forEach((l) => say(l));
    return EXIT.ok;
  }

  /* Claude Code, on a Claude subscription only. */
  const bin = findClaude();
  if (!bin) {
    say("Claude Code is not installed on this Mac.");
    say(INSTALL);
    return EXIT.claude;
  }
  const { env, removed } = cleanEnv(process.env);
  if (removed.length) note(`Left out ${removed.join(", ")}, so this run can't be billed per call.`);
  const auth = await signedIn(bin, { env });
  if (!auth.ok) {
    say(auth.message);
    return EXIT.claude;
  }

  const startedAt = new Date();
  let lastProblems = 0;
  const result = await coach({
    ms,
    state,
    today,
    date,
    slotMin,
    ask: (prompt) => askClaude({ bin, prompt, model, env, workdir: DIRS.work }),
    on: {
      asking: (n) => say(n === 1 ? `Asking Claude for a ${slotMin}-minute plan for ${fmtDay(date)} (${model}, no tools)` : `Asking Claude again with ${plural(lastProblems, "problem")}`),
      checked: (n, checked) => {
        say("Checking the plan");
        if (!checked.ok) {
          checked.problems.forEach(bad);
          lastProblems = checked.problems.length;
        } else {
          if (n > 1) good("passed on the second try");
          passedLines(checked.plan).forEach(good);
        }
      },
      failed: (n, attempt) => bad(attempt.message),
    },
  });
  const finishedAt = new Date();

  say();
  if (result.source === "myskate") {
    note(`Claude's plan could not be used: ${result.reason}`);
    note("Here is MySkate's own suggestion instead.");
    say();
  }
  planLines(result, { color, width }).forEach((l) => say(l));
  say();

  /* The plan as a file, and the run log for tracing what happened. Both stay on this Mac. */
  const saved = saveRun({ result, today, date, dirs: DIRS, backupPath: path, backup, bin, model, signIn: auth.method, startedAt, finishedAt });
  say(c("dim", `Saved ${saved.planFile}`));
  say(c("dim", `Run log: ${saved.logFile}`));
  return result.source === "claude" ? EXIT.ok : EXIT.fallback;
}

/* Sign Claude Code in with a Claude subscription (never an API key), then say whether it worked. */
async function signin() {
  const bin = findClaude();
  if (!bin) {
    say("Claude Code is not installed on this Mac.");
    say(INSTALL);
    return EXIT.claude;
  }
  const { env } = cleanEnv(process.env);
  say("Signing Claude Code in with your Claude account (your subscription, not an API key).");
  say(c("dim", `Claude Code: ${bin}`));
  await new Promise((resolve) => {
    const child = spawn(bin, ["auth", "login", "--claudeai"], { stdio: "inherit", env });
    child.on("close", resolve);
    child.on("error", resolve);
  });
  const auth = await signedIn(bin, { env });
  say(auth.ok ? c("green", "Signed in. Now run: npm run coach") : auth.message);
  return auth.ok ? EXIT.ok : EXIT.claude;
}

/* Ask for a passphrase without showing it. */
function askHidden(question) {
  return new Promise((resolve) => {
    const { stdin, stdout } = process;
    stdout.write(question);
    let text = "";
    const stop = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
      stdout.write("\n");
    };
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") return stop(), resolve(text);
        if (ch === "\u0003") return stop(), process.exit(130);
        if (ch === "\u007f" || ch === "\b") text = text.slice(0, -1);
        else text += ch;
      }
    };
    stdin.setRawMode(true);
    stdin.setEncoding("utf8");
    stdin.resume();
    stdin.on("data", onData);
  });
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    console.error(`MySkate Coach hit a bug (not Claude's doing): ${err && err.stack ? err.stack : err}`);
    process.exitCode = EXIT.bug;
  }
);
