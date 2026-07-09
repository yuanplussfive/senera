import assert from "node:assert/strict";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { AgentHostCapabilityNames } from "../Source/AgentSystem/AgentDefaultHostCapabilities.js";
import {
  AgentPiContextPolicy,
  AgentPiContextPolicyCustomType,
  AgentPiContextPolicyEnvelopeType,
} from "../Source/AgentSystem/Pi/AgentPiContextPolicy.js";
import { createToolEvidenceMemoryEntries } from "../Source/AgentSystem/Memory/AgentPlannerMemory.js";
import type { ExecutedToolCallResult } from "../Source/AgentSystem/Types/ToolRuntimeTypes.js";
import type { RegisteredTool } from "../Source/AgentSystem/Types/PluginRuntimeTypes.js";
import type { ToolExecutionManifest } from "../Source/AgentSystem/Types/PluginManifestTypes.js";

const policy = new AgentPiContextPolicy("test-model");

const DefaultExecution = {
  Boundary: "Local",
  Network: "Deny",
  Workspace: "ReadOnly",
  LocalFallback: "Allow",
} satisfies ToolExecutionManifest;

interface PolicyEnvelopeFixture {
  type: string;
  evidence: Array<{
    source: string;
    artifactUri?: string;
    facts: Array<{ name: string; value: string }>;
  }>;
  artifacts: unknown[];
  retrievalTools: Array<{ toolName: string }>;
  stats: {
    omittedEvidence: number;
    totalEvidence: number;
  };
}

verifyHistoricalEvidenceAndRetrievalTools();
verifyCurrentToolResultEvidenceAndDeduplication();
verifyVisibleToolFiltering();
verifyEmptyEvidenceDoesNotInjectPolicy();
verifyOversizedEnvelopeRemainsJson();

console.log("Pi context policy verified.");

function verifyHistoricalEvidenceAndRetrievalTools(): void {
  const frame = policy.createFrame({
    requestId: "current",
    model: "test-model",
    conversationEntries: createToolEvidenceMemoryEntries({
      requestId: "previous",
      step: 1,
      results: [executedToolResultFixture()],
      timestamp: "2026-01-01T00:00:00.000Z",
    }),
    registeredTools: [
      registeredToolFixture("ArtifactReader", AgentHostCapabilityNames.ArtifactMemoryRead),
      registeredToolFixture("MemoryLookup", AgentHostCapabilityNames.MemoryRecall),
    ],
    visibleToolNames: "all",
    createdAt: "2026-01-01T00:00:01.000Z",
  });

  const transformed = policy.apply([userMessage("继续")], frame);
  const envelope = readPolicyEnvelope(transformed);

  assert.equal(envelope.type, AgentPiContextPolicyEnvelopeType);
  assert.equal(envelope.evidence.length, 1);
  assert.equal(envelope.evidence[0]?.source, "history");
  assert.equal(envelope.evidence[0]?.artifactUri, "senera://artifact/weather");
  assert.deepEqual(envelope.evidence[0]?.facts, [{
    name: "city",
    value: "北京",
  }]);
  assert.deepEqual(
    envelope.retrievalTools.map((tool) => tool.toolName),
    ["ArtifactReader", "MemoryLookup"],
  );
}

function verifyCurrentToolResultEvidenceAndDeduplication(): void {
  const frame = policy.createFrame({
    requestId: "current",
    model: "test-model",
    conversationEntries: [],
    registeredTools: [],
    createdAt: "2026-01-01T00:00:01.000Z",
  });
  const messages: AgentMessage[] = [
    userMessage("查一下"),
    toolResultMessage(),
  ];

  const transformed = policy.apply(messages, frame);
  const transformedAgain = policy.apply(transformed, frame);
  const envelope = readPolicyEnvelope(transformedAgain);

  assert.equal(countPolicyMessages(transformedAgain), 1);
  assert.equal(readRecord(transformedAgain.at(-1)).role, "toolResult");
  assert.equal(envelope.evidence.length, 1);
  assert.equal(envelope.evidence[0]?.source, "current_tool_result");
  assert.equal(envelope.evidence[0]?.artifactUri, "senera://artifact/current");
  assert.deepEqual(envelope.artifacts, [{
    artifactUri: "senera://artifact/current",
    evidenceUris: ["senera://evidence/current"],
    refs: [],
  }]);
}

function verifyVisibleToolFiltering(): void {
  const frame = policy.createFrame({
    requestId: "current",
    model: "test-model",
    conversationEntries: [],
    registeredTools: [
      registeredToolFixture("ArtifactReader", AgentHostCapabilityNames.ArtifactMemoryRead),
      registeredToolFixture("MemoryLookup", AgentHostCapabilityNames.MemoryRecall),
    ],
    visibleToolNames: ["MemoryLookup"],
  });

  assert.deepEqual(
    frame.retrievalTools.map((tool) => tool.toolName),
    ["MemoryLookup"],
  );
}

function verifyEmptyEvidenceDoesNotInjectPolicy(): void {
  const frame = policy.createFrame({
    requestId: "current",
    model: "test-model",
    conversationEntries: [],
    registeredTools: [
      registeredToolFixture("MemoryLookup", AgentHostCapabilityNames.MemoryRecall),
    ],
    visibleToolNames: "all",
  });

  assert.equal(countPolicyMessages(policy.apply([userMessage("普通问题")], frame)), 0);
}

function verifyOversizedEnvelopeRemainsJson(): void {
  const frame = {
    requestId: "current",
    model: "test-model",
    createdAt: "2026-01-01T00:00:01.000Z",
    retrievalTools: [],
    historicalEvidence: Array.from({ length: 40 }, (_, index) => ({
      evidenceUri: `senera://evidence/${index}`,
      kind: "large",
      artifactUri: `senera://artifact/${index}`,
      facts: Array.from({ length: 8 }, (__, factIndex) => ({
        name: `fact_${factIndex}`,
        value: `${index}-${factIndex}-`.repeat(200),
      })),
      artifactRefs: ["projection"],
      source: "history" as const,
    })),
  };

  const envelope = readPolicyEnvelope(policy.apply([userMessage("继续")], frame));

  assert.equal(envelope.type, AgentPiContextPolicyEnvelopeType);
  assert.equal(envelope.stats.omittedEvidence > 0, true);
  assert.equal(envelope.stats.totalEvidence, envelope.evidence.length);
}

function readPolicyEnvelope(messages: readonly AgentMessage[]): PolicyEnvelopeFixture {
  const message = messages.find((entry) =>
    readRecord(entry).role === "custom"
    && readRecord(entry).customType === AgentPiContextPolicyCustomType);
  assert.ok(message, "context policy message was injected");
  const content = readRecord(message).content;
  assert.equal(typeof content, "string");
  return JSON.parse(content as string) as PolicyEnvelopeFixture;
}

function countPolicyMessages(messages: readonly AgentMessage[]): number {
  return messages.filter((entry) =>
    readRecord(entry).role === "custom"
    && readRecord(entry).customType === AgentPiContextPolicyCustomType).length;
}

function userMessage(text: string): AgentMessage {
  return {
    role: "user",
    content: [{ type: "text", text }],
    timestamp: Date.now(),
  } as AgentMessage;
}

function toolResultMessage(): AgentMessage {
  return {
    role: "toolResult",
    toolCallId: "call_current",
    toolName: "WeatherTool",
    content: [{
      type: "text",
      text: JSON.stringify({
        type: "senera.tool_observation.v1",
        status: "success",
        artifact_uri: "senera://artifact/current",
        evidence: [{
          evidence_uri: "senera://evidence/current",
          kind: "weather",
          facts: [{
            name: "city",
            value: "上海",
          }],
        }],
      }),
    }],
    isError: false,
    timestamp: Date.now(),
  } as AgentMessage;
}

function executedToolResultFixture(): ExecutedToolCallResult {
  return {
    callId: "call_weather",
    name: "WeatherTool",
    arguments: { city: "北京" },
    process: {
      exitCode: 0,
      signal: null,
      stderr: "",
    },
    result: { ok: true },
    artifact: {
      artifactId: "weather",
      artifactUri: "senera://artifact/weather",
      artifactPath: ".senera/artifacts/weather",
      relativePath: "weather",
      manifestPath: ".senera/artifacts/weather/manifest.json",
      files: {},
      summary: "北京晴。",
      evidence: [{
        key: "weather-beijing",
        evidenceUri: "senera://evidence/weather/beijing",
        kind: "weather",
        locator: "北京",
        display: "北京天气",
        label: "北京",
        source: "WeatherTool",
        confidence: 0.9,
        modelSlots: [{
          name: "city",
          value: "北京",
        }],
        plannerMemory: {
          facts: [{
            name: "city",
            value: "北京",
          }],
          artifactRefs: ["projection"],
        },
      }],
      delta: [],
    },
  };
}

function registeredToolFixture(name: string, capability: string): RegisteredTool {
  return {
    name,
    handler: {
      kind: "HostCapability",
      capability,
    },
    execution: DefaultExecution,
    permissions: [],
    evidenceCapabilities: [{
      Produces: capability,
      Quality: "high",
      Satisfies: [],
      Kinds: [],
      CapabilityIds: [capability],
    }],
    search: {
      Summary: `${name} summary`,
      Capabilities: [{
        Id: capability,
        Facets: {
          Inputs: ["uri"],
          Outputs: ["projection"],
          Evidence: [capability],
        },
      }],
    },
    plugin: {
      rootPath: "",
      rootKind: "System",
      manifestPath: "",
      config: {
        fileName: "",
        path: "",
        exists: false,
        source: "default",
        templateExists: false,
        needsUserConfig: false,
        toml: "",
        sections: [],
        runtime: {
          enabled: true,
          tools: {},
        },
        diagnostics: [],
      },
      manifest: {
        Plugin: {
          Name: `${name}Plugin`,
          Version: "0.1.0",
          Kind: "Tool",
          Description: `${name} description`,
        },
        Tools: [{
          Name: name,
          Handler: {
            Kind: "HostCapability",
            Capability: capability,
          },
          Execution: DefaultExecution,
        }],
      },
    },
  };
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
