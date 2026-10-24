/* Shared by the tests: MySkate's code, the made-up backup, and a fixed "today" so every test sees the same week. */

import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { findMySkate, loadMySkate } from "../lib/myskate.js";
import { ROOT } from "../lib/paths.js";

export const TODAY = "2026-10-23";
export const FIXTURE = new URL("./fixtures/backup.json", import.meta.url).pathname;

/* A new empty folder for a test, inside the repository's .tmp/ (cleared before every npm test), never in the system's temporary
   folder: the coach and its tests stay inside the workspace. */
export function tempDir(prefix = "t-") {
  mkdirSync(join(ROOT, ".tmp"), { recursive: true });
  return mkdtempSync(join(ROOT, ".tmp", prefix));
}

let cached = null;
export async function mySkate() {
  if (!cached) {
    const dir = findMySkate();
    if (!dir) throw new Error("These tests need MySkate in the folder next to this one, or MYSKATE_DIR set.");
    cached = await loadMySkate(dir);
  }
  return cached;
}

/* The made-up skater's data, cleaned by MySkate the way a restored backup is. */
export async function fixtureState() {
  const ms = await mySkate();
  const parsed = ms.store.parseBackup(readFileSync(FIXTURE, "utf8"));
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.state;
}
