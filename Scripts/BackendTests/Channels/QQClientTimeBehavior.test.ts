import { afterEach, expect, test, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

test("uses the host timezone for time and calendar boundaries regardless of the machine zone", async () => {
  vi.stubGlobal("document", {
    querySelector: (selector: string) => (selector.includes("senera-time-zone") ? { content: "Asia/Shanghai" } : {}),
  });
  const { dateTimeFormat, calendarDate } = await import("../../../Frontend/qq/client/src/renderer/src/runtime/time.js");
  const instant = new Date("2026-10-24T16:30:00.000Z");
  expect(dateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(instant)).toBe(
    "00:30",
  );
  expect(calendarDate(instant).toISOString()).toBe("2026-10-25T00:00:00.000Z");
  expect(instant.toISOString()).toBe("2026-10-24T16:30:00.000Z");
});

test("rejects a hosted page with a missing time contract", async () => {
  vi.stubGlobal("document", {
    querySelector: (selector: string) => (selector.includes("senera-time-zone") ? null : {}),
  });
  await expect(import("../../../Frontend/qq/client/src/renderer/src/runtime/time.js")).rejects.toThrow(
    "Senera 未提供显示时区",
  );
});
