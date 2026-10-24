import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, utimesSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backupFolders, findNewestBackup, readBackup } from "../lib/backup.js";
import { findMySkate } from "../lib/myskate.js";
import { FIXTURE, mySkate } from "./helpers.js";

const temp = () => mkdtempSync(join(tmpdir(), "coach-test-"));

test("finds MySkate next to this folder, and skips a MYSKATE_DIR that is not MySkate", () => {
  const dir = findMySkate({ MYSKATE_DIR: temp() });
  assert.ok(dir && dir.endsWith("MySkate"));
});

test("looks in Downloads and iCloud Drive", () => {
  const folders = backupFolders("/Users/sam");
  assert.deepEqual(folders, ["/Users/sam/Downloads", "/Users/sam/Library/Mobile Documents/com~apple~CloudDocs/Downloads", "/Users/sam/Library/Mobile Documents/com~apple~CloudDocs"]);
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

test("reads a backup with MySkate's own cleaning", async () => {
  const ms = await mySkate();
  const r = await readBackup(FIXTURE, ms);
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
