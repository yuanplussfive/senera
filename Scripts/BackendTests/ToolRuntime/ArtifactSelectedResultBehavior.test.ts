import { describe, expect, test, vi } from "vitest";
import { AgentTokenProjector } from "../../../Source/AgentSystem/Text/AgentTokenProjection.js";
import {
  AgentToolResultObservationCompressor,
  type AgentToolResultObservationCompressorOptions,
} from "../../../Source/AgentSystem/ToolRuntime/AgentToolResultObservationCompressor.js";
import { ArtifactReadResultProtocol } from "../../../Source/AgentSystem/Memory/AgentArtifactMemoryTypes.js";
import { AgentToolSelectedContentCompressor } from "../../../Source/AgentSystem/ToolRuntime/AgentToolSelectedContentCompressor.js";
import { AgentArtifactResultView } from "../../../Source/AgentSystem/Artifacts/AgentArtifactResultView.js";

const model = "gpt-4o";
const tokens = new AgentTokenProjector(model);
const uri = "senera://resource/abc123";

describe("selected Artifact content compression", () => {
  test("labels structural truncation explicitly when mechanical content reduction still cannot fit the tree", async () => {
    const value = Object.fromEntries(Array.from({ length: 100 }, (_, index) => [`field${index}`, index]));
    const compressor = new AgentToolSelectedContentCompressor({
      model,
      summarize: async () => {
        throw new Error("summary unavailable");
      },
    });
    const selected = await compressor.compress(value, {
      systemPrompt: "Summarize accurately.",
      currentUserMessage: "Inspect fields.",
      toolName: "Reader",
      arguments: {},
      evidenceUris: [],
      tokenBudget: 30,
    });
    expect(selected).toMatchObject({
      method: "truncated",
      representation: "excerpt",
      complete: false,
      reason: "llm_summary_failed",
    });
    expect(tokens.countJson(selected.value)).toBeLessThanOrEqual(30);
    expect(Object.keys(value)).toHaveLength(100);
  });
  test("summarizes only oversized fields and retains exact neighbors and missing selections", async () => {
    const large = "selected source detail ".repeat(4_000);
    const summarize = vi.fn(async (request) => {
      expect(request.feedback).toBe(large);
      expect(request.artifactUri).toBe(uri);
      expect(request.tokenBudget).toBeGreaterThan(350);
      return "Deployment completed; revision rev-42 is active.";
    });
    const observation = await compress(large, summarize);
    const rendered = JSON.stringify(observation.detail.result);
    expect(rendered).toContain('"representation":"summary"');
    expect(rendered).toContain('"method":"llm"');
    expect(rendered).toContain("rev-42");
    expect(rendered).toContain('"value":42');
    expect(rendered).toContain('"status":"not_found"');
    expect(summarize).toHaveBeenCalledOnce();
    expect(tokens.countJson(observation)).toBeLessThanOrEqual(1_000);
  });

  test("provider rejection reduces content mechanically without changing the execution outcome", async () => {
    const observation = await compress("diagnostic information\n".repeat(2_000), async () => {
      throw new Error("content_policy_violation");
    });
    expect(observation.status).toBe("success");
    expect(observation.execution_status).toBe("completed");
    expect(observation.error).toBeUndefined();
    expect(JSON.stringify(observation.detail.result)).toContain('"reason":"llm_summary_failed"');
    expect(JSON.stringify(observation.detail.result)).toContain('"complete":false');
    expect(tokens.countJson(observation)).toBeLessThanOrEqual(1_000);
  }, 30_000);

  test("cancellation is propagated", async () => {
    const controller = new AbortController();
    const summarize = async () => {
      controller.abort();
      throw new Error("cancelled");
    };
    await expect(compress("detail ".repeat(3_000), summarize, controller.signal)).rejects.toThrow();
  });

  test("a successful summary arriving after cancellation is discarded", async () => {
    const controller = new AbortController();
    await expect(
      compress(
        "detail ".repeat(3_000),
        async () => {
          controller.abort();
          return "late summary";
        },
        controller.signal,
      ),
    ).rejects.toThrow();
  });

  test("structure reads are rebudgeted without summarizing or inventing new source paths", async () => {
    const source = {
      count: 300,
      entries: Array.from({ length: 300 }, (_, id) => ({ id, body: "source details ".repeat(40) })),
    };
    const content = { representation: "structure", ...new AgentArtifactResultView(model).structure(source, 2_000) };
    const result = {
      type: ArtifactReadResultProtocol,
      artifacts: {
        item: [
          {
            requestedUri: uri,
            artifactUri: uri,
            artifactId: "abc123",
            status: "found",
            view: "structure",
            part: "result",
            message: "Artifact structure view loaded.",
            content,
          },
        ],
      },
    };
    const summarize = vi.fn(async () => "should not run");
    const observation = await compress("", summarize, undefined, { result, budget: 700 });
    expect(observation.detail.result).toMatchObject({
      artifacts: {
        item: [
          { content: { representation: "structure", complete: false, outline: { path: "", fields: { count: 300 } } } },
        ],
      },
    });
    expect(tokens.countJson(observation)).toBeLessThanOrEqual(700);
    expect(summarize).not.toHaveBeenCalled();
    expect(JSON.stringify(observation)).not.toContain('"path":"/fields');
  });

  test("rebudgeting an exact nested structure preserves its original source pointer", async () => {
    const value = { id: 42, body: "nested source details ".repeat(300) };
    const result = {
      type: ArtifactReadResultProtocol,
      artifacts: {
        item: [
          {
            requestedUri: uri,
            artifactUri: uri,
            artifactId: "abc123",
            status: "found",
            view: "structure",
            part: "result",
            message: "Artifact structure view loaded.",
            content: {
              selections: [{ path: "/rows/0", status: "found", representation: "structure", value, complete: true }],
            },
          },
        ],
      },
    };
    const summarize = vi.fn(async () => "should not run");
    const observation = await compress("", summarize, undefined, { result, budget: 700 });
    expect(observation.detail.result).toMatchObject({
      artifacts: {
        item: [
          {
            content: {
              selections: [
                {
                  path: "/rows/0",
                  representation: "structure",
                  complete: false,
                  value: { path: "/rows/0", fields: { id: 42, body: { path: "/rows/0/body" } } },
                },
              ],
            },
          },
        ],
      },
    });
    expect(tokens.countJson(observation)).toBeLessThanOrEqual(700);
    expect(summarize).not.toHaveBeenCalled();
  });
});

function compress(
  value: string,
  summarize: AgentToolResultObservationCompressorOptions["summarize"],
  signal?: AbortSignal,
  settings: { readonly result?: unknown; readonly budget?: number } = {},
) {
  return new AgentToolResultObservationCompressor({ model, summarize }).compress({
    toolName: "Reader",
    status: "success",
    executionStatus: "completed",
    outputAvailability: "complete",
    arguments: {},
    process: undefined,
    outcome: undefined,
    result: settings.result ?? {
      type: ArtifactReadResultProtocol,
      artifacts: {
        item: [
          {
            requestedUri: uri,
            artifactUri: uri,
            artifactId: "abc123",
            status: "found",
            view: "selected",
            part: "result",
            message: "Artifact selected view loaded.",
            content: {
              selections: [
                { path: "/body", status: "found", value, representation: "original", complete: true },
                { path: "/count", status: "found", value: 42, representation: "original", complete: true },
                { path: "/absent", status: "not_found", message: "The selected field does not exist." },
              ],
            },
          },
        ],
      },
    },
    systemPrompt: "Answer using verified results.",
    currentUserMessage: "Find the deployment outcome.",
    observationBudgetTokens: settings.budget ?? 1_000,
    signal,
  });
}
