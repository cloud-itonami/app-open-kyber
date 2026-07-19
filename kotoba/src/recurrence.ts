/**
 * open-kyber kotoba — calendar RRULE expansion (ADR-2606037200 D5). Expands the suite
 * `calendar-event` recurrence (RFC-5545 RRULE subset) into concrete occurrence datetimes,
 * so a recurring ERP event (a month-end close, a weekly stand-up) materializes a schedule.
 * Pure (ISO strings in/out). Supports FREQ=DAILY/WEEKLY/MONTHLY/YEARLY + INTERVAL + COUNT +
 * UNTIL, with a hard safety cap so an unbounded rule can't loop forever.
 */

export type Freq = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";

export interface ParsedRRule {
  freq: Freq;
  interval: number;
  count?: number;
  until?: string; // ISO date or datetime
}

const FREQS: ReadonlySet<string> = new Set(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"]);
const SAFETY_CAP = 1000;

/** Parse an RRULE string like "FREQ=WEEKLY;INTERVAL=2;COUNT=5". Throws on a bad FREQ. */
export function parseRRule(rrule: string): ParsedRRule {
  const parts = new Map<string, string>();
  for (const seg of rrule.replace(/^RRULE:/i, "").split(";")) {
    const [k, v] = seg.split("=");
    if (k && v !== undefined) parts.set(k.trim().toUpperCase(), v.trim());
  }
  const freq = (parts.get("FREQ") ?? "").toUpperCase();
  if (!FREQS.has(freq)) throw new Error(`invalid FREQ: ${freq}`);
  const interval = parts.has("INTERVAL") ? Number(parts.get("INTERVAL")) : 1;
  if (!Number.isInteger(interval) || interval < 1) throw new Error("invalid INTERVAL");
  const out: ParsedRRule = { freq: freq as Freq, interval };
  if (parts.has("COUNT")) {
    const c = Number(parts.get("COUNT"));
    if (!Number.isInteger(c) || c < 1) throw new Error("invalid COUNT");
    out.count = c;
  }
  if (parts.has("UNTIL")) out.until = parts.get("UNTIL");
  return out;
}

function advance(d: Date, freq: Freq, interval: number): Date {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  const h = d.getUTCHours();
  const mi = d.getUTCMinutes();
  const s = d.getUTCSeconds();
  switch (freq) {
    case "DAILY": return new Date(Date.UTC(y, m, day + interval, h, mi, s));
    case "WEEKLY": return new Date(Date.UTC(y, m, day + 7 * interval, h, mi, s));
    case "MONTHLY": return new Date(Date.UTC(y, m + interval, day, h, mi, s));
    case "YEARLY": return new Date(Date.UTC(y + interval, m, day, h, mi, s));
  }
}

export interface ExpandInput {
  start: string; // DTSTART (ISO)
  rrule: string;
  /** cap occurrences (default 366); also bounded by COUNT / UNTIL / the safety cap. */
  limit?: number;
}

/** Expand an RRULE into occurrence ISO datetimes (the first is DTSTART). */
export function expandRRule(input: ExpandInput): string[] {
  const startMs = Date.parse(input.start);
  if (Number.isNaN(startMs)) throw new Error("invalid start");
  const rule = parseRRule(input.rrule);
  const untilMs = rule.until ? Date.parse(rule.until) : undefined;
  const max = Math.min(input.limit ?? 366, rule.count ?? SAFETY_CAP, SAFETY_CAP);

  const out: string[] = [];
  let cur = new Date(startMs);
  while (out.length < max) {
    if (untilMs !== undefined && cur.getTime() > untilMs) break;
    out.push(cur.toISOString());
    cur = advance(cur, rule.freq, rule.interval);
  }
  return out;
}

/** Convenience: expand a suite calendar event's recurrence (returns [start] if none). */
export function expandCalendarEvent(
  event: { start: string; recurrence?: string },
  opts: { limit?: number } = {},
): string[] {
  if (!event.recurrence) return [event.start];
  return expandRRule({ start: event.start, rrule: event.recurrence, limit: opts.limit });
}
