/* Where MySkate is, and its code. The coach reuses MySkate's own code (cleaning a backup, each skill's numbers, the catalog, and the
   fallback plan) instead of copying it, so the coach and the app never disagree. MySkate is the folder next to this one, or wherever
   MYSKATE_DIR says, as long as that is inside the workspace. Nothing here writes to that folder. */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isInside, WORKSPACE } from "./paths.js";

const MODULES = ["store", "stats", "catalog", "plan", "util", "goals", "homework", "testprep", "compete", "crypto"];

/* The MySkate folder, or null when there is none inside the workspace. */
export function findMySkate(env = process.env, workspace = WORKSPACE) {
  const tries = [env.MYSKATE_DIR, join(workspace, "MySkate")].filter(Boolean).map((dir) => resolve(dir));
  return tries.find((dir) => isInside(dir, workspace) && existsSync(join(dir, "js", "store.js")) && existsSync(join(dir, "data", "catalog", "index.json"))) || null;
}

/* MySkate's modules, by file name (store, stats, ...), and its catalog read from disk. */
export async function loadMySkate(dir) {
  const loaded = await Promise.all(MODULES.map((name) => import(pathToFileURL(join(dir, "js", name + ".js")).href)));
  const ms = Object.fromEntries(MODULES.map((name, i) => [name, loaded[i]]));
  ms.catalogLib = ms.catalog;
  ms.catalog = readCatalog(dir, ms.catalogLib.buildCatalog);
  ms.dir = dir;
  return ms;
}

/* The catalog, read the same way MySkate's own tests read it. The free skate test checklists are optional, as in the app. */
function readCatalog(dir, buildCatalog) {
  const read = (file) => JSON.parse(readFileSync(join(dir, "data", "catalog", file), "utf8"));
  const tracks = read("index.json").tracks.map((entry) => {
    const data = read(entry.file);
    return { id: data.id, name: data.name, kind: entry.kind, source: data.source, note: data.note, levels: data.levels };
  });
  const catalog = buildCatalog(tracks);
  try {
    catalog.freeTests = read("freeskate-tests.json");
  } catch {
    catalog.freeTests = null;
  }
  return catalog;
}
