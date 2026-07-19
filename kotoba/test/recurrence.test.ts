import { describe, it, expect } from "vitest";
import { parseRRule, expandRRule, expandCalendarEvent } from "../src/index.js";

describe("calendar RRULE expansion", () => {
  it("parses FREQ / INTERVAL / COUNT / UNTIL", () => {
    expect(parseRRule("FREQ=WEEKLY;INTERVAL=2;COUNT=5")).toMatchObject({ freq: "WEEKLY", interval: 2, count: 5 });
    expect(parseRRule("RRULE:FREQ=DAILY")).toMatchObject({ freq: "DAILY", interval: 1 });
    expect(() => parseRRule("FREQ=HOURLY")).toThrow();
    expect(() => parseRRule("FREQ=DAILY;INTERVAL=0")).toThrow();
  });

  it("expands DAILY with COUNT", () => {
    const occ = expandRRule({ start: "2026-06-01T09:00:00.000Z", rrule: "FREQ=DAILY;COUNT=3" });
    expect(occ).toEqual([
      "2026-06-01T09:00:00.000Z",
      "2026-06-02T09:00:00.000Z",
      "2026-06-03T09:00:00.000Z",
    ]);
  });

  it("expands WEEKLY with INTERVAL", () => {
    const occ = expandRRule({ start: "2026-06-01T00:00:00.000Z", rrule: "FREQ=WEEKLY;INTERVAL=2;COUNT=3" });
    expect(occ.map((d) => d.slice(0, 10))).toEqual(["2026-06-01", "2026-06-15", "2026-06-29"]);
  });

  it("expands MONTHLY and respects UNTIL", () => {
    const occ = expandRRule({ start: "2026-01-15T00:00:00.000Z", rrule: "FREQ=MONTHLY;UNTIL=2026-04-15T00:00:00.000Z" });
    expect(occ.map((d) => d.slice(0, 10))).toEqual(["2026-01-15", "2026-02-15", "2026-03-15", "2026-04-15"]);
  });

  it("respects the limit cap", () => {
    const occ = expandRRule({ start: "2026-06-01T00:00:00.000Z", rrule: "FREQ=DAILY", limit: 10 });
    expect(occ).toHaveLength(10);
  });

  it("expandCalendarEvent returns [start] when not recurring", () => {
    expect(expandCalendarEvent({ start: "2026-06-30T09:00:00.000Z" })).toEqual(["2026-06-30T09:00:00.000Z"]);
    expect(expandCalendarEvent({ start: "2026-06-30T09:00:00.000Z", recurrence: "FREQ=YEARLY;COUNT=2" }).map((d) => d.slice(0, 4))).toEqual(["2026", "2027"]);
  });
});
