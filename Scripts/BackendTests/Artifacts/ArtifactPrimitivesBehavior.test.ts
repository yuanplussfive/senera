import { afterEach, describe, expect, test } from "vitest";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";
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
import { ToolArtifactPolicySchema } from "../../../Source/AgentSystem/Schemas/AgentArtifactContractSchema.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) removeDirectory(root);
});

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

  test("accepts only an explicit writer receipt contract for workspace provenance", () => {
    expect(
      ToolArtifactPolicySchema.parse({
        Workspace: {
          Capture: "mutation-receipt",
          MaxFileBytes: 1024,
          CaptureContent: "text",
          PatchContextLines: 0,
        },
      }),
    ).toMatchObject({ Workspace: { Capture: "mutation-receipt" } });

    expect(() =>
      ToolArtifactPolicySchema.parse({
        Workspace: {
          Capture: "inferred",
          PatchContextLines: 0,
        },
      }),
    ).toThrow();

    expect(() =>
      ToolArtifactPolicySchema.parse({
        Workspace: {
          Capture: "mutation-receipt",
          CaptureContent: "text",
          PatchContextLines: 0,
        },
      }),
    ).toThrow();
  });

  test("produces stable JSON and hashes independent of object key order", () => {
    const left = { nested: { z: 1, a: 2 }, value: true };
    const right = { value: true, nested: { a: 2, z: 1 } };

    expect(stableArtifactStringify(left)).toBe('{"nested":{"a":2,"z":1},"value":true}');
    expect(stableArtifactHash(left)).toBe(stableArtifactHash(right));
  });

  test("normalizes safe artifact locations and rejects configured root traversal", () => {
    const workspaceRoot = createTemporaryDirectory("senera-artifact-locator");
    roots.push(workspaceRoot);
    const locator = createAgentArtifactLocator({
      workspaceRoot,
      requestId: "Request / unsafe",
      step: 2,
      callIndex: 3,
      callId: "call-3",
      toolName: "Tool Name",
      argsHash: "args",
      resultHash: "result",
    });

    expect(locator.relativeDir).toContain("request-unsafe/steps/002/calls/003-tool-name-");
    expect(parseAgentArtifactUri(locator.artifactUri)).toBe(locator.artifactId);
    expect(normalizeAgentArtifactUri(`urn:senera:artifact:${locator.artifactId}`)).toBe(locator.artifactUri);
    expect(() =>
      createAgentArtifactLocator({
        workspaceRoot,
        rootDir: "../outside",
        step: 0,
        callId: "call-outside",
        toolName: "tool",
        argsHash: "a",
        resultHash: "b",
      }),
    ).toThrow(/artifact 根目录无效/);
  });
});
