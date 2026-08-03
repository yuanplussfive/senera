import { describe, expect, test } from "vitest";
import { collectArtifactEvidence } from "../../../Source/AgentSystem/Artifacts/AgentArtifactEvidenceProjection.js";
import type { ToolArtifactPolicyManifest } from "../../../Source/AgentSystem/Types/AgentToolContractTypes.js";
import { InMemoryAgentMemorySourceRepository } from "../../../Source/AgentSystem/Memory/AgentMemorySourceRepository.js";
import { AgentConversationEntryKinds } from "../../../Source/AgentSystem/Conversation/AgentConversation.js";
import { AgentToolSuccessOutcome } from "../../../Source/AgentSystem/ToolRuntime/AgentToolResultOutcome.js";

describe("Artifact evidence source projection", () => {
  test("projects source artifact URI and hydrated refs from declarative slots", () => {
    const policy: ToolArtifactPolicyManifest = {
      Evidence: [
        {
          Kind: "artifact_memory",
          Records: "$.artifacts.item[*]",
          Slots: {
            artifactUri: "$.artifactUri",
            status: "$.status",
            loadedRefs: "$.memories.item[*].ref",
          },
          Identity: { Parts: ["artifactUri", "status"] },
          Presentation: {
            Locator: "{{ artifactUri }}",
            Display: "{{ status }} {{ artifactUri }}",
            Label: "{{ artifactUri }}",
            Source: "artifact memory",
          },
          ModelProjection: { Slots: ["artifactUri", "status", "loadedRefs"] },
          PlannerMemory: {
            Facts: ["status", "loadedRefs"],
            ArtifactUri: "artifactUri",
            ArtifactRefsSlot: "loadedRefs",
          },
          Projection: {
            SummaryTemplate: "{{ evidence[0].slots.status }}",
            ArtifactTemplate: "{{ evidence[0].slots.artifactUri }}",
          },
          Confidence: 1,
        },
      ],
    };

    const [evidence] = collectArtifactEvidence(
      {
        artifacts: {
          item: [
            {
              artifactUri: "senera://artifact/art_0123456789abcdef01234567",
              status: "found",
              memories: { item: [{ ref: "raw" }, { ref: "evidence" }, { ref: "raw" }] },
            },
          ],
        },
      },
      policy,
      "art_trace",
    );

    expect(evidence.plannerMemory).toEqual({
      artifactUri: "senera://artifact/art_0123456789abcdef01234567",
      artifactRefs: ["raw", "evidence"],
      facts: [
        { name: "status", value: "found" },
        { name: "loadedRefs", value: '["raw","evidence","raw"]' },
      ],
    });

    const recorded = new InMemoryAgentMemorySourceRepository().recordCompletedTurn({
      sessionId: "session-1",
      requestId: "request-1",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:01.000Z",
      userEntry: {
        id: "request-1:user",
        requestId: "request-1",
        timestamp: "2026-01-01T00:00:00.000Z",
        kind: AgentConversationEntryKinds.UserMessage,
        content: "Read the artifact.",
      },
      assistantEntry: {
        id: "request-1:assistant",
        requestId: "request-1",
        timestamp: "2026-01-01T00:00:01.000Z",
        kind: AgentConversationEntryKinds.AssistantDecision,
        xml: "Artifact loaded.",
      },
      terminal: { kind: "FinalAnswer", content: "Artifact loaded." },
      conversationEntries: [],
      executedTools: [
        {
          callId: "call-1",
          name: "ArtifactMemoryReadTool",
          arguments: {},
          process: { exitCode: 0, signal: null, stdout: "", stderr: "" },
          result: {},
          outcome: AgentToolSuccessOutcome,
          artifact: {
            artifactId: "art_trace",
            artifactUri: "senera://artifact/art_89abcdef0123456701234567",
            artifactPath: ".senera/artifacts/trace",
            relativePath: "trace",
            manifestPath: ".senera/artifacts/trace/manifest.json",
            files: {},
            summary: "",
            evidence: [evidence],
            delta: [],
          },
        },
      ],
    });
    expect(recorded.sources.find((source) => source.sourceKind === "tool_evidence")).toMatchObject({
      artifactUri: "senera://artifact/art_0123456789abcdef01234567",
      metadata: {
        callId: "call-1",
        evidence: {
          artifactRefs: ["raw", "evidence"],
        },
      },
    });
  });
});
