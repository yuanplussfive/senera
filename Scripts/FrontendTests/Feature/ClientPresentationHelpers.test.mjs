// @vitest-environment jsdom

import { afterEach, describe, expect, test } from "vitest";
import { formatDateTime, formatFileSize, formatShortTime, formatTime } from "../../../Frontend/src/lib/util.ts";
import { sameJsonValue, sameJsonValueReconciled } from "../../../Frontend/src/shared/config/JsonConfigValue.ts";
import {
  classifySettingsContentLayout,
  classifySettingsShellLayout,
} from "../../../Frontend/src/shared/responsive/settingsLayout.ts";

const { readMessageActionIntents } = await import("../../../Frontend/src/features/chat/MessageActions.tsx");

afterEach(() => {
  window.__SENERA_RUNTIME_CONFIG__ = {};
});

const REDACTED = "__senera_redacted_secret__";

describe("file size presentation", () => {
  test("uses consistent binary units for bytes and kilobytes", () => {
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(1023)).toBe("1,023 B");
    expect(formatFileSize(1024)).toBe("1 KiB");
    expect(formatFileSize(897838)).toBe("877 KiB");
  });

  test("scales larger values through binary megabyte and gigabyte units", () => {
    expect(formatFileSize(86799085)).toBe("83 MiB");
    expect(formatFileSize(81267546)).toBe("78 MiB");
    expect(formatFileSize(2281579884)).toBe("2.1 GiB");
    expect(formatFileSize(10 * 1024 * 1024 * 1024)).toBe("10 GiB");
  });
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

test("reconciled comparison treats a redacted placeholder as matching a non-empty draft", () => {
  expect(sameJsonValueReconciled("sk-real", REDACTED)).toBe(true);
  expect(sameJsonValueReconciled({ ApiKey: "sk-real" }, { ApiKey: REDACTED })).toBe(true);
  expect(
    sameJsonValueReconciled(
      { ModelProviderEndpoints: [{ Id: "p", ApiKey: "sk-real" }] },
      { ModelProviderEndpoints: [{ Id: "p", ApiKey: REDACTED }] },
    ),
  ).toBe(true);
});

test("reconciled comparison treats an empty draft as a real edit", () => {
  expect(sameJsonValueReconciled("", REDACTED)).toBe(false);
  expect(sameJsonValueReconciled({ ApiKey: "" }, { ApiKey: REDACTED })).toBe(false);
});

test("reconciled comparison still detects non-secret differences", () => {
  expect(sameJsonValueReconciled({ BaseUrl: "a" }, { BaseUrl: "b" })).toBe(false);
  expect(sameJsonValueReconciled({ ApiKey: "sk", BaseUrl: "a" }, { ApiKey: REDACTED, BaseUrl: "b" })).toBe(false);
  expect(sameJsonValueReconciled({ ApiKey: "sk" }, { ApiKey: REDACTED, Extra: "x" })).toBe(false);
});

test("strict comparison never treats a placeholder as matching a real value", () => {
  expect(sameJsonValue("sk-real", REDACTED)).toBe(false);
  expect(sameJsonValue({ ApiKey: "sk-real" }, { ApiKey: REDACTED })).toBe(false);
});

describe("settings container layout breakpoints", () => {
  test("switches the settings navigation at the 800px container boundary", () => {
    expect(classifySettingsShellLayout(799)).toBe("compact");
    expect(classifySettingsShellLayout(800)).toBe("persistent");
  });

  test("switches list-detail workspaces at the 720px and 1100px boundaries", () => {
    expect(classifySettingsContentLayout(719)).toBe("compact");
    expect(classifySettingsContentLayout(720)).toBe("standard");
    expect(classifySettingsContentLayout(1099)).toBe("standard");
    expect(classifySettingsContentLayout(1100)).toBe("wide");
  });
});

test("message actions expose fork only for stable mutable request boundaries", () => {
  expect(readMessageActionIntents({ hasRequestId: false, hasWorkflow: false })).toEqual(["copy"]);
  expect(readMessageActionIntents({ hasRequestId: true, hasWorkflow: false })).toEqual([
    "copy",
    "fork",
    "regenerate",
    "delete",
  ]);
  expect(readMessageActionIntents({ hasRequestId: true, hasWorkflow: true, allowMutation: false })).toEqual([
    "copy",
    "viewWorkflow",
  ]);
});
