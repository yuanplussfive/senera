import { describe, expect, test } from "vitest";
import {
  DefaultAgentTimeZone,
  formatAgentTimeMinute,
  formatAgentTimeMonthDayMinute,
  formatAgentTimeOffset,
  formatAgentTimeOffsetMillisecond,
  normalizeAgentScheduleInstant,
  parseAgentTimeBoundary,
  projectAgentTime,
  resolveAgentTimeZone,
} from "../../../Source/AgentSystem/Time/AgentTime.js";

describe("agent time policy", () => {
  test("uses Shanghai for the product business-day boundary", () => {
    expect(projectAgentTime("2026-01-01T16:30:00.000Z")).toEqual({
      epochMs: Date.parse("2026-01-01T16:30:00.000Z"),
      timeZone: DefaultAgentTimeZone,
      localDate: "2026-01-02",
      localHour: "2026-01-02T00",
    });
  });

  test("accepts IANA time zones and rejects invalid declarations", () => {
    expect(resolveAgentTimeZone("Asia/Shanghai")).toBe(DefaultAgentTimeZone);
    expect(() => resolveAgentTimeZone("China Standard Time")).toThrow("Unsupported IANA time zone");
  });

  test("formats persisted instants at minute precision in Shanghai", () => {
    expect(formatAgentTimeMinute("2026-01-01T16:30:45.000Z")).toBe("2026-01-02 00:30");
    expect(formatAgentTimeMonthDayMinute("2026-12-31T16:30:45.000Z")).toBe("01/01 00:30");
    expect(formatAgentTimeMonthDayMinute("2026-12-31T16:30:45.000Z", "UTC")).toBe("12/31 16:30");
    expect(() => formatAgentTimeMonthDayMinute("invalid")).toThrow("Invalid timestamp");
  });

  test("projects outward ISO text with an explicit Shanghai offset", () => {
    expect(formatAgentTimeOffset("2026-01-01T16:30:45.000Z")).toBe("2026-01-02T00:30:45+08:00");
    expect(formatAgentTimeOffsetMillisecond("2026-01-01T16:30:45.000Z")).toBe("2026-01-02T00:30:45.000+08:00");
  });

  test("parses date-only boundaries as Shanghai calendar days", () => {
    expect(parseAgentTimeBoundary("2026-10-20", "start")).toBe(Date.parse("2026-10-19T16:00:00Z"));
    expect(parseAgentTimeBoundary("2026-10-20", "end-exclusive")).toBe(Date.parse("2026-10-20T16:00:00Z"));
    expect(parseAgentTimeBoundary("2026-10-20", "end-inclusive")).toBe(Date.parse("2026-10-20T15:59:59.999Z"));
  });

  test("treats offsetless schedule text as Shanghai wall-clock time", () => {
    expect(normalizeAgentScheduleInstant("2026-10-20")).toBe("2026-10-19T16:00:00Z");
    expect(normalizeAgentScheduleInstant("2026-10-20T09:30:00")).toBe("2026-10-20T01:30:00Z");
    expect(normalizeAgentScheduleInstant("2026-10-20 09:30")).toBe("2026-10-20T01:30:00Z");
    expect(normalizeAgentScheduleInstant("2026-10-20T09:30:00+08:00")).toBe("2026-10-20T09:30:00+08:00");
    expect(normalizeAgentScheduleInstant("2026-10-20T01:30:00Z")).toBe("2026-10-20T01:30:00Z");
    expect(normalizeAgentScheduleInstant("+10m")).toBe("+10m");
  });
});
