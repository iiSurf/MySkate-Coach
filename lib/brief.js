/* The brief: everything Claude is given to plan one session. Numbered facts worked out from the backup with MySkate's own numbers,
   the list of skills Claude may pick, and the size of the plan. Only what the plan needs goes in (README.md, "What is sent to
   Claude"): never the skater's name, friends, costs, or rinks. Pure: it reads nothing from disk and never calls the model. */

import { addDays, daysBetween, fmtDay, fmtDayLong } from "./dates.js";

export const LIMITS = {
  candidates: 60, // skills Claude may pick from, at most
  recentSessions: 5, // sessions listed one by one
  notesPerSkill: 2, // the skater's latest notes on each listed skill
  noteChars: 160, // a note or cue is cut to this length
  homeworkChars: 200,
  eventDays: 60, // a competition this close is mentioned
  practicedDays: 60, // a skill practiced this recently is offered even when it is off the skater's levels
  minItems: 2, // skills in a plan, at least
  maxItems: 6, // and at most
  step: 5, // minutes come in steps of 5
};

const KIND = { skills: "skating skill", jumps: "jump", spins: "spin" };

/* The whole numbers in a piece of text, without leading zeros: "4 of 12 on Oct 22" gives 4, 12, and 22. */
export function numbersIn(text) {
  return (String(text).match(/\d+/g) || []).map((n) => String(Number(n)));
}

/* Text on one line, cut to a length. */
export function cut(text, max) {
  const t = String(text).replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t;
}

/* A skill's name without the details in brackets at the end: "Mazurka (right or left)" is "Mazurka". */
export const shortName = (name) => String(name).replace(/(\s*\([^()]*\))+$/, "") || String(name);

const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const when = (days) => (days === 0 ? "today" : days === 1 ? "tomorrow" : days === -1 ? "yesterday" : days > 0 ? `in ${days} days` : `${-days} days ago`);

/* How many skills a plan of this length can hold. */
export function planSize(slotMin) {
  const maxItems = Math.min(LIMITS.maxItems, Math.floor(slotMin / LIMITS.step));
  return { minItems: Math.min(LIMITS.minItems, maxItems), maxItems };
}

/* The skills of a level of one kind (a level key, or "library" for the whole jump and spin library). */
function levelIds(ms, key, want) {
  if (!key) return [];
  const keys = key === "library" ? [...ms.catalog.levels.values()].filter((l) => l.trackId === "library").map((l) => l.key) : [key];
  return keys.flatMap((k) => ms.catalogLib.levelSkillIds(ms.catalog, k, { bonus: true })).filter((id) => want(ms.catalog.skills.get(id)));
}

const levelName = (ms, key) => ms.catalogLib.levelLabel(ms.catalog, key) || "no level set";

/* The skater's own words about each skill: their cue and their latest notes on it, newest first. */
function wordsBySkill(state) {
  const notes = new Map();
  for (const s of [...state.sessions].reverse()) {
    for (const e of s.entries) {
      if (!e.note || !e.note.trim()) continue;
      const list = notes.get(e.skillId) || [];
      if (list.length < LIMITS.notesPerSkill) list.push({ text: cut(e.note, LIMITS.noteChars), date: s.date });
      notes.set(e.skillId, list);
    }
  }
  return notes;
}

/* The brief for one plan. today and date are days ("YYYY-MM-DD"); slotMin is the length of the ice time in minutes. */
export function makeBrief(ms, state, { today, date, slotMin }) {
  const { catalog } = ms;
  const stats = ms.stats.skillStats(state.sessions);
  const suggested = new Map(ms.stats.suggestNext(state, catalog, stats, today, 8).map((s) => [s.skillId, s.reason]));
  const name = (id) => shortName(catalog.skills.get(id).name);
  const levels = state.profile.levels;

  /* What matters now, from the skater's own data. */
  const homework = ms.homework.sortedHomework(state.homework, today).filter((h) => !h.done);
  const goals = ms.goals.sortedGoals(state.goals, stats, today).filter((g) => !g.met && catalog.skills.has(g.skillId));
  const nextEvent = ms.compete.nextEvent(state.events, today);
  const event = nextEvent && daysBetween(today, nextEvent.date) <= LIMITS.eventDays ? nextEvent : null;
  const programSkills = event
    ? [...new Set(state.programs.filter((p) => p.eventId === event.id).flatMap((p) => p.elements.map((e) => e.skillId)))].filter((id) => catalog.skills.has(id))
    : [];
  const testGoal = state.profile.test;
  const test = testGoal && (!testGoal.date || testGoal.date >= today) ? ms.testprep.testList(catalog).find((t) => t.id === testGoal.id) : null;

  /* The skills Claude may pick, most pressing first, each with why it is on the list. */
  const tags = new Map();
  const tag = (id, label) => {
    if (!catalog.skills.has(id)) return;
    const list = tags.get(id) || [];
    if (!list.includes(label)) list.push(label);
    tags.set(id, list);
  };
  homework.forEach((h) => h.skillId && tag(h.skillId, "homework"));
  goals.forEach((g) => tag(g.skillId, "a goal"));
  programSkills.forEach((id) => tag(id, `in the ${event.name} program`));
  levelIds(ms, levels.skills, ms.stats.isSkating).forEach((id) => tag(id, "on their level"));
  levelIds(ms, levels.jumps, ms.stats.isAir).forEach((id) => tag(id, "on their level"));
  if (test) levelIds(ms, test.levelKey, () => true).forEach((id) => tag(id, `on their ${test.name} test`));
  for (const [id, st] of stats) if (st.lastDate && daysBetween(st.lastDate, today) <= LIMITS.practicedDays) tag(id, "practiced lately");
  levelIds(ms, ms.catalogLib.nextLevelKey(catalog, levels.skills), ms.stats.isSkating).forEach((id) => tag(id, "next level"));
  levelIds(ms, ms.catalogLib.nextLevelKey(catalog, levels.jumps), ms.stats.isAir).forEach((id) => tag(id, "next level"));
  const picked = [...tags.entries()].slice(0, LIMITS.candidates);

  const facts = [];
  const fact = (id, text, skillId = "") => facts.push({ id, skillId, text, numbers: new Set(numbersIn(text)) });

  /* General facts: the day, the levels, and the recent sessions. */
  fact("D1", `Today is ${fmtDayLong(today)}. The plan is for ${fmtDay(date)}: ${slotMin} minutes on the ice.`);
  fact("L1", `Levels: skating skills at ${levelName(ms, levels.skills)}, jumps and spins at ${levelName(ms, levels.jumps)}.`);
  const past = state.sessions.filter((s) => s.date <= today);
  const month = past.filter((s) => s.date >= addDays(today, -27));
  const monthMin = month.reduce((sum, s) => sum + s.onIceSec / 60, 0);
  fact("W1", `Last 4 weeks: ${plural(month.length, "session")}, ${ms.util.fmtMinutes(monthMin)} on the ice.`);
  const recent = [...past].reverse().slice(0, LIMITS.recentSessions);
  if (!recent.length) fact("R1", "No sessions logged yet.");
  recent.forEach((s, i) => {
    const rated = s.entries.filter((e) => e.stars > 0 || e.attempts > 0).length;
    fact(`R${i + 1}`, `${fmtDay(s.date)} (${when(daysBetween(today, s.date))}): ${Math.round(s.onIceSec / 60)} minutes on the ice, ${plural(rated, "skill")} rated.`);
  });

  /* Homework, goals, the test, and the next competition. */
  homework.forEach((h, i) => {
    const sid = catalog.skills.has(h.skillId) ? h.skillId : "";
    const due = h.due ? `, due ${fmtDay(h.due)} (${when(daysBetween(today, h.due))})` : "";
    fact(`H${i + 1}`, `Homework from the coach${sid ? ` for ${name(sid)}` : ""}${due}: "${cut(h.text, LIMITS.homeworkChars)}".`, sid);
  });
  goals.forEach((g, i) => {
    const by = g.date ? ` by ${fmtDay(g.date)} (${when(daysBetween(today, g.date))})` : "";
    fact(`G${i + 1}`, `Goal: ${name(g.skillId)} to ${plural(g.target, "star")}${by}; now ${g.latest ? plural(g.latest, "star") : "not rated yet"}.`, g.skillId);
  });
  if (test) fact("T1", `Test: the ${test.name} skating skills test${testGoal.date ? ` on ${fmtDay(testGoal.date)} (${when(daysBetween(today, testGoal.date))})` : ", no date set"}.`);
  if (event) {
    const program = programSkills.length ? `. Their program for it has ${programSkills.map(name).join("; ")}` : "";
    fact("E1", `Competition: ${event.name} on ${fmtDay(event.date)} (${when(daysBetween(today, event.date))})${program}.`);
  }

  /* One fact for each skill on the list: how it has gone, in MySkate's own numbers, and the skater's own words about it. */
  const notes = wordsBySkill(state);
  const ownWords = new Map();
  const candidates = picked.map(([skillId, labels], i) => {
    const sk = catalog.skills.get(skillId);
    const st = stats.get(skillId);
    const parts = [`${sk.name} [${skillId}]: ${KIND[sk.cat] || "skill"}, ${labels.join(", ")}${sk.bonus ? ", a bonus skill" : ""}.`];
    if (!st) parts.push("Not tried yet.");
    else {
      const rated = st.history.filter((h) => h.stars > 0);
      if (rated.length) {
        const last = rated[rated.length - 1];
        const trend = rated.length > 1 ? `, last ratings ${rated.slice(-3).map((h) => h.stars).join(", ")}` : "";
        parts.push(`Latest ${plural(st.latest, "star")} on ${fmtDay(last.date)}, best ${st.best}, rated in ${plural(rated.length, "session")}${trend}.`);
      }
      const tried = [...st.history].reverse().find((h) => h.attempts > 0);
      if (tried) parts.push(`Landed ${tried.landed} of ${tried.attempts} on ${fmtDay(tried.date)}; ${st.landed} of ${st.attempts} in all (${ms.stats.landedPct(st)}%).`);
      parts.push(`Last practiced ${fmtDay(st.lastDate)} (${when(daysBetween(today, st.lastDate))}).`);
      if (st.latest >= ms.stats.EARNED_AT) parts.push(`Earned (${ms.stats.EARNED_AT} stars or more).`);
    }
    if (suggested.has(skillId)) parts.push(`MySkate's own pick: ${suggested.get(skillId).toLowerCase()}.`);
    const words = [];
    const cue = state.cues[skillId];
    if (cue) {
      words.push(cut(cue, LIMITS.noteChars));
      parts.push(`Their cue: "${words[words.length - 1]}".`);
    }
    const own = notes.get(skillId) || [];
    if (own.length) parts.push(`Their notes: ${own.map((n) => `"${n.text}" (${fmtDay(n.date)})`).join("; ")}.`);
    words.push(...own.map((n) => n.text));
    homework.filter((h) => h.skillId === skillId).forEach((h) => words.push(cut(h.text, LIMITS.homeworkChars)));
    ownWords.set(skillId, words);
    const factId = `S${i + 1}`;
    fact(factId, parts.join(" "), skillId);
    return { skillId, name: sk.name, cat: sk.cat, factId, tags: labels };
  });

  const { minItems, maxItems } = planSize(slotMin);
  const text = [
    `Plan one practice session for ${fmtDay(date)}: ${slotMin} minutes on the ice.`,
    "",
    "Facts from the skater's MySkate log:",
    ...facts.map((f) => `${f.id} ${f.text}`),
    "",
    "Skills you may choose (copy the skillId exactly):",
    ...candidates.map((c) => `- ${c.skillId} (${shortName(c.name)}), fact ${c.factId}`),
    "",
    `Reply with ${minItems} to ${maxItems} skills. Minutes come in steps of ${LIMITS.step}, at least ${LIMITS.step} each, and add up to exactly ${slotMin}.`,
  ].join("\n");

  return {
    today,
    date,
    slotMin,
    minItems,
    maxItems,
    facts,
    factById: new Map(facts.map((f) => [f.id, f])),
    candidates,
    candidateIds: new Set(candidates.map((c) => c.skillId)),
    ownWords,
    text,
  };
}
