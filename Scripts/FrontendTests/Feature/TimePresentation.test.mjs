// @vitest-environment jsdom

import { afterEach, describe, expect, test } from "vitest";
import { formatDateTime, formatShortTime, formatTime } from "../../../Frontend/src/lib/util.ts";

afterEach(() => {
  window.__SENERA_RUNTIME_CONFIG__ = {};
});

describe("time presentation", () => {
  test("formats durable UTC timestamps in Shanghai time regardless of the browser timezone", () => {
    window.__SENERA_RUNTIME_CONFIG__ = { timeZone: "Asia/Shanghai" };

    expect(formatTime("2026-01-01T16:30:00.000Z")).toBe("00:30:00");
    expect(formatShortTime("2026-01-01T16:30:00.000Z")).toMatch(/01\/02.*00:30|01-02.*00:30/u);
    expect(formatDateTime("2026-01-01T16:30:00.000Z")).toMatch(/2026.*01.*02.*00:30/u);
  });

  test("keeps invalid values distinguishable in compact timestamp labels", () => {
    expect(formatTime("not-a-time")).toBe("");
    expect(formatShortTime("not-a-time")).toBe("not-a-time");
    expect(formatDateTime("not-a-time")).toBe("not-a-time");
  });
});
