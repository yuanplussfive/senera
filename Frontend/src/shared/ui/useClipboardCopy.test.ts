import { describe, expect, it, vi } from "vitest";
import { writeClipboardText } from "./useClipboardCopy";

describe("writeClipboardText", () => {
  it("writes text through the provided clipboard writer", async () => {
    const writeText = vi.fn(async (_text: string) => undefined);

    await writeClipboardText("hello", { writeText });

    expect(writeText).toHaveBeenCalledWith("hello");
  });

  it("propagates clipboard failures to the caller", async () => {
    const writeText = vi.fn(async (_text: string) => {
      throw new Error("clipboard denied");
    });

    await expect(writeClipboardText("hello", { writeText })).rejects.toThrow("clipboard denied");
  });
});
