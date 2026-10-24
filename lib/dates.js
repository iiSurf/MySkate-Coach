/* Days as words, always in English and never shifted by a time zone: "Thu, Oct 22" and "Thu, Oct 22, 2026". A day is "YYYY-MM-DD"
   on the skater's own calendar, as everywhere in MySkate. */

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const parse = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
};

export const isDay = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(parse(v).getTime()) && dayOf(parse(v)) === v;

export function dayOf(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function fmtDay(iso) {
  const d = parse(iso);
  return `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

export const fmtDayLong = (iso) => `${fmtDay(iso)}, ${iso.slice(0, 4)}`;

export function addDays(iso, n) {
  const d = parse(iso);
  d.setDate(d.getDate() + n);
  return dayOf(d);
}

export const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);
