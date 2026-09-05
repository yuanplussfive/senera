import { describe, expect, test } from "vitest";
import {
  DefaultAgentTimeZone,
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
});
