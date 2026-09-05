import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, test } from "vitest";
import {
  durationBetween,
  formatAgentWorldDuration,
  formatAgentWorldSeconds,
  projectAgentWorldTime,
} from "../../../Source/AgentSystem/World/AgentWorldTime.js";

describe("world time", () => {
  test("calculates local phase and readable durations from physical instants", () => {
    const from = Temporal.Instant.from("2026-08-29T12:10:00Z");
    const to = Temporal.Instant.from("2026-08-29T13:30:00Z");
    const time = projectAgentWorldTime({
      instant: to,
      timeZone: "Asia/Shanghai",
      dayPhases: [
        { id: "night", label: "深夜", startsAt: "00:00", endsAt: "06:00" },
        { id: "morning", label: "上午", startsAt: "06:00", endsAt: "12:00" },
        { id: "afternoon", label: "下午", startsAt: "12:00", endsAt: "18:00" },
        { id: "evening", label: "晚上", startsAt: "18:00", endsAt: "00:00" },
      ],
    });

    expect(time).toMatchObject({
      localDate: "2026-08-29",
      localTime: "21:30:00",
      weekdayLabel: "星期六",
      phaseLabel: "晚上",
      dayElapsedSeconds: 21.5 * 60 * 60,
    });
    expect(formatAgentWorldDuration(durationBetween(from, to))).toBe("1小时20分钟");
    expect(formatAgentWorldSeconds(59)).toBe("59秒");
    expect(formatAgentWorldSeconds(61)).toBe("1分钟");
    expect(formatAgentWorldSeconds(3_657)).toBe("1小时0分钟");
    expect(formatAgentWorldSeconds(36_657)).toBe("10小时10分钟");
    expect(formatAgentWorldSeconds(86_461)).toBe("1天0小时1分钟");
  });

  test("rounds sub-second instants into stable whole-second projections", () => {
    const time = projectAgentWorldTime({
      instant: Temporal.Instant.from("2026-08-30T08:44:28.087468068Z"),
      timeZone: "Asia/Shanghai",
      dayPhases: [
        { id: "night", label: "深夜", startsAt: "00:00", endsAt: "06:00" },
        { id: "morning", label: "上午", startsAt: "06:00", endsAt: "12:00" },
        { id: "afternoon", label: "下午", startsAt: "12:00", endsAt: "18:00" },
        { id: "evening", label: "晚上", startsAt: "18:00", endsAt: "00:00" },
      ],
    });

    expect(Number.isSafeInteger(time.dayElapsedSeconds)).toBe(true);
    expect(Number.isSafeInteger(time.dayRemainingSeconds)).toBe(true);
    expect(time.dayElapsedSeconds + time.dayRemainingSeconds).toBe(86_400);
  });
});
