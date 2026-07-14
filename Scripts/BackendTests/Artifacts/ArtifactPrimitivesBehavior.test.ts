import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  createAgentArtifactLocator,
  normalizeAgentArtifactUri,
  parseAgentArtifactUri,
} from "../../../Source/AgentSystem/Artifacts/AgentArtifactLocator.js";
import { redactArtifactSecrets } from "../../../Source/AgentSystem/Artifacts/AgentArtifactRedaction.js";
import {
  stableArtifactHash,
  stableArtifactStringify,
} from "../../../Source/AgentSystem/Artifacts/AgentArtifactStableJson.js";
import { ToolArtifactPolicySchema } from "../../../Source/AgentSystem/Schemas/PluginArtifactManifestSchema.js";

describe("artifact primitive contracts", () => {
  test("redacts nested key patterns and exact array paths without mutating input", () => {
    const input = {
      token: "root-secret",
      users: [
        { name: "first", credentials: { apiKey: "first-secret" } },
        { name: "second", credentials: { apiKey: "second-secret" } },
      ],
    };
    const policy = ToolArtifactPolicySchema.parse({
      Redact: {
        Keys: ["^(token|apiKey)$"],
        Paths: ["$.users[1].name"],
      },
    });

    expect(redactArtifactSecrets(input, policy)).toEqual({
      token: "[REDACTED]",
      users: [
        { name: "first", credentials: { apiKey: "[REDACTED]" } },
        { name: "[REDACTED]", credentials: { apiKey: "[REDACTED]" } },
      ],
    });
    expect(input.users[1]?.name).toBe("second");
  });

  test("rejects invalid redaction regular expressions during manifest validation", () => {
    expect(() => ToolArtifactPolicySchema.parse({ Redact: { Keys: ["["] } })).toThrow(/必须是有效的正则表达式/);
  });

  test("produces stable JSON and hashes independent of object key order", () => {
    const left = { nested: { z: 1, a: 2 }, value: true };
    const right = { value: true, nested: { a: 2, z: 1 } };

    expect(stableArtifactStringify(left)).toBe('{"nested":{"a":2,"z":1},"value":true}');
    expect(stableArtifactHash(left)).toBe(stableArtifactHash(right));
  });

  test("normalizes safe artifact locations and rejects configured root traversal", () => {
    const locator = createAgentArtifactLocator({
      workspaceRoot: path.resolve("workspace"),
      requestId: "Request / unsafe",
      step: 2,
      callIndex: 3,
      toolName: "Tool Name",
      argsHash: "args",
      resultHash: "result",
    });

    expect(locator.relativeDir).toContain("request-unsafe/steps/002/calls/003-tool-name-");
    expect(parseAgentArtifactUri(locator.artifactUri)).toBe(locator.artifactId);
    expect(normalizeAgentArtifactUri(`urn:senera:artifact:${locator.artifactId}`)).toBe(locator.artifactUri);
    expect(() =>
      createAgentArtifactLocator({
        workspaceRoot: path.resolve("workspace"),
        rootDir: "../outside",
        step: 0,
        toolName: "tool",
        argsHash: "a",
        resultHash: "b",
      }),
    ).toThrow(/artifact 根目录无效/);
  });
});
