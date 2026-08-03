import assert from "node:assert/strict";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { AgentHostCapabilityNames } from "../Source/AgentSystem/AgentDefaultHostCapabilities.js";
import { AgentPiContextPolicy, AgentPiContextPolicyCustomType } from "../Source/AgentSystem/Pi/AgentPiContextPolicy.js";
import { AgentPiToolObservationProtocol } from "../Source/AgentSystem/Pi/AgentPiToolObservation.js";
import type { RegisteredTool } from "../Source/AgentSystem/Types/AgentToolRuntimeTypes.js";

const policy = new AgentPiContextPolicy("test-model");
const frame = policy.createFrame({
  requestId: "current",
  model: "test-model",
  registeredTools: [retrievalTool()],
  createdAt: "2026-01-01T00:00:00.000Z",
});

const transformed = policy.apply(
  [toolResultMessage(), userMessage("继续")],
  frame,
  [
    {
      artifactUri: "senera://artifact/archived",
      toolNames: ["ArchivedTool"],
      callIds: ["call_archived"],
      evidenceUris: ["senera://evidence/archived"],
      refs: ["projection"],
    },
  ],
  { contextWindowTokens: 4_096, outputReserveTokens: 512 },
);
const policyMessages = transformed.filter(
  (message) => message.role === "custom" && message.customType === AgentPiContextPolicyCustomType,
);
assert.equal(policyMessages.length, 1);
const policyMessage = policyMessages[0];
assert.equal(policyMessage?.role, "custom");
if (policyMessage?.role !== "custom") {
  throw new Error("Expected the Pi context policy to produce a custom message.");
}
assert.equal(typeof policyMessage.content, "string");
if (typeof policyMessage.content !== "string") {
  throw new Error("Expected the Pi context policy to serialize its envelope.");
}
const envelope = JSON.parse(policyMessage.content) as {
  evidence: unknown[];
  artifacts: Array<{ artifactUri: string }>;
  retrievalTools: Array<{ toolName: string }>;
};
assert.equal(envelope.evidence.length, 0);
assert.deepEqual(
  envelope.artifacts.map((artifact) => artifact.artifactUri),
  ["senera://artifact/archived"],
);
assert.deepEqual(
  envelope.retrievalTools.map((tool) => tool.toolName),
  ["ArtifactReader"],
);

console.log("Pi context policy verified.");

function userMessage(text: string): AgentMessage {
  return {
    role: "user",
    content: [{ type: "text", text }],
    timestamp: Date.now(),
  };
}

function toolResultMessage(): AgentMessage {
  return {
    role: "toolResult",
    toolCallId: "call_current",
    toolName: "WeatherTool",
    content: [
      {
        type: "text",
        text: JSON.stringify({
          type: AgentPiToolObservationProtocol.type,
          artifact_uri: "senera://artifact/current",
          evidence: [
            {
              evidence_uri: "senera://evidence/current",
              kind: "weather",
              artifact_refs: ["projection"],
              facts: [{ name: "city", value: "上海" }],
            },
          ],
        }),
      },
    ],
    isError: false,
    timestamp: Date.now(),
  };
}

function retrievalTool(): RegisteredTool {
  return {
    owner: {
      kind: "system",
      name: "artifact-reader",
      title: "Artifact reader",
      description: "Reads published artifacts.",
      rootPath: process.cwd(),
      revision: "test",
      trusted: true,
      requiresApproval: false,
    },
    name: "ArtifactReader",
    loading: "Dynamic",
    handler: { kind: "HostCapability", capability: AgentHostCapabilityNames.ArtifactMemoryRead },
    runtime: { Lifecycle: "Immediate", ProtocolVersion: 2, ResultAssessment: "ProcessExit" },
    execution: { Targets: ["Local"], Network: "Deny", Workspace: "ReadOnly" },
    permissions: [],
    sources: [],
    evidenceCapabilities: [],
  };
}
