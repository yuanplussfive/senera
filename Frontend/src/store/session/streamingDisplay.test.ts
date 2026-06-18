import { describe, expect, it } from "vitest";
import {
  advanceStreamingDisplayText,
  hasStreamingDisplayPending,
} from "./streamingDisplay";

describe("streamingDisplay", () => {
  it("advances display text toward the target without mutating the target", () => {
    const first = advanceStreamingDisplayText({
      displayText: "",
      targetText: "abcdef",
    }, "full");

    expect(first.displayText.length).toBeGreaterThan(0);
    expect(first.displayText.length).toBeLessThan("abcdef".length);
    expect(first.targetText).toBe("abcdef");
    expect(first.pending).toBe(true);
  });

  it("syncs immediately when motion is disabled", () => {
    const next = advanceStreamingDisplayText({
      displayText: "",
      targetText: "完整文本",
    }, "none");

    expect(next.displayText).toBe("完整文本");
    expect(next.pending).toBe(false);
  });

  it("keeps emoji code points intact while advancing", () => {
    const next = advanceStreamingDisplayText({
      displayText: "",
      targetText: "A😊B",
    }, "full");

    expect(next.displayText).toBe("A😊");
    expect(hasStreamingDisplayPending(next)).toBe(true);
  });
});
