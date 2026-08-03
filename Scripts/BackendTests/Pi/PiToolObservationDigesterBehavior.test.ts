import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { describe, expect, test, vi } from "vitest";
import {
  AgentPiToolObservationDigester,
  type AgentPiToolObservationDigestModelClient,
} from "../../../Source/AgentSystem/Pi/AgentPiToolObservationDigester.js";
import {
  readAgentPiMessageTextContent,
  readAgentPiToolObservation,
} from "../../../Source/AgentSystem/Pi/AgentPiToolObservation.js";
import { normalizeAgentPiToolObservationDigest } from "../../../Source/AgentSystem/Pi/AgentPiToolObservationDigestPrompt.js";
import { compilePiToolObservation, piToolResultMessage } from "../Support/PiToolObservationFixtures.js";

describe("Pi tool observation semantic digester", () => {
  test("adds one grounded digest to a batch and reuses the session cache", async () => {
    const digestInputs: Array<Parameters<AgentPiToolObservationDigestModelClient["condenseToolObservations"]>[0]> = [];
    const condenseToolObservations: AgentPiToolObservationDigestModelClient["condenseToolObservations"] = vi.fn(
      async (input) => {
        digestInputs.push(input);
        return {
          entries: [
            { text: "The first search returned the requested value.", sources: ["call-a"] },
            { text: "The second search failed validation.", sources: ["call-b"] },
          ],
        };
      },
    );
    const session = new AgentPiToolObservationDigester({
      client: { condenseToolObservations },
      model: "test-model",
      contextWindowTokens: 4_096,
      outputReserveTokens: 1_024,
    }).createSession();
    const messages = [
      toolResultMessage("call-b", "failure", "second result".repeat(100)),
      toolResultMessage("call-a", "success", "first result".repeat(100)),
    ];

    const first = await session.enrich(messages, { objective: "find the value", targetTokens: 256 });
    const second = await session.enrich(messages, { objective: "find the value", targetTokens: 128 });
    const reversed = await session.enrich([...messages].reverse(), {
      objective: "find the value",
      targetTokens: 128,
    });

    expect(condenseToolObservations).toHaveBeenCalledTimes(1);
    expect(digestInputs[0]?.sources.map((source) => source.id)).toEqual(["call-a", "call-b"]);
    expect(readAgentPiMessageTextContent(first[1])).toContain("semantic_digest");
    expect(readAgentPiMessageTextContent(first[1])).toContain("[call-a]");
    expect(readAgentPiMessageTextContent(first[0])).not.toContain("semantic_digest");
    expect(second.map(readAgentPiMessageTextContent)).toEqual(first.map(readAgentPiMessageTextContent));
    expect(readAgentPiMessageTextContent(reversed[0])).toContain("semantic_digest");
  });

  test("rejects model-created source references before they enter agent context", () => {
    expect(() =>
      normalizeAgentPiToolObservationDigest(
        { entries: [{ text: "Unsupported fact", sources: ["invented-source"] }] },
        new Set(["call-a"]),
      ),
    ).toThrow("unknown sources");
  });

  test("preserves the source reference when a single digest entry exceeds its target", async () => {
    const session = new AgentPiToolObservationDigester({
      client: {
        condenseToolObservations: async () => ({
          entries: [{ text: "A long grounded fact ".repeat(1_000), sources: ["call-a"] }],
        }),
      },
      model: "test-model",
      contextWindowTokens: 4_096,
      outputReserveTokens: 1_024,
    }).createSession();

    const enriched = await session.enrich([toolResultMessage("call-a", "success", "source")], {
      targetTokens: 1,
    });
    const observation = readAgentPiToolObservation(readAgentPiMessageTextContent(enriched[0]));

    const detail = observation?.detail as Record<string, unknown> | undefined;
    expect(detail?.semantic_digest).toContain("[call-a]");
    expect(String(detail?.semantic_digest)).not.toContain("A long grounded fact ".repeat(100));
  });

  test("surfaces a cached model failure once without retrying the batch", async () => {
    const failure = new Error("digest unavailable");
    const condenseToolObservations = vi.fn(async () => Promise.reject(failure));
    const session = new AgentPiToolObservationDigester({
      client: { condenseToolObservations },
      model: "test-model",
      contextWindowTokens: 4_096,
      outputReserveTokens: 1_024,
    }).createSession();
    const messages = [toolResultMessage("call-a", "success", "source".repeat(100))];

    await expect(session.enrich(messages, { targetTokens: 128 })).rejects.toBe(failure);
    await expect(session.enrich(messages, { targetTokens: 256 })).resolves.toEqual(messages);
    expect(condenseToolObservations).toHaveBeenCalledTimes(1);
  });

  test("bounds retained digest outcomes by LRU identity", async () => {
    const condenseToolObservations: AgentPiToolObservationDigestModelClient["condenseToolObservations"] = vi.fn(
      async (input) => ({
        entries: [{ text: "grounded", sources: input.sources.map((source: { id: string }) => source.id) }],
      }),
    );
    const session = new AgentPiToolObservationDigester({
      client: { condenseToolObservations },
      model: "test-model",
      contextWindowTokens: 4_096,
      outputReserveTokens: 1_024,
      maxCachedDigests: 1,
    }).createSession();
    const request = { targetTokens: 128 };

    await session.enrich([toolResultMessage("call-a", "success", "first")], request);
    await session.enrich([toolResultMessage("call-b", "success", "second")], request);
    await session.enrich([toolResultMessage("call-a", "success", "first")], request);

    expect(condenseToolObservations).toHaveBeenCalledTimes(3);
  });

  test("rejects invalid digest cache capacity", () => {
    expect(() =>
      new AgentPiToolObservationDigester({
        client: { condenseToolObservations: async () => ({ entries: [] }) },
        model: "test-model",
        contextWindowTokens: 4_096,
        outputReserveTokens: 1_024,
        maxCachedDigests: -1,
      }).createSession(),
    ).toThrow(/maxCachedDigests/);
  });
});

function toolResultMessage(callId: string, status: string, result: string): AgentMessage {
  return piToolResultMessage(
    compilePiToolObservation({
      callId,
      toolName: `Tool-${callId}`,
      status,
      result: { text: result },
      artifact: { artifactUri: `senera://artifact/${callId}`, evidence: [], delta: [] },
    }),
  );
}
