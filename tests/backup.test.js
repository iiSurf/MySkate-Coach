import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, symlinkSync, utimesSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { findNewestBackup, readBackup } from "../lib/backup.js";
import { findMySkate } from "../lib/myskate.js";
import { isInside, ROOT, WORKSPACE } from "../lib/paths.js";
import { FIXTURE, mySkate, tempDir } from "./helpers.js";

const temp = () => tempDir("backup-");

test("finds MySkate next to this folder, and skips a MYSKATE_DIR that is not MySkate or is outside the workspace", () => {
  assert.ok(findMySkate({ MYSKATE_DIR: temp() }).endsWith("/MySkate"));
  assert.equal(findMySkate({ MYSKATE_DIR: "/nowhere/MySkate" }, WORKSPACE), join(WORKSPACE, "MySkate"));
  assert.equal(findMySkate({}, temp()), null, "no MySkate inside that workspace");
});

test("inside the workspace means inside, even through a link", () => {
  assert.equal(WORKSPACE, join(ROOT, ".."));
  assert.ok(isInside(FIXTURE, WORKSPACE));
  assert.ok(isInside(join(WORKSPACE, "MySkate", "js"), WORKSPACE));
  assert.ok(!isInside("/nowhere/myskate-backup-2026-10-23.json", WORKSPACE));
  assert.ok(!isInside(join(WORKSPACE, "..", "Downloads", "x.json"), WORKSPACE));
  assert.ok(!isInside(join(WORKSPACE, "..", "claude-workspace-other"), WORKSPACE));
  const link = join(temp(), "myskate-backup-link.json");
  symlinkSync("/nowhere/myskate-backup.json", link);
  assert.ok(isInside(link, WORKSPACE), "a broken link is judged where it sits, and cannot be read anyway");
});

test("picks the newest backup across folders and ignores other files", () => {
  const a = temp();
  const b = temp();
  const write = (dir, name, secondsAgo) => {
    const path = join(dir, name);
    writeFileSync(path, "{}");
    const t = Date.now() / 1000 - secondsAgo;
    utimesSync(path, t, t);
    return path;
  };
  write(a, "myskate-backup-2026-10-20.json", 300);
  const newest = write(b, "myskate-backup-2026-10-22 (1).json", 100);
  write(a, "notes.json", 10);
  write(b, "other-backup-2026-10-23.json", 5);
  mkdirSync(join(a, "myskate-backup-folder.json"));
  assert.equal(findNewestBackup([a, b, join(a, "missing")]).path, newest);
  assert.equal(findNewestBackup([join(a, "missing")]), null);
});

test("never reads a backup outside the workspace", async () => {
  const ms = await mySkate();
  const r = await readBackup("/nowhere/myskate-backup-2026-10-23.json", ms, { workspace: WORKSPACE });
  assert.deepEqual(r, { ok: false, error: `MySkate Coach only reads backups inside ${WORKSPACE}. Put the backup in the coach's backups folder.` });
});

test("reads a backup with MySkate's own cleaning", async () => {
  const ms = await mySkate();
  const r = await readBackup(FIXTURE, ms, { workspace: WORKSPACE });
  assert.equal(r.ok, true);
  assert.equal(r.locked, false);
  assert.equal(r.state.sessions.length, 10);
  assert.deepEqual(r.summary, { sessions: 10, first: "2026-09-21", last: "2026-10-22" });
  assert.equal(new Date(r.exportedAt).getDate(), 23);
});

test("unlocks a locked backup with the passphrase, and says so when it is wrong or cannot be asked", async () => {
  const ms = await mySkate();
  const dir = temp();
  const path = join(dir, "myskate-backup-2026-10-23-locked.json");
  writeFileSync(path, await ms.crypto.encryptBackup(readFileSync(FIXTURE, "utf8"), "correct horse", { iterations: 1000 }));

  const ok = await readBackup(path, ms, { askPassphrase: async () => "correct horse" });
  assert.equal(ok.ok, true);
  assert.equal(ok.locked, true);
  assert.equal(ok.state.sessions.length, 10);

  const wrong = await readBackup(path, ms, { askPassphrase: async () => "wrong horse" });
  assert.deepEqual(wrong, { ok: false, error: "That passphrase does not open this backup." });

  const cannotAsk = await readBackup(path, ms);
  assert.equal(cannotAsk.ok, false);
  assert.match(cannotAsk.error, /locked with a passphrase/);
});

test("gives MySkate's own message for a file that is not a backup, and a plain one for a missing file", async () => {
  const ms = await mySkate();
  const dir = temp();
  const notJson = join(dir, "a.json");
  const notBackup = join(dir, "b.json");
  const newer = join(dir, "c.json");
  writeFileSync(notJson, "not json at all");
  writeFileSync(notBackup, JSON.stringify({ hello: "there" }));
  writeFileSync(newer, JSON.stringify({ schemaVersion: 99, sessions: [] }));
  assert.match((await readBackup(notJson, ms)).error, /not readable/);
  assert.match((await readBackup(notBackup, ms)).error, /does not look like a MySkate backup/);
  assert.match((await readBackup(newer, ms)).error, /newer version of MySkate/);
  assert.match((await readBackup(join(dir, "missing.json"), ms)).error, /Could not read/);
});
