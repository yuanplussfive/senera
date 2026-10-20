// @vitest-environment jsdom

import { describe, expect, test } from "vitest";
import { formatFileSize } from "../../../Frontend/src/lib/util.ts";

describe("file size presentation", () => {
  test("keeps small values exact", () => {
    expect(formatFileSize(512)).toBe("512B");
    expect(formatFileSize(1023)).toBe("1023B");
    expect(formatFileSize(1024)).toBe("1.0KB");
    expect(formatFileSize(897838)).toBe("877KB");
  });

  test("switches to gigabytes once megabytes stop being readable", () => {
    expect(formatFileSize(86799085)).toBe("83MB");
    expect(formatFileSize(81267546)).toBe("78MB");
    expect(formatFileSize(2281579884)).toBe("2.1GB");
    expect(formatFileSize(10 * 1024 * 1024 * 1024)).toBe("10GB");
  });
});
