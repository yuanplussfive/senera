import { expect, test } from "vitest";
import { shouldMountSheetChildren } from "../../../Frontend/src/shared/ui/Sheet.tsx";

test("sheet children wait for deferred opening and remain mounted through closing", () => {
  expect(shouldMountSheetChildren({ dataState: "open", deferContentMount: true, contentReady: false })).toBe(false);
  expect(shouldMountSheetChildren({ dataState: "open", deferContentMount: true, contentReady: true })).toBe(true);
  expect(shouldMountSheetChildren({ dataState: "closed", deferContentMount: true, contentReady: true })).toBe(true);
  expect(shouldMountSheetChildren({ dataState: "closed", deferContentMount: true, contentReady: false })).toBe(false);
});
