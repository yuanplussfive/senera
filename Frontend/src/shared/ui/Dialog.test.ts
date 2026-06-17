import { describe, expect, it } from "vitest";
import { clampDialogDragOffset, readDialogDragBounds } from "./Dialog";

describe("Dialog drag bounds", () => {
  it("keeps dragged desktop dialogs inside the viewport padding", () => {
    const bounds = readDialogDragBounds({
      edgePadding: 12,
      rect: {
        left: 120,
        right: 520,
        top: 80,
        bottom: 380,
      },
      startOffset: { x: 0, y: 0 },
      viewportWidth: 800,
      viewportHeight: 600,
    });

    expect(bounds).toEqual({
      minX: -108,
      maxX: 268,
      minY: -68,
      maxY: 208,
    });
    expect(clampDialogDragOffset({ x: -500, y: 500 }, bounds)).toEqual({
      x: -108,
      y: 208,
    });
  });
});
