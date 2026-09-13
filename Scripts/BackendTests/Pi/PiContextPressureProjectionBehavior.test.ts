import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { describe, expect, test } from "vitest";
import { projectAgentPiContextForPressure } from "../../../Source/AgentSystem/Pi/AgentPiContextPressureProjection.js";
import { compilePiToolObservation, piToolResultMessage } from "../Support/PiToolObservationFixtures.js";

describe("Pi context pressure projection", () => {
  test("projects old Artifact-backed results while keeping the active turn intact", () => {
    const old = piToolResultMessage(
      {
        ...compilePiToolObservation({
          result: { payload: "result-".repeat(1_000) },
          arguments: { input: "argument-".repeat(1_000) },
          process: { stdout: "stdout-".repeat(1_000) },
        }),
        observation_view: {
          ...compilePiToolObservation().observation_view,
          complete: false,
          artifact_uri: "senera://artifact/old",
        },
      },
      { toolCallId: "old-call", toolName: "OldTool" },
    );
    const currentUser = { role: "user", content: "Continue from here.", timestamp: 2 } as AgentMessage;
    const currentTool = piToolResultMessage(
      compilePiToolObservation({ result: { payload: "keep this current result" } }),
      { toolCallId: "current-call", toolName: "CurrentTool" },
    );

    const result = projectAgentPiContextForPressure([old, currentUser, currentTool], {
      model: "test-model",
      contextWindowTokens: 1_000,
      outputReserveTokens: 100,
      keepRecentTokens: 100,
    });

    expect(result.projectedMessages).toBe(1);
    expect(result.reclaimedTokens).toBeGreaterThan(0);
    const projectedOld = JSON.stringify(result.messages[0]);
    expect(projectedOld).toContain("senera://artifact/old");
    expect(projectedOld).not.toContain("result-result-");
    expect(result.messages[1]).toBe(currentUser);
    expect(result.messages[2]).toBe(currentTool);
  });

  test("does not project before the pressure band or without an active user boundary", () => {
    const message = piToolResultMessage(compilePiToolObservation({ result: { payload: "result-".repeat(1_000) } }), {
      toolCallId: "call-1",
      toolName: "Tool",
    });
    const options = {
      model: "test-model",
      contextWindowTokens: 100_000,
      outputReserveTokens: 1_000,
      keepRecentTokens: 1_000,
    };
    expect(projectAgentPiContextForPressure([message], options).projectedMessages).toBe(0);
    expect(
      projectAgentPiContextForPressure([message, { role: "user", content: "next" } as AgentMessage], options)
        .projectedMessages,
    ).toBe(0);
  });

  test("uses the last complete provider measurement when the message estimate omits stable prefixes", () => {
    const observation = compilePiToolObservation({ result: { payload: "large historical result" } });
    const message = piToolResultMessage(
      {
        ...observation,
        observation_view: {
          ...observation.observation_view,
          complete: false,
          artifact_uri: "senera://artifact/observed",
        },
      },
      { toolCallId: "call-observed", toolName: "ObservedTool" },
    );
    const result = projectAgentPiContextForPressure([message, { role: "user", content: "next" } as AgentMessage], {
      model: "test-model",
      contextWindowTokens: 1_000,
      outputReserveTokens: 100,
      keepRecentTokens: 100,
      observedProviderTokens: 900,
    });
    expect(result.tokensBefore).toBeGreaterThan(result.triggerTokens);
    expect(result.observedProviderTokens).toBe(900);
    expect(result.projectedMessages).toBe(1);
  });

  test("leaves incomplete results without a retrieval coordinate unchanged", () => {
    const observation = compilePiToolObservation();
    const message = piToolResultMessage(
      {
        ...observation,
        observation_view: { ...observation.observation_view, complete: false, artifact_uri: undefined },
      },
      { toolCallId: "call-1", toolName: "Tool" },
    );
    const result = projectAgentPiContextForPressure([message, { role: "user", content: "next" } as AgentMessage], {
      model: "test-model",
      contextWindowTokens: 100,
      outputReserveTokens: 10,
      keepRecentTokens: 10,
    });
    expect(result.projectedMessages).toBe(0);
  });

  test("drops historical image payloads with the Artifact-backed text view", () => {
    const observation = compilePiToolObservation();
    const message = {
      ...piToolResultMessage(
        { ...observation, observation_view: { ...observation.observation_view, complete: false } },
        { toolCallId: "call-image", toolName: "ImageTool" },
      ),
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            ...observation,
            observation_view: { ...observation.observation_view, complete: false },
          }),
        },
        { type: "image" as const, data: "a".repeat(10_000), mimeType: "image/png" },
      ],
    } as AgentMessage;
    const result = projectAgentPiContextForPressure([message, { role: "user", content: "next" } as AgentMessage], {
      model: "test-model",
      contextWindowTokens: 100,
      outputReserveTokens: 10,
      keepRecentTokens: 10,
    });
    expect(result.projectedMessages).toBe(1);
    expect(result.messages[0]).toMatchObject({ content: [{ type: "text" }] });
  });
});
