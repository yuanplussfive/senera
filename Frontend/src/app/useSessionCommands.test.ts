import { describe, expect, it } from "vitest";
import {
  normalizeSessionTitle,
  readUniqueSessionIds,
} from "./useSessionCommands";

describe("readUniqueSessionIds", () => {
  it("deduplicates session ids while preserving first-seen order", () => {
    expect(readUniqueSessionIds(["a", "b", "a", "c", "b"])).toEqual(["a", "b", "c"]);
  });

  it("drops empty ids", () => {
    expect(readUniqueSessionIds(["", "a", "", "b"])).toEqual(["a", "b"]);
  });
});

describe("normalizeSessionTitle", () => {
  it("trims valid titles", () => {
    expect(normalizeSessionTitle("  Project notes  ")).toBe("Project notes");
  });

  it("returns null for blank titles", () => {
    expect(normalizeSessionTitle("   ")).toBeNull();
  });
});
