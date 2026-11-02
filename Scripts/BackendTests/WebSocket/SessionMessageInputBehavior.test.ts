import { describe, expect, it } from "vitest";
import { AgentWebSocketRequestSchema } from "../../../Source/AgentSystem/WebSocket/AgentWebSocketProtocol.js";

describe("structured attachment messages", () => {
  const message = { type: "session.message", sessionId: "session-media", input: "", approvalMode: "agent" };
  it("accepts actual attachments without inventing an objective text", () => {
    const parsed = AgentWebSocketRequestSchema.parse({
      ...message,
      attachments: [
        {
          resourceUri: "senera://resource/a1b2c3",
          name: "photo.png",
          mime: "image/png",
          size: 5,
          status: "uploaded",
        },
      ],
    });
    expect(parsed).toMatchObject({ input: "", attachments: [{ resourceUri: "senera://resource/a1b2c3" }] });
  });
  it("rejects empty and whitespace-only messages without attachments", () => {
    expect(AgentWebSocketRequestSchema.safeParse(message).success).toBe(false);
    expect(AgentWebSocketRequestSchema.safeParse({ ...message, input: "  ", attachments: [] }).success).toBe(false);
  });
});
