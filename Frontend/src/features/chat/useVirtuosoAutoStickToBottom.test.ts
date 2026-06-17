import { describe, expect, it } from "vitest";
import { shouldResumeAutoStickToBottom } from "./useVirtuosoAutoStickToBottom";

describe("shouldResumeAutoStickToBottom", () => {
  it("keeps auto-follow paused after the user scrolls away from streaming output", () => {
    expect(shouldResumeAutoStickToBottom({
      atBottom: true,
      hasScrollAwayIntent: true,
      hasScrollTowardBottomIntent: false,
      isScrollbarDragging: false,
    })).toBe(false);
  });

  it("resumes auto-follow when the user explicitly returns to the bottom", () => {
    expect(shouldResumeAutoStickToBottom({
      atBottom: true,
      hasScrollAwayIntent: true,
      hasScrollTowardBottomIntent: true,
      isScrollbarDragging: false,
    })).toBe(true);
  });

  it("does not resume while the scrollbar thumb is still being dragged", () => {
    expect(shouldResumeAutoStickToBottom({
      atBottom: true,
      hasScrollAwayIntent: true,
      hasScrollTowardBottomIntent: true,
      isScrollbarDragging: true,
    })).toBe(false);
  });
});
