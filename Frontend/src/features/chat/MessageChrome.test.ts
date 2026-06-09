import { describe, expect, it } from "vitest";
import { readUserInitial } from "./MessageChrome";

describe("readUserInitial", () => {
  it("uses the trimmed first character as an uppercase avatar fallback", () => {
    expect(readUserInitial(" smoke user ")).toBe("S");
  });

  it("keeps non-latin initials intact", () => {
    expect(readUserInitial(" 王琦 ")).toBe("王");
  });

  it("returns an empty fallback for blank or missing names", () => {
    expect(readUserInitial("   ")).toBe("");
    expect(readUserInitial()).toBe("");
  });
});
