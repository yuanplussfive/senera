import { expect, test, vi } from "vitest";
import path from "node:path";
import {
  DesktopExternalOpenMaxBytes,
  openDesktopExternalFile,
  readDesktopExternalOpenRequest,
  resolveDesktopExternalOpenPath,
  sanitizeDesktopExternalOpenName,
} from "../../../Apps/Desktop/DesktopExternalOpen.ts";

const TempRoot = path.join("C:", "Temp", "senera-opened-files");

function dependencies(overrides = {}) {
  return {
    tempRoot: TempRoot,
    writeFile: vi.fn().mockResolvedValue(undefined),
    openPath: vi.fn().mockResolvedValue(""),
    ...overrides,
  };
}

test("accepts only a non-empty name and byte payload", () => {
  expect(readDesktopExternalOpenRequest(undefined)).toBeUndefined();
  expect(readDesktopExternalOpenRequest("report.docx")).toBeUndefined();
  expect(readDesktopExternalOpenRequest({ name: "  ", bytes: new Uint8Array([1]) })).toBeUndefined();
  expect(readDesktopExternalOpenRequest({ name: "report.docx", bytes: [1, 2] })).toBeUndefined();
  expect(readDesktopExternalOpenRequest({ name: "report.docx", bytes: new Uint8Array(0) })).toBeUndefined();
  expect(
    readDesktopExternalOpenRequest({
      name: "report.docx",
      bytes: new Uint8Array(DesktopExternalOpenMaxBytes + 1),
    }),
  ).toBeUndefined();

  const bytes = new Uint8Array([1, 2, 3]);
  expect(readDesktopExternalOpenRequest({ name: "report.docx", bytes })).toEqual({ name: "report.docx", bytes });
});

test("reduces a resource name to one safe staged file name", () => {
  expect(sanitizeDesktopExternalOpenName("..\\..\\windows\\system32\\report.docx")).toBe("report.docx");
  expect(sanitizeDesktopExternalOpenName("  报告:第一季度?.docx")).toBe("报告_第一季度_.docx");
  expect(sanitizeDesktopExternalOpenName("")).toBe("resource");
  expect(sanitizeDesktopExternalOpenName("...")).toBe("resource");
  expect(sanitizeDesktopExternalOpenName("nul.docx")).toBe("_nul.docx");

  const longName = sanitizeDesktopExternalOpenName(`${"a".repeat(400)}.docx`);
  expect(longName.endsWith(".docx")).toBe(true);
  expect(longName.length).toBeLessThanOrEqual(120);
});

test("stages the payload in the temp root before asking the shell to open it", async () => {
  const writeFile = vi.fn().mockResolvedValue(undefined);
  const openPath = vi.fn().mockResolvedValue("");
  const bytes = new Uint8Array([4, 5, 6]);

  await expect(
    openDesktopExternalFile({ name: "quarterly report.docx", bytes }, dependencies({ writeFile, openPath })),
  ).resolves.toEqual({ ok: true });

  const stagedPath = path.join(TempRoot, "quarterly report.docx");
  expect(writeFile).toHaveBeenCalledWith(stagedPath, bytes);
  expect(openPath).toHaveBeenCalledWith(stagedPath);
  expect(resolveDesktopExternalOpenPath(TempRoot, "quarterly report.docx")).toBe(stagedPath);
});

test("reports a write failure without touching the shell", async () => {
  const openPath = vi.fn().mockResolvedValue("");
  const result = await openDesktopExternalFile(
    { name: "report.docx", bytes: new Uint8Array([1]) },
    dependencies({ writeFile: vi.fn().mockRejectedValue(new Error("disk full")), openPath }),
  );

  expect(result).toEqual({ ok: false, code: "write-failed" });
  expect(openPath).not.toHaveBeenCalled();
});

test("reports an open failure when the shell has no handler for the file", async () => {
  await expect(
    openDesktopExternalFile(
      { name: "report.docx", bytes: new Uint8Array([1]) },
      dependencies({ openPath: vi.fn().mockResolvedValue("No application is associated with the file.") }),
    ),
  ).resolves.toEqual({ ok: false, code: "open-failed" });

  await expect(
    openDesktopExternalFile(
      { name: "report.docx", bytes: new Uint8Array([1]) },
      dependencies({ openPath: vi.fn().mockRejectedValue(new Error("shell unavailable")) }),
    ),
  ).resolves.toEqual({ ok: false, code: "open-failed" });
});
