/** All business dates use Malaysian local time, regardless of the browser's timezone. */
export const BUSINESS_TIMEZONE = "Asia/Kuala_Lumpur";

export function money(x: number): string {
  return `RM ${Number(x).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Round to whole sen to avoid floating point drift in money maths. */
export function roundMoney(x: number): number {
  return Math.round(x * 100) / 100;
}

/** yyyy-mm-dd for the given instant in Malaysian local time. */
export function localDate(instant: Date | string = new Date()): string {
  const d = typeof instant === "string" ? new Date(instant) : instant;
  return new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** Today's date as yyyy-mm-dd in Malaysian local time. */
export function todayLocal(now: Date = new Date()): string {
  return localDate(now);
}

/** Calendar maths on yyyy-mm-dd strings (timezone-free). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

/** Whole days from a to b (b - a) for yyyy-mm-dd strings. */
export function daysBetween(a: string, b: string): number {
  const toUtc = (s: string) => {
    // Catalogue transport may serialize a date as midnight ISO; keep calendar maths timezone-free.
    const [y, m, d] = s.slice(0, 10).split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

export function isValidDate(s: string | null | undefined): s is string {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** yyyy-mm-dd -> "21 Oct 2026" */
export function prettyDate(s: string | undefined | null): string {
  if (!s) return "Not selected";
  // Catalogue date fields may arrive as ISO midnight; preserve their calendar date, without timezone conversion.
  if (s[10] === "T" && isValidDate(s.slice(0, 10))) s = s.slice(0, 10);
  if (!isValidDate(s)) return s;
  const [y, m, d] = s.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** "today", "tomorrow" or "in N days" relative to today (Malaysian time). */
export function relativeDay(date: string, today = todayLocal()): string {
  const n = daysBetween(today, date);
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n === -1) return "yesterday";
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n !== 1 ? "s" : ""}`;
}

/** Round a quantity for display (max 1 decimal). */
export function qtyText(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function klHour(now: Date): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: BUSINESS_TIMEZONE, hour: "2-digit", hour12: false }).format(now)) % 24;
}

export function timeOfDayGreeting(now: Date = new Date()): string {
  const h = klHour(now);
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export function shortTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-MY", { timeZone: BUSINESS_TIMEZONE, hour: "2-digit", minute: "2-digit" });
}

export function shortDate(iso: string): string {
  return prettyDate(localDate(iso));
}

export function dateTime(iso: string): string {
  return `${shortDate(iso)}, ${shortTime(iso)}`;
}
