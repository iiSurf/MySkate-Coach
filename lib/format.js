/* The plan as the skater reads it: lines for the terminal (with a little color when the terminal shows it) and Markdown for the
   plans/ folder. Everything here is already checked; this only lays it out. */

import { fmtDay, fmtDayLong } from "./dates.js";

const CODES = { bold: 1, dim: 2, red: 31, green: 32, yellow: 33 };
export const painter = (on) => (style, text) => (on ? `\x1b[${CODES[style]}m${text}\x1b[0m` : String(text));

/* Text wrapped to a width, every line after the first indented. */
export function wrap(text, width, indent = "") {
  /* A date like "Oct 7" stays on one line. */
  const words = String(text).replace(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d)/g, "$1\u00a0$2").split(/[ \t\r\n]+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const w of words) {
    const lead = lines.length ? indent : "";
    if (line && lead.length + line.length + 1 + w.length > width) {
      lines.push(line);
      line = w;
    } else line = line ? `${line} ${w}` : w;
  }
  if (line) lines.push(line);
  return lines.map((l, i) => (i ? indent + l : l));
}

/* What the checks found, in plain words, for a plan that passed them. */
export function passedLines(plan) {
  const total = plan.items.reduce((sum, it) => sum + it.minutes, 0);
  const lines = [`${plan.items.length} skills, all from the list offered`, `${total} of ${plan.slotMin} minutes, in steps of 5`, "every number in the reasons is in your log"];
  if (plan.items.some((it) => it.focus)) lines.push("every focus is in your own words");
  return lines;
}

/* The plan for the terminal. */
export function planLines(result, { color = false, width = 80 } = {}) {
  const c = painter(color);
  const { plan } = result;
  const w = Math.max(40, width);
  const out = [c("bold", `${fmtDay(plan.date)} · ${plan.slotMin} mins`) + (result.source === "myskate" ? c("yellow", "  MySkate's own suggestion") : "")];
  out.push(...wrap(plan.summary, w));
  out.push("");
  plan.items.forEach((it, i) => {
    const head = wrap(`${i + 1}. ${it.name} · ${it.minutes} min`, w, "   ");
    out.push(c("bold", head[0]), ...head.slice(1).map((l) => c("bold", l)));
    out.push(...wrap(it.why, w - 3).map((l) => "   " + c("dim", l)));
    if (it.focus) out.push(...wrap(`Focus: "${it.focus}"`, w - 3).map((l) => "   " + l));
  });
  return out;
}

/* Markdown special characters, escaped, so text from the model or the notes shows as written. */
const md = (text) => String(text).replace(/([\\`*_[\]<>#|])/g, "\\$1");

/* The plan as a Markdown file for plans/. */
export function planMarkdown(result, { today }) {
  const { plan } = result;
  const lines = [`# Practice plan for ${fmtDay(plan.date)} · ${plan.slotMin} mins`, "", md(plan.summary), ""];
  plan.items.forEach((it, i) => {
    lines.push(`${i + 1}. **${md(it.name)}** · ${it.minutes} min  `);
    lines.push(`   ${md(it.why)}${it.focus ? "  " : ""}`);
    if (it.focus) lines.push(`   Focus: "${md(it.focus)}"`);
  });
  lines.push("");
  if (result.source === "claude") lines.push(`Planned by Claude with MySkate Coach on ${fmtDayLong(today)}, and checked: ${passedLines(plan).join("; ")}.`);
  else lines.push(`MySkate's own suggestion, made by MySkate Coach on ${fmtDayLong(today)}. Claude's plan could not be used: ${md(result.reason)}`);
  return lines.join("\n") + "\n";
}
