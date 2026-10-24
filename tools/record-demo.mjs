/* Makes the demo page's recordings in demo/runs/ (shown on GitHub Pages, where Claude cannot run).
     node tools/record-demo.mjs real <runs/....json> <id> "<title>" "<note>"
       copies the steps of a real run of the app (from its run log) into demo/runs/<id>.json
     node tools/record-demo.mjs stand-ins
       records the two runs that show a failed check, with the stand-in for Claude Code and its recorded replies (labelled so)
   Only made-up data goes in: the real runs must be of the made-up skater, and nothing else from the Mac (no paths) is kept. */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import { join } from "node:path";
import { startServer } from "../app.mjs";
import { folders, ROOT } from "../lib/paths.js";
import { tempDir } from "../tests/helpers.js";

const DIR = join(ROOT, "demo", "runs");
const INDEX = join(DIR, "index.json");
const ORDER = ["tomorrow-60", "today-30", "fixed", "fallback"];

function save(id, title, note, events, standIn = false) {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(join(DIR, id + ".json"), JSON.stringify(events, null, 1) + "\n");
  let index = [];
  try {
    index = JSON.parse(readFileSync(INDEX, "utf8"));
  } catch {
    /* a new list */
  }
  index = index.filter((r) => r.id !== id).concat([{ id, title, note, file: id + ".json", standIn }]);
  index.sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));
  writeFileSync(INDEX, JSON.stringify(index, null, 2) + "\n");
  console.log("saved demo/runs/" + id + ".json (" + events.length + " steps)");
}

const [mode, ...args] = process.argv.slice(2);

if (mode === "real") {
  const [logFile, id, title, note] = args;
  const log = JSON.parse(readFileSync(logFile, "utf8"));
  if (!/tests\/fixtures\/backup\.json$/.test(log.backup.file)) throw new Error("Only runs of the made-up skater go in the demo.");
  if (!Array.isArray(log.events)) throw new Error("That run log has no steps: it was not made by the app.");
  const events = log.events.concat([{ t: log.events[log.events.length - 1].t + 200, type: "saved", data: { planFile: "plans/" + log.brief.date + ".md", logFile: "runs/…" } }, { t: log.events[log.events.length - 1].t + 300, type: "done", data: {} }]);
  save(id, title, note, events);
} else if (mode === "stand-ins") {
  const fixture = (n) => join(ROOT, "tests", "fixtures", n);
  const bad = join(tempDir("demo-"), "bad.json");
  const reply = JSON.parse(readFileSync(fixture("replies/good.json"), "utf8"));
  reply.items[1].minutes = 25;
  writeFileSync(bad, JSON.stringify(reply));
  const record = async (replies) => {
    const out = tempDir("demo-");
    const env = { PATH: process.env.PATH, HOME: join(out, "home"), COACH_TODAY: "2026-10-23", CLAUDE_BIN: join(ROOT, "tests", "fake-claude.mjs"), FAKE_CLAUDE_REPLIES: replies, FAKE_CLAUDE_LOG: join(out, "claude.jsonl") };
    const server = await startServer({ port: 0, env, dirs: folders(out) });
    const body = await new Promise((resolve, reject) => {
      http.get({ host: "127.0.0.1", port: server.address().port, path: "/api/plan?backup=sample&slot=60&day=tomorrow", headers: { host: "localhost" } }, (res) => {
        let b = "";
        res.on("data", (d) => (b += d));
        res.on("end", () => resolve(b));
      }).on("error", reject);
    });
    server.close();
    return body.split("\n\n").filter((b) => b.startsWith("data: ")).map((b) => JSON.parse(b.slice(6)))
      .map((e) => (e.type === "saved" ? { ...e, data: { planFile: "plans/2026-10-24.md", logFile: "runs/…" } } : e));
  };
  save("fixed", "A plan fixed on the second try", "The first reply's minutes add up to 65 instead of 60; the checker sends it back once with that problem, and the second reply passes.", await record(`reply:${bad}|reply:${fixture("replies/good.json")}`), true);
  save("fallback", "When the plan can't be used", "Both replies add up to 65 minutes, so the plan is not used: you get MySkate's own suggestion, and the reason.", await record(`reply:${bad}`), true);
} else {
  console.log("Use: node tools/record-demo.mjs real <run log> <id> <title> <note>   or   node tools/record-demo.mjs stand-ins");
  process.exitCode = 1;
}
