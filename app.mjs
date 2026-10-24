#!/usr/bin/env node
/* MySkate Coach as an app on this Mac: `npm run app`, then open http://localhost:8790. The page (index.html, web/) asks this
   server to plan a session, and the server runs the same steps as the command (lib/), sending each step to the page as it
   happens: reading the backup, the brief, Claude answering, every check, the plan. It answers only on this Mac (127.0.0.1, and
   only to a page that calls itself localhost), serves only the page's own files, and reads backups only from backups/ (or the
   made-up skater in the tests). Each run is saved like a command run, with the steps the page showed (lib/run.js); those steps
   are what the demo page on GitHub Pages plays back. */

import http from "node:http";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readBackup } from "./lib/backup.js";
import { makeBrief } from "./lib/brief.js";
import { askClaude, cleanEnv, findClaude, MODEL, signedIn } from "./lib/claude.js";
import { addDays, dayOf, isDay } from "./lib/dates.js";
import { passedLines } from "./lib/format.js";
import { findMySkate, loadMySkate } from "./lib/myskate.js";
import { folders, ROOT, WORKSPACE } from "./lib/paths.js";
import { coach } from "./lib/pipeline.js";
import { saveRun } from "./lib/run.js";

export const PORT = 8790;
const SAMPLE = join(ROOT, "tests", "fixtures", "backup.json");
const NAME = /^myskate-backup-.*\.json$/i;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml" };

/* The only files the server hands out: the page, its script and style, and the demo's recordings. */
function staticFile(urlPath) {
  if (urlPath === "/" || urlPath === "/index.html") return join(ROOT, "index.html");
  if (/^\/web\/[\w-]+\.(js|css|svg)$/.test(urlPath)) return join(ROOT, urlPath);
  if (/^\/demo\/runs\/[\w-]+\.json$/.test(urlPath)) return join(ROOT, urlPath);
  return null;
}

/* The backups the page may pick: the made-up skater, then every backup in backups/, newest first. */
export function listBackups(dirs) {
  const list = [{ id: "sample", name: "Made-up skater (Sam), for trying it out", path: SAMPLE }];
  let names = [];
  try {
    names = readdirSync(dirs.backups).filter((n) => NAME.test(n));
  } catch {
    /* no backups folder yet */
  }
  const found = names.map((n) => ({ id: n, name: n, path: join(dirs.backups, n), mtime: statSync(join(dirs.backups, n)).mtimeMs })).sort((a, b) => b.mtime - a.mtime);
  return list.concat(found.map(({ id, name, path }) => ({ id, name, path })));
}

export function startServer({ port = PORT, env = process.env, dirs = folders(env.COACH_OUT || ROOT) } = {}) {
  let ms = null;
  let busy = false;
  const today = () => (isDay(env.COACH_TODAY) ? env.COACH_TODAY : dayOf(new Date()));
  const mySkate = async () => {
    if (!ms) {
      const dir = findMySkate(env);
      ms = dir ? await loadMySkate(dir) : null;
    }
    return ms;
  };
  const claudeEnv = () => cleanEnv(env).env;

  const server = http.createServer(async (req, res) => {
    const host = String(req.headers.host || "");
    if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return send(res, 403, "This app only answers on this Mac (localhost).");
    if (req.method !== "GET") return send(res, 405, "Only GET.");
    const url = new URL(req.url, "http://localhost");

    if (url.pathname === "/api/status") {
      const found = await mySkate();
      const bin = findClaude(env);
      const auth = bin ? await signedIn(bin, { env: claudeEnv() }) : { ok: false, message: "Claude Code is not installed on this Mac. See README.md, Setup." };
      return json(res, { mode: "live", today: today(), mySkate: Boolean(found), signIn: { ok: auth.ok, message: auth.message }, model: MODEL, backups: listBackups(dirs).map(({ id, name }) => ({ id, name })) });
    }

    if (url.pathname === "/api/plan") {
      if (busy) return send(res, 409, "A plan is already being made. Wait for it to finish.");
      busy = true;
      try {
        await planStream(url.searchParams, res);
      } finally {
        busy = false;
      }
      return;
    }

    const file = staticFile(url.pathname);
    if (!file) return send(res, 404, "Not here.");
    try {
      const body = readFileSync(file);
      res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
      res.end(body);
    } catch {
      send(res, 404, "Not here.");
    }
  });

  /* One run, sent to the page step by step as server-sent events: { t: ms since the start, type, data }. */
  async function planStream(params, res) {
    res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", Connection: "keep-alive" });
    const events = [];
    const t0 = Date.now();
    const emit = (type, data = {}) => {
      const ev = { t: Date.now() - t0, type, data };
      events.push(ev);
      res.write(`data: ${JSON.stringify(ev)}\n\n`);
    };
    const fail = (message) => {
      emit("error", { message });
      emit("done");
      res.end();
    };

    const day0 = today();
    const choice = listBackups(dirs).find((b) => b.id === params.get("backup"));
    if (!choice) return fail("Pick one of the backups in the list.");
    const slotMin = Number(params.get("slot"));
    if (!Number.isInteger(slotMin) || slotMin < 15 || slotMin > 180 || slotMin % 5) return fail("The ice time must be 15 to 180 minutes, in steps of 5.");
    const date = params.get("day") === "today" ? day0 : addDays(day0, 1);
    const found = await mySkate();
    if (!found) return fail("MySkate Coach needs MySkate in the folder next to it.");

    emit("reading", { file: choice.id === "sample" ? "the made-up skater's backup" : choice.name });
    const backup = await readBackup(choice.path, found, { workspace: WORKSPACE });
    if (!backup.ok) return fail(/locked with a passphrase/.test(backup.error) ? "That backup is locked. The app can't ask for a passphrase: use the command (npm run coach), or save an unlocked backup." : backup.error);
    emit("read", { ...backup.summary });
    const brief = makeBrief(found, backup.state, { today: day0, date, slotMin });
    emit("brief", { facts: brief.facts.length, skills: brief.candidates.length, text: brief.text, date, slotMin });

    const bin = findClaude(env);
    if (!bin) return fail("Claude Code is not installed on this Mac. See README.md, Setup.");
    const cenv = claudeEnv();
    const auth = await signedIn(bin, { env: cenv });
    if (!auth.ok) return fail(auth.message);

    const startedAt = new Date();
    let n = 0;
    const result = await coach({
      ms: found,
      state: backup.state,
      today: day0,
      date,
      slotMin,
      ask: async (prompt) => {
        n += 1;
        const answer = await askClaude({ bin, prompt, model: MODEL, env: cenv, workdir: dirs.work });
        emit("answered", { n, ok: answer.ok, seconds: Math.round((answer.meta.durationMs || 0) / 100) / 10, model: answer.meta.model || null, message: answer.message || "", reply: answer.ok ? answer.reply : null });
        return answer;
      },
      on: {
        asking: (k) => emit("asking", { n: k, model: MODEL }),
        checked: (k, c) => emit("checked", { n: k, ok: c.ok, problems: c.problems, passed: c.ok ? passedLines(c.plan) : [] }),
      },
    });
    emit("result", { source: result.source, retried: result.retried, reason: result.reason, plan: result.plan });
    const saved = saveRun({ result, today: day0, date, dirs, backupPath: choice.path, backup, bin, model: MODEL, signIn: auth.method, startedAt, finishedAt: new Date(), events: events.slice() });
    emit("saved", saved);
    emit("done");
    res.end();
  }

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

function send(res, status, text) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}
function json(res, data) {
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.COACH_PORT) || PORT;
  startServer({ port }).then(
    () => console.log(`MySkate Coach is running on this Mac: http://localhost:${port}\nPress Ctrl-C to stop it.`),
    (err) => {
      console.error(err.code === "EADDRINUSE" ? `Port ${port} is busy. Try: COACH_PORT=8791 npm run app` : `MySkate Coach could not start: ${err.message}`);
      process.exitCode = 1;
    }
  );
}
