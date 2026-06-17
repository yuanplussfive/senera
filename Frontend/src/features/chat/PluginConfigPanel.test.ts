import { describe, expect, it } from "vitest";
import { readNumberDraftCommitValue } from "./PluginConfigPanel";

describe("readNumberDraftCommitValue", () => {
  it("does not coerce empty or incomplete number drafts to zero", () => {
    expect(readNumberDraftCommitValue("")).toBeNull();
    expect(readNumberDraftCommitValue("-")).toBeNull();
    expect(readNumberDraftCommitValue("1.")).toBeNull();
    expect(readNumberDraftCommitValue("1e")).toBeNull();
    expect(readNumberDraftCommitValue("1e-")).toBeNull();
  });

  it("accepts finite number drafts once they are complete", () => {
    expect(readNumberDraftCommitValue("1.5")).toBe(1.5);
    expect(readNumberDraftCommitValue("-2")).toBe(-2);
    expect(readNumberDraftCommitValue("1e-3")).toBe(0.001);
  });
});
