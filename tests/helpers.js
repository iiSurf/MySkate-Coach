/* Shared by the tests: MySkate's code, the made-up backup, and a fixed "today" so every test sees the same week. */

import { readFileSync } from "node:fs";
import { findMySkate, loadMySkate } from "../lib/myskate.js";

export const TODAY = "2026-10-23";
export const FIXTURE = new URL("./fixtures/backup.json", import.meta.url).pathname;

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
