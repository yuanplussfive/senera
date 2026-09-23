import { describe, expect, test } from "vitest";
import { AgentToolContentPolicyDispatcher } from "../../../Source/AgentSystem/ToolRuntime/AgentToolContentPolicyDispatcher.js";
import { AgentToolContentPolicyKinds } from "../../../Source/AgentSystem/Types/AgentToolContentPolicyTypes.js";
import { AgentToolContentPolicySchema } from "../../../Source/AgentSystem/Schemas/AgentToolContentPolicySchema.js";
import { projectAgentToolResultForHistory } from "../../../Source/AgentSystem/Types/ToolRuntimeTypes.js";
import { AgentToolSuccessOutcome } from "../../../Source/AgentSystem/ToolRuntime/AgentToolResultOutcome.js";

describe("AgentToolContentPolicyDispatcher", () => {
  test("applies bounded prose deduplication only to declared targets", () => {
    const value = {
      content: [
        "正文段落。",
        "\n\n正文段落。",
        "```ts\nconst value = 1;\n```",
        "```ts\nconst value = 1;\n```",
        "https://example.com/reference",
      ].join("\n\n"),
      metadata: "正文段落。\n\n正文段落。",
    };

    const projection = new AgentToolContentPolicyDispatcher().project({
      value,
      policy: {
        ownership: "host",
        kind: AgentToolContentPolicyKinds.WebReadable,
        representation: "markdown",
        compression: "bounded",
        deduplication: "prose-only",
        targets: ["/content"],
        preserve: ["code", "urls"],
      },
    });

    expect((projection.value as typeof value).content.match(/正文段落。/gu)).toHaveLength(1);
    expect((projection.value as typeof value).content.match(/const value = 1;/gu)).toHaveLength(2);
    expect((projection.value as typeof value).content).toContain("https://example.com/reference");
    expect((projection.value as typeof value).metadata).toBe(value.metadata);
    expect(projection.stats.removedCharacters).toBeGreaterThan(0);
    expect(projection.reason).toBe("applied");
  });

  test("never processes tool-owned content a second time", () => {
    const value = { content: "already extracted\n\nalready extracted" };
    const projection = new AgentToolContentPolicyDispatcher().project({
      value,
      policy: {
        ownership: "tool",
        kind: AgentToolContentPolicyKinds.WebReadable,
        representation: "markdown",
        compression: "none",
        deduplication: "none",
      },
    });

    expect(projection.value).toBe(value);
    expect(projection.reason).toBe("tool_owned");
    expect(projection.stats.removedCharacters).toBe(0);
  });

  test("leaves execution output opaque for the host while tokenjuice owns its digest", () => {
    const value = { stdout: "same\nsame", stderr: "warning" };
    const projection = new AgentToolContentPolicyDispatcher().project({
      value,
      policy: {
        ownership: "tool",
        kind: AgentToolContentPolicyKinds.Execution,
        representation: "preserve",
        compression: "none",
        deduplication: "none",
      },
    });

    expect(projection.value).toBe(value);
    expect(projection.reason).toBe("tool_owned");
  });

  test("rejects a host policy that would double-process tool-owned execution output", () => {
    const parsed = AgentToolContentPolicySchema.safeParse({
      ownership: "tool",
      kind: AgentToolContentPolicyKinds.Execution,
      representation: "preserve",
      compression: "bounded",
      deduplication: "none",
    });

    expect(parsed.success).toBe(false);
    expect(parsed.success ? [] : parsed.error.issues.map((issue) => issue.path.join("."))).toContain("compression");
  });

  test("falls back to the original value when an optional processor fails", () => {
    const value = { content: "keep the complete tool result" };
    const projection = new AgentToolContentPolicyDispatcher(
      new Map([
        [
          AgentToolContentPolicyKinds.WebReadable,
          () => {
            throw new Error("optional processor unavailable");
          },
        ],
      ]),
    ).project({
      value,
      policy: {
        ownership: "host",
        kind: AgentToolContentPolicyKinds.WebReadable,
        representation: "markdown",
        compression: "bounded",
        deduplication: "prose-only",
      },
    });

    expect(projection.value).toBe(value);
    expect(projection.reason).toBe("opaque");
    expect(projection.stats.removedCharacters).toBe(0);
  });

  test("keeps the content-policy view out of turn history", () => {
    const result = {
      callId: "call-1",
      name: "ExampleTool",
      arguments: {},
      process: { exitCode: 0, signal: null, stdout: "", stderr: "" },
      result: { content: "complete" },
      observationResult: { content: "projected" },
      outcome: AgentToolSuccessOutcome,
    };

    const history = projectAgentToolResultForHistory(result);
    expect(history).not.toHaveProperty("observationResult");
    expect(result).toHaveProperty("observationResult");
  });
});
