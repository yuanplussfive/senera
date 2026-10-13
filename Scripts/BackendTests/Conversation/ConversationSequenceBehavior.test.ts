import { describe, expect, test } from "vitest";
import { AgentConversationPolicy } from "../../../Source/AgentSystem/Conversation/AgentConversationPolicy.js";
import { AgentConversationProjector } from "../../../Source/AgentSystem/Conversation/AgentConversationProjector.js";

describe("Conversation message formatting", () => {
  test("uses the structural XML attachment projection for queued user input", () => {
    const projector = new AgentConversationProjector();
    const current = projector.projectUserInput("request-upload", "Inspect this file", timestamp(1), undefined, [
      {
        resourceUri: "senera://resource/upload-a",
        name: "report.txt",
        mime: "text/plain",
        size: 12,
        status: "uploaded",
      },
    ]);

    const projection = new AgentConversationPolicy().renderCurrentUserMessage(current);

    expect(projection).toContain("<current_user_message>");
    expect(projection).toContain("<resourceUri>senera://resource/upload-a</resourceUri>");
    expect(projection).not.toContain('"attachments"');
  });

  test("projects a request-local absolute attachment path before its URI fallback", () => {
    const projector = new AgentConversationProjector();
    const current = projector.projectUserInput("request-upload", "Inspect this file", timestamp(1), undefined, [
      {
        resourceUri: "senera://resource/upload-a",
        name: "report.txt",
        mime: "text/plain",
        size: 12,
        status: "uploaded",
      },
    ]);

    const projection = new AgentConversationPolicy().renderCurrentUserMessage(current, undefined, [
      {
        resourceUri: "senera://resource/upload-a",
        filePath: "E:\\senera\\.senera\\uploads\\upload-a\\original.txt",
      },
    ]);

    expect(projection).toContain("<localPath>E:\\senera\\.senera\\uploads\\upload-a\\original.txt</localPath>");
    expect(projection.indexOf("<localPath>")).toBeLessThan(projection.indexOf("<resourceUri>"));
  });
});

function timestamp(offset: number): string {
  return new Date(Date.UTC(2026, 7, 2, 0, 0, offset)).toISOString();
}
