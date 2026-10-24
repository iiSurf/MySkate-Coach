/* MySkate's own plan, for when Claude's plan fails the checks twice or Claude Code cannot answer: the skills MySkate's own
   suggestNext picks, with the ice time shared out by MySkate's own splitMinutes. It is what the app itself would suggest, and it
   passes the same checks as Claude's plan. */

import { shortName } from "./brief.js";

export const MINUTES_PER_SKILL = 15;

export function mySkatePlan(ms, state, brief, summary = "MySkate's own suggestion.") {
  const stats = ms.stats.skillStats(state.sessions);
  const count = Math.max(brief.minItems, Math.min(brief.maxItems, Math.floor(brief.slotMin / MINUTES_PER_SKILL)));
  const picks = ms.stats.suggestNext(state, ms.catalog, stats, brief.today, count).filter((p) => brief.candidateIds.has(p.skillId));
  /* Too few suggestions (everything earned and fresh): the rest come from the top of the brief's list. */
  for (const c of brief.candidates) {
    if (picks.length >= count) break;
    if (!picks.some((p) => p.skillId === c.skillId)) picks.push({ skillId: c.skillId, reason: "On your list" });
  }
  const minutes = ms.plan.splitMinutes(brief.slotMin, picks.length);
  const factOf = new Map(brief.candidates.map((c) => [c.skillId, c.factId]));
  return {
    date: brief.date,
    slotMin: brief.slotMin,
    summary,
    items: picks.map((p, i) => ({
      skillId: p.skillId,
      name: shortName(ms.catalog.skills.get(p.skillId).name),
      minutes: minutes[i],
      why: `MySkate's own pick: ${p.reason.toLowerCase()}`,
      facts: [factOf.get(p.skillId)],
      focus: "",
    })),
  };
}
