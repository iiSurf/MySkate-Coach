/* Finding and reading a MySkate backup. The file is only read, never changed. A locked backup is unlocked with MySkate's own code,
   and the passphrase is never kept or written anywhere. Everything in the file is cleaned by MySkate's own sanitizeState (through
   parseBackup) before it is used. */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const MAX_BYTES = 30_000_000;
const NAME = /^myskate-backup-.*\.json$/i;

/* Where a backup usually lands: Downloads on this Mac, and iCloud Drive (where an iPhone's Files app saves downloads). */
export function backupFolders(home = homedir()) {
  const icloud = join(home, "Library", "Mobile Documents", "com~apple~CloudDocs");
  return [join(home, "Downloads"), join(icloud, "Downloads"), icloud];
}

/* The newest MySkate backup in these folders, by when the file was saved: { path, mtimeMs }, or null. */
export function findNewestBackup(folders) {
  let best = null;
  for (const dir of folders) {
    let names;
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!NAME.test(name)) continue;
      const path = join(dir, name);
      try {
        const st = statSync(path);
        if (st.isFile() && (!best || st.mtimeMs > best.mtimeMs)) best = { path, mtimeMs: st.mtimeMs };
      } catch {
        /* gone or unreadable: skip it */
      }
    }
  }
  return best;
}

/* Read a backup. Returns { ok: true, state, summary, locked, exportedAt } or { ok: false, error } with a message for the skater.
   askPassphrase is only called for a locked backup. */
export async function readBackup(path, ms, { askPassphrase } = {}) {
  let text;
  try {
    if (statSync(path).size > MAX_BYTES) return { ok: false, error: "That file is too big to be a MySkate backup." };
    text = readFileSync(path, "utf8");
  } catch {
    return { ok: false, error: `Could not read ${path}.` };
  }
  let locked = false;
  if (ms.crypto.isEncryptedBackup(text)) {
    locked = true;
    if (!askPassphrase) return { ok: false, error: "That backup is locked with a passphrase. Run the coach in a terminal so it can ask for it, or save an unlocked backup." };
    const opened = await ms.crypto.decryptBackup(text, await askPassphrase());
    if (!opened.ok) return { ok: false, error: opened.error === "wrong" ? "That passphrase does not open this backup." : "That locked backup is not one MySkate can open." };
    text = opened.text;
  }
  const parsed = ms.store.parseBackup(text);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  return { ok: true, state: parsed.state, summary: parsed.summary, locked, exportedAt: exportedAt(text) };
}

/* When the backup was saved, from the file itself, or null. */
function exportedAt(text) {
  try {
    const value = JSON.parse(text).exportedAt;
    return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : null;
  } catch {
    return null;
  }
}
