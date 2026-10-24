/* The coach's folders, and the one boundary it keeps: the owner lets Claude Code work only inside their workspace folder (the folder
   that holds MySkate and MySkate Coach, ~/Documents/claude-workspace), so the coach never reads or writes anywhere else. The only
   exception is running Claude Code itself, which lives where it was installed. */

import { realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/* This repository's folder, and the workspace that holds it. */
export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const WORKSPACE = dirname(ROOT);

/* Where the coach keeps its things: backups/ (put your backup here), plans/, runs/, and .run/ (an empty folder for each Claude Code
   run, removed after). COACH_OUT moves them, for the tests; it must still be inside the workspace. */
export function folders(out = process.env.COACH_OUT || ROOT) {
  return { out, backups: join(out, "backups"), plans: join(out, "plans"), runs: join(out, "runs"), work: join(out, ".run") };
}

/* True when path is inside folder, after following any links, so a link inside the workspace cannot lead out of it. */
export function isInside(path, folder) {
  const real = (p) => {
    try {
      return realpathSync(p);
    } catch {
      return resolve(p);
    }
  };
  const rel = relative(real(folder), real(path));
  return rel === "" || (rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel));
}
