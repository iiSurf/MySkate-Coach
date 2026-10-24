/* Every check on Claude's reply. Claude is asked for one JSON reply in a fixed shape (prompts/reply.schema.json). This code checks
   what the reply means before anyone sees it: real skills from the list offered, minutes that fit the ice time, reasons that use
   only numbers found in the facts they cite, and a focus copied word for word from the skater's own notes. It never trusts the
   reply and never fixes it: the plan passes as it is, or the problems are listed in plain words (they go back to Claude for the one
   retry, and into the run log). Pure: no files, no model. */

import { cut, numbersIn, shortName, LIMITS as BRIEF } from "./brief.js";

export const LIMITS = { why: 90, focus: 120, focusMin: 3, summary: 140, factsPerItem: 4 };

const isText = (v) => typeof v === "string";
const isObject = (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const CONTROL = /[\u0000-\u001f\u007f]/;
/* Text compared loosely: any case, curly or straight quotes, any spacing. */
const loose = (t) => String(t).toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();
/* A quote without the quote marks and the full stop around it. */
const bare = (t) => loose(t).replace(/^["'\s]+/, "").replace(/["'.!,;:\s]+$/, "");
const these = (list) => `${list.join(", ")}, which ${list.length === 1 ? "is" : "are"}`;

/* Check a reply against the brief it answers. catalog is MySkate's catalog. Returns { ok: true, problems: [], plan } or
   { ok: false, problems: [...], plan: null }. */
export function checkPlan(reply, brief, catalog) {
  if (!isObject(reply)) return { ok: false, problems: ["The reply is not a JSON object."], plan: null };
  if (!Array.isArray(reply.items)) return { ok: false, problems: ['The reply has no "items" list.'], plan: null };

  const problems = [];
  const items = reply.items;
  if (items.length < brief.minItems || items.length > brief.maxItems) problems.push(`The plan has ${items.length} skills; it needs ${brief.minItems} to ${brief.maxItems}.`);

  const seen = new Set();
  const minutesUsed = [];
  let minutesOk = true;
  const clean = items.map((item, i) => {
    if (!isObject(item)) {
      problems.push(`Skill ${i + 1} is not an object.`);
      minutesOk = false;
      return null;
    }
    const { skillId, minutes, why, facts, focus } = item;
    const it = isText(skillId) && skillId ? `Skill ${i + 1} ("${cut(skillId, 60)}")` : `Skill ${i + 1}`;

    /* The skill: one of those offered, and only once. */
    const offered = isText(skillId) && brief.candidateIds.has(skillId);
    if (!isText(skillId) || !skillId) problems.push(`${it} has no skillId.`);
    else if (!offered) problems.push(catalog.skills.has(skillId) ? `${it} is a MySkate skill but not one of the skills offered.` : `${it} is not a MySkate skill.`);
    else if (seen.has(skillId)) problems.push(`${it} is in the plan twice.`);
    if (isText(skillId)) seen.add(skillId);

    /* Its minutes: whole, in steps of 5, at least 5. */
    if (!Number.isInteger(minutes) || minutes < BRIEF.step || minutes % BRIEF.step !== 0) {
      problems.push(`${it} has ${JSON.stringify(minutes) ?? "no"} minutes; minutes must be a whole number in steps of ${BRIEF.step}, at least ${BRIEF.step}.`);
      minutesOk = false;
    } else minutesUsed.push(minutes);

    const kept = { skillId, minutes, why: isText(why) ? why.trim() : "", facts: Array.isArray(facts) ? facts : [], focus: isText(focus) ? focus.trim() : "" };
    /* The rest is about this skill, so a skill that was not offered is only reported once, above. */
    if (!offered) return kept;

    /* The facts it cites: 1 to 4 real ones, each about this skill or about the whole session. */
    const cited = Array.isArray(facts) && facts.every(isText) && facts.length >= 1 && facts.length <= LIMITS.factsPerItem ? facts : null;
    if (!cited) problems.push(`${it} must cite 1 to ${LIMITS.factsPerItem} fact ids.`);
    const known = [];
    for (const id of cited || []) {
      const f = brief.factById.get(id);
      if (!f) problems.push(`${it} cites ${cut(id, 20)}, which is not a fact.`);
      else if (f.skillId && f.skillId !== skillId) problems.push(`${it} cites ${f.id}, which is about another skill.`);
      else known.push(f);
    }
    const citesOk = Boolean(cited) && known.length === cited.length;

    /* The reason: short, one line, and (once the facts it cites are right) every number in it found in those facts. */
    if (!isText(why) || !why.trim()) problems.push(`${it} has no reason ("why").`);
    else {
      if (why.trim().length > LIMITS.why) problems.push(`${it}: the reason is ${why.trim().length} characters; at most ${LIMITS.why}.`);
      if (CONTROL.test(why)) problems.push(`${it}: the reason has a line break or a control character.`);
      const allowed = new Set([...known.flatMap((f) => [...f.numbers]), String(minutes), String(brief.slotMin)]);
      const extra = [...new Set(numbersIn(why))].filter((n) => !allowed.has(n));
      if (citesOk && extra.length) problems.push(`${it}: the reason uses ${these(extra)} not in the facts it cites.`);
    }

    /* The focus: empty, or words copied from the skater's own cue, notes, or homework for this skill. */
    if (focus !== undefined && focus !== null && !isText(focus)) problems.push(`${it}: the focus must be text.`);
    else if (isText(focus) && focus.trim()) {
      const quote = bare(focus);
      if (focus.trim().length > LIMITS.focus) problems.push(`${it}: the focus is ${focus.trim().length} characters; at most ${LIMITS.focus}.`);
      if (CONTROL.test(focus)) problems.push(`${it}: the focus has a line break or a control character.`);
      const own = (brief.ownWords.get(skillId) || []).map(loose);
      if (quote.length < LIMITS.focusMin || !own.some((words) => words.includes(quote))) problems.push(`${it}: the focus is not copied word for word from the skater's own cue, notes, or homework for this skill.`);
    }

    return kept;
  });

  /* All the minutes together fill the ice time exactly. */
  const total = minutesUsed.reduce((a, b) => a + b, 0);
  if (minutesOk && total !== brief.slotMin) problems.push(`The minutes add up to ${total}, not ${brief.slotMin}.`);

  /* The summary: one short line, and every number in it found somewhere in the facts. */
  const summary = reply.summary;
  if (!isText(summary) || !summary.trim()) problems.push('The plan has no "summary".');
  else {
    if (summary.trim().length > LIMITS.summary) problems.push(`The summary is ${summary.trim().length} characters; at most ${LIMITS.summary}.`);
    if (CONTROL.test(summary)) problems.push("The summary has a line break or a control character.");
    const allowed = new Set([...brief.facts.flatMap((f) => [...f.numbers]), String(brief.slotMin), String(items.length), ...minutesUsed.map(String)]);
    const extra = [...new Set(numbersIn(summary))].filter((n) => !allowed.has(n));
    if (extra.length) problems.push(`The summary uses ${these(extra)} not in the facts.`);
  }

  if (problems.length) return { ok: false, problems, plan: null };
  return {
    ok: true,
    problems: [],
    plan: {
      date: brief.date,
      slotMin: brief.slotMin,
      summary: summary.trim(),
      items: clean.map((it) => ({ ...it, name: shortName(catalog.skills.get(it.skillId).name) })),
    },
  };
}
