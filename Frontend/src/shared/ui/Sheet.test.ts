import { describe, expect, it } from "vitest";
import { shouldMountSheetChildren, sheetOverlayClassName } from "./Sheet";

describe("Sheet", () => {
  it("keeps drawer overlay compositor-friendly", () => {
    expect(sheetOverlayClassName).not.toContain("backdrop-blur");
    expect(sheetOverlayClassName).toContain("will-change");
  });

  it("can defer heavy drawer children until the sheet shell is ready", () => {
    expect(shouldMountSheetChildren({
      dataState: "closed",
      deferContentMount: false,
      deferredContentReady: true,
    })).toBe(false);

    expect(shouldMountSheetChildren({
      dataState: "open",
      deferContentMount: false,
      deferredContentReady: false,
    })).toBe(true);

    expect(shouldMountSheetChildren({
      dataState: "open",
      deferContentMount: true,
      deferredContentReady: false,
    })).toBe(false);

    expect(shouldMountSheetChildren({
      dataState: "open",
      deferContentMount: true,
      deferredContentReady: true,
    })).toBe(true);
  });
});
