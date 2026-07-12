import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { AgentActionPlannerContextBuilder } from "../Source/AgentSystem/ActionPlanner/AgentActionPlannerContext.js";
import { resolveArtifactsConfig } from "../Source/AgentSystem/AgentDefaults.js";
import { AgentPluginRegistry } from "../Source/AgentSystem/Plugin/AgentPluginRegistry.js";
import { AgentPluginScanner } from "../Source/AgentSystem/Plugin/AgentPluginScanner.js";
import { createToolEvidenceMemoryEntries } from "../Source/AgentSystem/Memory/AgentPlannerMemory.js";
import { AgentToolResultXmlRenderer } from "../Source/AgentSystem/Xml/AgentToolResultXmlRenderer.js";
import { AgentToolExecutionArtifactRecorder } from "../Source/AgentSystem/Artifacts/AgentToolExecutionArtifactRecorder.js";
import type { AgentSystemConfig } from "../Source/AgentSystem/Types/AgentConfigTypes.js";
import type { RegisteredTool } from "../Source/AgentSystem/Types/PluginRuntimeTypes.js";
import type {
  ExecutedToolCallResult,
  ToolArtifactEvidenceRecord,
} from "../Source/AgentSystem/Types/ToolRuntimeTypes.js";

const workspaceRoot = path.resolve(process.cwd());
const artifactRoot = ".senera/artifacts/policy-verification";

const config: AgentSystemConfig = {
  PluginRoots: {
    System: ["./System/Plugins"],
    User: [],
  },
  PluginDiscovery: {
    ManifestFileName: "PluginManifest.json",
  },
  ModelProviderEndpoints: [
    {
      Id: "test",
      BaseUrl: "https://example.invalid/v1",
      ApiKey: "test",
    },
  ],
  ModelProviders: [
    {
      Id: "test",
      ProviderId: "test",
      Endpoint: "Responses",
      Model: "test",
      Temperature: 0,
      MaxOutputTokens: -1,
      Stream: true,
      TimeoutSeconds: 0.001,
      MaxNetworkRetries: 0,
    },
  ],
  Artifacts: {
    RootDir: artifactRoot,
    SummaryMaxChars: 3200,
    RawJsonMaxBytes: 1048576,
    TextFileMaxBytes: 262144,
  },
};

interface ToolPolicyFixture {
  result: unknown;
  expectedKinds: string[];
  expectedEvidenceCount?: number;
}

const fixtures: Record<string, ToolPolicyFixture> = {
  ToolSearchTool: {
    expectedKinds: ["tool_candidate"],
    result: {
      query: "search workspace tools",
      tools: {
        item: [
          {
            name: "WorkspaceGrep",
            title: "Workspace Grep",
            summary: "Search local workspace content through MCP ripgrep.",
            score: 0.92,
          },
        ],
      },
    },
  },
  ShellCommandTool: {
    expectedKinds: ["shell_execution"],
    result: {
      command: "npm run check.types",
      cwd: workspaceRoot,
      exitCode: 0,
      signal: null,
      stdout: "check passed",
      stderr: "",
    },
  },
  WorkspaceReadFile: mcpToolResultFixture("package.json content"),
  WorkspaceListDirectory: mcpToolResultFixture("[FILE] package.json\n[DIR] Source"),
  WorkspaceSearchFiles: mcpToolResultFixture("Source/AgentSystem/ToolRuntime/AgentToolRunner.ts"),
  WorkspaceGrep: mcpToolResultFixture(
    "Source/AgentSystem/ToolRuntime/AgentToolRunner.ts:17:export interface AgentToolRunnerLike",
  ),
  WorkspaceListFiles: mcpToolResultFixture("Source/AgentSystem/ToolRuntime/AgentToolRunner.ts"),
  WorkspaceEditFile: {
    expectedKinds: ["workspace_write_result"],
    result: mcpToolResult("Successfully applied edits to Source/AgentSystem/ToolRuntime/AgentToolRunner.ts"),
  },
  WorkspaceWriteFile: {
    expectedKinds: ["workspace_write_result"],
    result: mcpToolResult("Successfully wrote to docs/Development/McpWrite.md"),
  },
  WorkspaceCreateDirectory: {
    expectedKinds: ["workspace_write_result"],
    result: mcpToolResult("Successfully created directory docs/Development"),
  },
  WorkspaceMoveFile: {
    expectedKinds: ["workspace_write_result"],
    result: mcpToolResult("Successfully moved old.md to docs/new.md"),
  },
  WorkspaceApplyPatch: {
    expectedKinds: ["workspace_patch_result"],
    result: {
      text: "Workspace patch applied 2 operation(s) over 2 path(s).",
      applied: true,
      dryRun: false,
      fuzzFactor: 0,
      operationCount: 2,
      changedPaths: ["Source/Example.ts", "docs/Example.md"],
      operations: [
        {
          kind: "update",
          path: "Source/Example.ts",
          changedPaths: ["Source/Example.ts"],
        },
        {
          kind: "add",
          path: "docs/Example.md",
          changedPaths: ["docs/Example.md"],
        },
      ],
    },
  },
  ArtifactMemoryReadTool: {
    expectedKinds: ["artifact_memory"],
    result: {
      artifacts: {
        item: [
          {
            artifactUri: "senera://artifact/art_1234567890abcdef12345678",
            artifactId: "art_1234567890abcdef12345678",
            status: "found",
            message: "Artifact memory loaded.",
            availableRefs: {
              item: [
                {
                  ref: "projection",
                  byteLength: 42,
                },
              ],
            },
            availableRefCount: 1,
            memories: {
              item: [
                {
                  ref: "projection",
                  content: "- WTH1 forecast for Shanghai, China: Cloudy",
                  byteLength: 42,
                  truncated: false,
                },
              ],
            },
            memoryCount: 1,
          },
        ],
      },
      guidance: "Use returned memories as evidence for the current turn.",
    },
  },
  MemoryRecallTool: {
    expectedKinds: ["memory_recall", "conversation_recall"],
    result: {
      query: "用户代码实现偏好",
      scope: "preference",
      limit: 5,
      refs: {
        item: [],
      },
      memories: {
        item: [
          {
            memoryUri: "senera://memory-item/mem_policy",
            type: "preference",
            subject: "assistant_work_style",
            claim: "用户偏好从源头解决问题，避免硬编码。",
            howToApply: "实现时优先使用结构化协议、统一模块和成熟库。",
            tags: {
              item: ["工作方式", "代码质量"],
            },
            triggers: {
              item: ["不要硬编码", "从源头解决"],
            },
            sourceRefs: {
              item: ["senera://memory-source/src_policy"],
            },
            matchedBy: {
              item: ["keyword"],
            },
            score: 0.016393,
            confidence: 0.92,
            updatedAt: "2026-06-24T02:00:05.000Z",
            localDate: "2026-06-24",
          },
        ],
      },
      turns: {
        item: [
          {
            episodeUri: "senera://memory-episode/ep_policy",
            requestId: "req_policy",
            userMessage: {
              sourceRef: "senera://memory-source/src_policy_user",
              text: "临时口令是蓝色月亮。",
              summary: "用户提供临时口令。",
            },
            assistantMessage: {
              sourceRef: "senera://memory-source/src_policy_assistant",
              text: "已了解这个临时口令。",
              summary: "助手确认临时口令。",
            },
            sourceRefs: {
              item: ["senera://memory-source/src_policy_user", "senera://memory-source/src_policy_assistant"],
            },
            matchedBy: {
              item: ["keyword"],
            },
            score: 0.016129,
            startedAt: "2026-06-24T02:01:00.000Z",
            completedAt: "2026-06-24T02:01:03.000Z",
            localDate: "2026-06-24",
          },
        ],
      },
      sources: {
        item: [
          {
            sourceRef: "senera://memory-source/src_policy",
            sourceKind: "user_message",
            role: "user",
            summary: "用户要求避免硬编码。",
            evidenceUri: "",
            artifactUri: "",
            toolName: "",
            createdAt: "2026-06-24T02:00:00.000Z",
            localDate: "2026-06-24",
          },
        ],
      },
      fallback: {
        used: false,
        reason: "",
      },
      warnings: {
        item: [],
      },
      guidance: "Use recalled memories as durable user/project context.",
    },
  },
  MemoryWriteTool: {
    expectedKinds: ["memory_write"],
    result: {
      status: "written",
      memories: {
        item: [
          {
            memoryUri: "senera://memory-item/mem_write_policy",
            operation: "create",
            type: "preference",
            subject: "assistant_work_style",
            claim: "用户偏好从源头解决问题，避免硬编码。",
            howToApply: "实现时优先使用结构化协议、统一模块和成熟库。",
            tags: {
              item: ["工作方式", "代码质量"],
            },
            triggers: {
              item: ["不要硬编码", "从源头解决"],
            },
            sourceRefs: {
              item: [],
            },
            status: "active",
            confidence: 0.95,
            targetMemoryUri: "",
            updatedAt: "2026-06-24T02:02:00.000Z",
            localDate: "2026-06-24",
          },
        ],
      },
      warnings: {
        item: [],
      },
      guidance: "Memory was written as active long-term memory.",
    },
  },
  AskUserTool: {
    expectedKinds: ["clarification_request"],
    result: {
      control: {
        kind: "AskUser",
        question: "Which file should I update?",
        reason_code: "missing_target",
      },
    },
  },
};

void main();

async function main(): Promise<void> {
  assertNoLegacyPolicyKeys();

  const registry = new AgentPluginRegistry();
  for (const plugin of new AgentPluginScanner(workspaceRoot, config).scan()) {
    registry.registerPlugin(plugin);
  }

  const tools = registry.listTools();
  const missingFixtures = tools.map((tool) => tool.name).filter((name) => !fixtures[name]);
  assert.deepEqual(missingFixtures, [], `Missing artifact policy fixtures: ${missingFixtures.join(", ")}`);

  const missingPolicy = tools.filter((tool) => !tool.artifactPolicy).map((tool) => tool.name);
  assert.deepEqual(missingPolicy, [], `Missing artifact policies: ${missingPolicy.join(", ")}`);

  const recorder = new AgentToolExecutionArtifactRecorder({
    workspaceRoot,
    config: resolveArtifactsConfig(config),
    model: "test",
  });
  const results: ExecutedToolCallResult[] = [];

  for (const tool of tools) {
    const fixture = fixtures[tool.name];
    assert.ok(fixture, `Missing fixture for ${tool.name}`);
    assertPolicyShape(tool);

    results.push({
      callId: `call-${tool.name}`,
      name: tool.name,
      arguments: sampleArguments(tool.name),
      process: {
        exitCode: 0,
        signal: null,
        stderr: "",
      },
      result: fixture.result,
      artifactPolicy: tool.artifactPolicy,
    });
  }

  const recorded = await recorder.record({
    requestId: "policy-verification",
    step: 1,
    results,
  });

  for (const result of recorded) {
    const fixture = fixtures[result.name];
    assert.ok(fixture, `Missing fixture for ${result.name}`);
    assert.ok(result.artifact, `${result.name} should have an artifact`);
    assert.equal(path.isAbsolute(result.artifact.artifactPath), true);
    assert.equal(fs.existsSync(result.artifact.files.manifest), true);
    assert.equal(fs.existsSync(result.artifact.files.raw), true);
    assert.equal(fs.existsSync(result.artifact.files.evidence), true);
    assert.equal(fs.existsSync(result.artifact.files.summary), true);
    assert.equal(fs.existsSync(result.artifact.files.summaryJson), true);
    assert.equal(result.artifact.structuredSummary?.type, "senera.tool_result_summary.v1");
    assert.equal(result.artifact.structuredSummary?.artifactUri, result.artifact.artifactUri);
    assertEvidence(result.name, result.artifact.evidence, fixture);
    assertArtifactFiles(result.name, result.artifact);
  }

  const ledger = new AgentActionPlannerContextBuilder(workspaceRoot, artifactRoot).advanceAfterToolResults({
    requestId: "policy-verification",
    ledger: {
      calls: [],
      evidence: [],
      warnings: [],
      deltas: [],
      lastNewEvidenceStep: 0,
    },
    step: 1,
    results: recorded,
  });

  const expectedEvidenceTotal = uniqueEvidenceKeys(recorded).size;
  assert.equal(ledger.evidence.length, expectedEvidenceTotal);
  assert.equal(ledger.deltas.filter((entry) => entry.op === "AddEvidence").length, expectedEvidenceTotal);
  assertRecordedCallEvidence(recorded, ledger);
  assertPlannerProjection(recorded, ledger);

  console.log("Plugin artifact policy verification passed.");
}

function uniqueEvidenceKeys(results: readonly ExecutedToolCallResult[]): Set<string> {
  return new Set(results.flatMap((result) => result.artifact?.evidence.map((entry) => entry.key) ?? []));
}

function assertRecordedCallEvidence(
  recorded: readonly ExecutedToolCallResult[],
  ledger: ReturnType<AgentActionPlannerContextBuilder["advanceAfterToolResults"]>,
): void {
  assert.equal(ledger.calls.length, recorded.length);
  for (const [index, result] of recorded.entries()) {
    const call = ledger.calls[index];
    assert.equal(call.toolName, result.name);
    assert.deepEqual(
      call.evidenceUris,
      result.artifact?.evidence.map((entry) => entry.evidenceUri) ?? [],
      `${result.name} ledger call should retain artifact evidence URIs`,
    );
  }
}

function assertPolicyShape(tool: RegisteredTool): void {
  const policy = tool.artifactPolicy;
  assert.ok(policy, `${tool.name} should have artifact policy`);
  assert.ok(policy.Summary?.Template.trim(), `${tool.name} artifact policy needs Summary.Template`);
  assert.ok(policy.Summary?.ArtifactTemplate.trim(), `${tool.name} artifact policy needs Summary.ArtifactTemplate`);
  for (const rule of policy.Evidence ?? []) {
    assert.ok(rule.Kind.trim(), `${tool.name} evidence rule needs Kind`);
    assert.ok(rule.Records.trim(), `${tool.name} evidence rule needs Records`);
    assert.ok(Object.keys(rule.Slots).length > 0, `${tool.name} evidence rule needs Slots`);
    assert.ok(rule.Identity.Parts.length > 0, `${tool.name} evidence rule needs Identity.Parts`);
    assert.ok(rule.Presentation.Locator.trim(), `${tool.name} evidence rule needs Presentation.Locator`);
    assert.ok(rule.Presentation.Display.trim(), `${tool.name} evidence rule needs Presentation.Display`);
    assert.ok(rule.Presentation.Label.trim(), `${tool.name} evidence rule needs Presentation.Label`);
    assert.ok(rule.Presentation.Source.trim(), `${tool.name} evidence rule needs Presentation.Source`);
    assert.ok(rule.ModelProjection.Slots.length > 0, `${tool.name} evidence rule needs ModelProjection.Slots`);
    assert.ok(rule.PlannerMemory.Facts.length > 0, `${tool.name} evidence rule needs PlannerMemory.Facts`);
    assert.ok(rule.Projection.SummaryTemplate.trim(), `${tool.name} evidence rule needs Projection.SummaryTemplate`);
    assert.ok(rule.Projection.ArtifactTemplate.trim(), `${tool.name} evidence rule needs Projection.ArtifactTemplate`);
  }
}

function assertEvidence(
  toolName: string,
  evidence: readonly ToolArtifactEvidenceRecord[],
  fixture: ToolPolicyFixture,
): void {
  const expectedCount = fixture.expectedEvidenceCount ?? fixture.expectedKinds.length;
  assert.equal(evidence.length, expectedCount, `${toolName} evidence count`);

  for (const kind of fixture.expectedKinds) {
    assert.ok(
      evidence.some((entry) => entry.kind === kind),
      `${toolName} should emit ${kind}`,
    );
  }

  const keys = new Set<string>();
  const refs = new Set<string>();
  for (const entry of evidence) {
    assert.equal(entry.key.startsWith(`${entry.kind}:`), true, `${toolName} evidence key should include kind`);
    assert.equal(entry.evidenceUri.trim().length > 0, true, `${toolName} evidence URI should not be empty`);
    assert.equal(entry.locator.trim().length > 0, true, `${toolName} evidence locator should not be empty`);
    assert.equal(entry.display.trim().length > 0, true, `${toolName} evidence display should not be empty`);
    assert.equal(entry.label.trim().length > 0, true, `${toolName} evidence label should not be empty`);
    assert.equal(entry.source.trim().length > 0, true, `${toolName} evidence source should not be empty`);
    assert.equal(entry.modelSlots.length > 0, true, `${toolName} evidence modelSlots should not be empty`);
    assert.equal(
      entry.plannerMemory.facts.length > 0,
      true,
      `${toolName} evidence plannerMemory facts should not be empty`,
    );
    assert.equal(keys.has(entry.key), false, `${toolName} evidence key should be unique: ${entry.key}`);
    assert.equal(refs.has(entry.evidenceUri), false, `${toolName} evidence URI should be unique: ${entry.evidenceUri}`);
    keys.add(entry.key);
    refs.add(entry.evidenceUri);
  }
}

function assertArtifactFiles(toolName: string, artifact: NonNullable<ExecutedToolCallResult["artifact"]>): void {
  const evidenceText = fs.readFileSync(artifact.files.evidence, "utf8");
  const evidenceJson = JSON.parse(evidenceText) as {
    evidence?: Array<Record<string, unknown>>;
  };
  for (const entry of evidenceJson.evidence ?? []) {
    assert.equal(typeof entry.key, "string", `${toolName} evidence.json should retain internal key`);
    assert.equal(typeof entry.evidenceUri, "string", `${toolName} evidence.json should contain evidenceUri`);
    assert.equal(typeof entry.locator, "string", `${toolName} evidence.json should contain locator`);
    assert.equal(typeof entry.display, "string", `${toolName} evidence.json should contain display`);
    assert.equal(Array.isArray(entry.modelSlots), true, `${toolName} evidence.json should contain modelSlots`);
    assert.equal(typeof entry.plannerMemory, "object", `${toolName} evidence.json should contain plannerMemory`);
  }

  const summary = fs.readFileSync(artifact.files.summary, "utf8");
  const projection = fs.readFileSync(artifact.files.projection, "utf8");
  for (const entry of artifact.evidence) {
    assert.equal(summary.includes(entry.key), false, `${toolName} summary should hide internal key`);
    assert.equal(projection.includes(entry.key), false, `${toolName} projection should hide internal key`);
    assert.equal(
      summary.includes(entry.evidenceUri) || projection.includes(entry.evidenceUri),
      true,
      `${toolName} visible artifact text should contain evidence URI`,
    );
  }
}

function assertPlannerProjection(
  recorded: readonly ExecutedToolCallResult[],
  ledger: ReturnType<AgentActionPlannerContextBuilder["advanceAfterToolResults"]>,
): void {
  const xml = new AgentToolResultXmlRenderer().render({
    kind: "ToolResults",
    value: [...recorded],
  });
  assert.equal(xml.includes("<key>"), false, "tool result XML should not expose evidence key");
  assert.equal(xml.includes("<artifactPath>"), false, "tool result XML should not expose artifact absolute path");
  assert.equal(xml.includes("<relativePath>"), false, "tool result XML should not expose artifact relative path");
  assert.equal(xml.includes("<evidenceUri>"), true, "tool result XML should expose evidence URI");
  assert.equal(xml.includes("<locator>"), true, "tool result XML should expose evidence locator");
  assert.equal(xml.includes("<slots>"), true, "tool result XML should expose projected slots");
  assert.equal(xml.includes("<name>"), true, "tool result XML should expose projected slot names");
  assert.equal(xml.includes("<value>"), true, "tool result XML should expose projected slot values");

  const input = new AgentActionPlannerContextBuilder(workspaceRoot, artifactRoot).buildInput({
    userMessage: "verify artifact policies",
    currentStep: 2,
    dynamicTools: true,
    loadedToolNames: "all",
    messages: [],
    ledger,
    toolCatalog: [],
  });
  const timelineJson = JSON.stringify(input.timeline);
  const timelineText = input.timeline.map((turn) => turn.content).join("\n");
  const runStateJson = JSON.stringify(input.runState);
  assert.equal(JSON.stringify(input.evidenceMemory).includes('"key"'), false);
  assert.equal(timelineText.includes("key:"), false, "planner timeline should not expose internal key");
  assert.equal(
    timelineText.includes("artifactPath"),
    false,
    "planner timeline should not expose artifact absolute path",
  );
  assert.equal(
    timelineText.includes("relativePath"),
    false,
    "planner timeline should not expose artifact relative path",
  );
  assert.equal(timelineText.includes("evidenceUri:"), true, "planner timeline should expose evidence URIs");
  assert.equal(timelineText.includes("slots:"), true, "planner timeline should expose projected slots");
  assert.equal(timelineText.includes("confidence:"), true, "planner timeline should expose confidence");
  assert.equal(timelineJson.includes("evidenceUris"), true, "planner timeline should expose turn evidenceUris");
  assert.equal(runStateJson.includes('"evidenceUri"'), false, "planner runState should not duplicate evidence details");
  assert.equal(runStateJson.includes('"slots"'), false, "planner runState should not duplicate evidence slots");

  const memoryEntries = createToolEvidenceMemoryEntries({
    requestId: "policy-verification",
    step: 1,
    results: recorded,
    timestamp: "2026-06-12T00:00:00.000Z",
  });
  const memoryJson = JSON.stringify(memoryEntries);
  assert.equal(memoryJson.includes('"source"'), false, "planner memory should not duplicate evidence source");
  assert.equal(memoryJson.includes('"summary"'), false, "planner memory should not duplicate artifact summary");
  assert.equal(memoryJson.includes('"slots"'), false, "planner memory should not duplicate model slots");
  assert.equal(memoryJson.includes('"snippet"'), false, "planner memory should not keep search snippets");
  assert.equal(memoryJson.includes('"content"'), false, "planner memory should not keep web result content");
  assert.equal(memoryJson.includes('"facts"'), true, "planner memory should expose compact facts");
}

function assertNoLegacyPolicyKeys(): void {
  const manifestPaths = [
    ...findManifestPaths(path.join(workspaceRoot, "System", "Plugins")),
    ...findManifestPaths(path.join(workspaceRoot, "Plugins")),
  ];

  for (const manifestPath of manifestPaths) {
    const text = fs.readFileSync(manifestPath, "utf8");
    const manifest = JSON.parse(text) as {
      Tools?: Array<{
        Name?: string;
        Artifacts?: {
          Summary?: Record<string, unknown>;
        };
      }>;
    };
    assert.equal(text.includes("PathSelectors"), false, `${manifestPath} should not use PathSelectors`);
    assert.equal(text.includes("EvidencePathFields"), false, `${manifestPath} should not use global path fields`);
    assert.equal(text.includes("EvidenceUrlFields"), false, `${manifestPath} should not use global url fields`);
    assert.equal(
      text.includes("RedactionKeyPatterns"),
      false,
      `${manifestPath} should not use global redaction key patterns`,
    );
    for (const tool of manifest.Tools ?? []) {
      assert.equal(
        "Fields" in (tool.Artifacts?.Summary ?? {}),
        false,
        `${manifestPath} ${tool.Name ?? "tool"} should not use Summary.Fields`,
      );
    }
  }
}

function findManifestPaths(root: string): string[] {
  if (!fs.existsSync(root)) {
    return [];
  }

  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name, "PluginManifest.json"))
    .filter((manifestPath) => fs.existsSync(manifestPath));
}

function sampleArguments(toolName: string): Record<string, unknown> {
  return {
    toolName,
    verification: true,
  };
}

function mcpToolResultFixture(text: string): ToolPolicyFixture {
  return {
    expectedKinds: ["mcp_tool_result"],
    result: mcpToolResult(text),
  };
}

function mcpToolResult(text: string): Record<string, unknown> {
  return {
    text,
    mcp: {
      content: {
        item: [
          {
            type: "text",
            text,
          },
        ],
      },
    },
  };
}
