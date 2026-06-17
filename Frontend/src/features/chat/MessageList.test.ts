import { describe, expect, it } from "vitest";
import { readMessageListItemKey } from "./MessageList";
import type { ChatMessage } from "../../store/sessionStore";

describe("readMessageListItemKey", () => {
  it("returns a stable placeholder key when Virtuoso has not supplied item data yet", () => {
    expect(readMessageListItemKey(undefined, 12)).toBe("__placeholder__:12");
  });

  it("returns the message id for regular message items", () => {
    const message: ChatMessage = {
      id: "message-1",
      role: "assistant",
      content: "Done",
      createdAt: "2026-06-07T00:00:00.000Z",
    };

    expect(readMessageListItemKey(message)).toBe("message-1");
  });
});
