import { describe, expect, it } from "vitest";
import { computeSkeletonRowCount } from "../../../Frontend/src/features/chat/ConversationSkeleton.tsx";

describe("conversation skeleton row budget", () => {
  it("keeps adding rows until the track height is covered", () => {
    const rowHeights = [68, 96];
    const available = 668;

    const count = computeSkeletonRowCount({ available, rowHeights, maxRows: 40 });
    const covered = Array.from({ length: count }, (_, index) => rowHeights[index % rowHeights.length]).reduce(
      (total, height) => total + height,
      0,
    );
    const coveredWithoutLast = covered - rowHeights[(count - 1) % rowHeights.length];

    expect(covered).toBeGreaterThanOrEqual(available);
    expect(coveredWithoutLast).toBeLessThan(available);
  });

  it("stops at the row cap instead of measuring an unbounded track", () => {
    expect(computeSkeletonRowCount({ available: 100_000, rowHeights: [68, 96], maxRows: 40 })).toBe(40);
  });

  it("falls back to two rows when the track has no layout yet", () => {
    expect(computeSkeletonRowCount({ available: 0, rowHeights: [68, 96], maxRows: 40 })).toBe(2);
    expect(computeSkeletonRowCount({ available: 668, rowHeights: [0, 0], maxRows: 40 })).toBe(2);
  });
});
