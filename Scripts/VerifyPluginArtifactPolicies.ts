import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { AgentActionPlannerContextBuilder } from "../Source/AgentSystem/AgentActionPlannerContext.js";
import { resolveArtifactsConfig } from "../Source/AgentSystem/AgentDefaults.js";
import { AgentPluginRegistry } from "../Source/AgentSystem/AgentPluginRegistry.js";
import { AgentPluginScanner } from "../Source/AgentSystem/AgentPluginScanner.js";
import { createToolEvidenceMemoryEntries } from "../Source/AgentSystem/AgentPlannerMemory.js";
import { AgentToolResultXmlRenderer } from "../Source/AgentSystem/AgentToolResultXmlRenderer.js";
import { AgentToolExecutionArtifactRecorder } from "../Source/AgentSystem/Artifacts/AgentToolExecutionArtifactRecorder.js";
import type {
  AgentSystemConfig,
  ExecutedToolCallResult,
  RegisteredTool,
  ToolArtifactEvidenceRecord,
} from "../Source/AgentSystem/Types.js";

const workspaceRoot = path.resolve(process.cwd());
const artifactRoot = ".senera/artifacts/policy-verification";

const config: AgentSystemConfig = {
  PluginRoots: {
    System: [
      "./System/Plugins",
    ],
    User: [
      "./Plugins",
    ],
  },
  PluginDiscovery: {
    ManifestFileName: "PluginManifest.json",
  },
  ModelProviders: [{
    Id: "test",
    Kind: "OpenAICompatible",
    Endpoint: "Responses",
    BaseUrl: "https://example.invalid/v1",
    ApiKey: "test",
    Model: "test",
    Temperature: 0,
    MaxOutputTokens: -1,
    Stream: true,
    TimeoutMs: 1,
    MaxNetworkRetries: 0,
  }],
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
    expectedKinds: [
      "tool_candidate",
    ],
    result: {
      query: "search workspace tools",
      tools: {
        item: [{
          name: "FastContextSearchTool",
          title: "Fast Context Search Tool",
          summary: "Search local workspace content.",
          score: 0.92,
        }],
      },
    },
  },
  ApplyPatchTool: {
    expectedKinds: [
      "workspace_file",
    ],
    result: {
      dryRun: false,
      changedFiles: {
        item: [{
          path: "Source/AgentSystem/Types.ts",
          status: "modified",
          additions: 4,
          deletions: 1,
        }],
      },
      diagnostics: {
        item: [
          "编辑已应用，共 1 个文件。",
        ],
      },
    },
  },
  ShellCommandTool: {
    expectedKinds: [
      "shell_execution",
    ],
    result: {
      command: "npm run check",
      cwd: workspaceRoot,
      exitCode: 0,
      signal: null,
      stdout: "check passed",
      stderr: "",
    },
  },
  TavilySearchTool: {
    expectedKinds: [
      "web_result",
    ],
    expectedEvidenceCount: 2,
    result: {
      query: "artifact evidence best practices",
      answer: "Artifacts should preserve source material and compact summaries.",
      results: {
        item: [
          {
            title: "Artifact Design",
            url: "https://example.com/artifacts",
            content: "Evidence artifacts keep source references durable.",
            score: 0.91,
            publishedDate: "2026-06-01",
            favicon: "https://example.com/favicon.ico",
          },
          {
            title: "Evidence Packs",
            url: "https://example.org/evidence",
            content: "Evidence packs separate raw data from model context.",
            score: 0.88,
          },
        ],
      },
      images: {
        item: [],
      },
      responseTime: 0.42,
      usage: {
        credits: 1,
      },
      source: "Tavily",
    },
  },
  FastContextHybridSearchTool: {
    expectedKinds: [
      "workspace_search_match",
    ],
    expectedEvidenceCount: 2,
    result: searchResultFixture("hybrid context", "combined"),
  },
  FastContextSearchTool: {
    expectedKinds: [
      "workspace_search_match",
    ],
    expectedEvidenceCount: 2,
    result: searchResultFixture("exact context", "ripgrep"),
  },
  FastContextSymbolSearchTool: {
    expectedKinds: [
      "workspace_symbol",
    ],
    expectedEvidenceCount: 2,
    result: {
      query: "AgentToolExecutionArtifactRecorder",
      workspaceRoot,
      symbols: {
        item: [
          {
            id: "Source/AgentSystem/Artifacts/AgentToolExecutionArtifactRecorder.ts:AgentToolExecutionArtifactRecorder:class",
            name: "AgentToolExecutionArtifactRecorder",
            kind: "class",
            path: "Source/AgentSystem/Artifacts/AgentToolExecutionArtifactRecorder.ts",
            line: 26,
            startLine: 26,
            endLine: 203,
            signature: "export class AgentToolExecutionArtifactRecorder",
            exported: true,
            imports: {
              item: [],
            },
            score: 0.96,
          },
          {
            id: "Source/AgentSystem/Artifacts/AgentToolExecutionArtifactRecorder.ts:collectEvidence:function",
            name: "collectEvidence",
            kind: "function",
            path: "Source/AgentSystem/Artifacts/AgentToolExecutionArtifactRecorder.ts",
            line: 271,
            startLine: 271,
            endLine: 283,
            signature: "function collectEvidence(value, policy)",
            exported: false,
            imports: {
              item: [],
            },
            score: 0.84,
          },
        ],
      },
      warnings: {
        item: [],
      },
      availableRoots: {
        item: [
          workspaceRoot,
        ],
      },
      stats: {
        resultCount: 2,
        symbolCount: 2,
        refreshedIndex: false,
        elapsedMs: 11,
      },
    },
  },
  FastContextReadTool: {
    expectedKinds: [
      "workspace_read",
    ],
    result: {
      kind: "file",
      path: "Source/AgentSystem/Types.ts",
      startLine: 300,
      endLine: 340,
      totalLines: 620,
      content: "export interface ToolArtifactEvidenceManifest { ... }",
      truncated: false,
    },
  },
  FastContextIndexSearchTool: {
    expectedKinds: [
      "workspace_search_match",
    ],
    expectedEvidenceCount: 2,
    result: searchResultFixture("indexed context", "index"),
  },
  FastContextRefreshIndexTool: {
    expectedKinds: [
      "workspace_index",
    ],
    result: {
      workspaceRoot,
      indexedFiles: 120,
      indexedDocuments: 310,
      indexedSymbols: 88,
      skippedFiles: 4,
      stateFile: ".state/FastContextIndex.json",
      warnings: {
        item: [],
      },
      availableRoots: {
        item: [
          workspaceRoot,
        ],
      },
      elapsedMs: 153,
    },
  },
  FastContextWorkspaceMapTool: {
    expectedKinds: [
      "workspace_map_path",
      "workspace_recommended_root",
    ],
    expectedEvidenceCount: 4,
    result: {
      workspaceRoot,
      topLevel: {
        item: [
          {
            path: "Source",
            kind: "directory",
            purpose: "Runtime source code.",
            children: {
              item: [
                "AgentSystem",
              ],
            },
          },
          {
            path: "Plugins",
            kind: "directory",
            purpose: "Tool plugin packages.",
            children: {
              item: [
                "FastContextSearchToolPlugin",
              ],
            },
          },
        ],
      },
      indexedRoots: {
        item: [
          "Source",
        ],
      },
      availableRoots: {
        item: [
          workspaceRoot,
        ],
      },
      project: {
        markers: {
          item: [
            "package.json",
          ],
        },
        sourceRoots: {
          item: [
            "Source",
          ],
        },
        entryPoints: {
          item: [
            "Source/AgentSystem/AgentSystemRuntime.ts",
          ],
        },
        recommendedRoots: {
          item: [
            "Source",
            "System/Plugins",
          ],
        },
      },
      guidance: {
        item: [
          "Use search before reading unknown files.",
        ],
      },
    },
  },
  WeatherTool: {
    expectedKinds: [
      "weather_observation",
      "weather_forecast_day",
    ],
    expectedEvidenceCount: 3,
    result: {
      location: "Shanghai",
      resolvedLocation: "Shanghai, China",
      country: "China",
      region: "Shanghai",
      latitude: 31.23,
      longitude: 121.47,
      timezone: "Asia/Shanghai",
      localTime: "2026-06-10 09:00",
      temperature: 27,
      feelsLike: 30,
      temperatureUnit: "C",
      condition: "Cloudy",
      humidity: 70,
      windSpeed: 12,
      windSpeedUnit: "km/h",
      forecast: {
        item: [
          {
            date: "2026-06-10",
            condition: "Cloudy",
            maxTemperature: 29,
            minTemperature: 24,
            avgTemperature: 27,
            temperatureUnit: "C",
            chanceOfRain: 40,
          },
          {
            date: "2026-06-11",
            condition: "Rain",
            maxTemperature: 28,
            minTemperature: 23,
            avgTemperature: 25,
            temperatureUnit: "C",
            chanceOfRain: 80,
          },
        ],
      },
      source: "WeatherAPI",
    },
  },
  DocumentTool: {
    expectedKinds: [
      "uploaded_document",
    ],
    result: {
      documents: {
        item: [{
          uploadUri: "senera://upload/upl_document_policy",
          mode: "auto",
          status: "extracted",
          name: "policy.md",
          mime: "text/markdown",
          size: 512,
          sha256: "f".repeat(64),
          effectiveMime: "text/markdown",
          detectedMime: "text/markdown",
          declaredMime: "text/markdown",
          namedMime: "text/markdown",
          mediaType: "text",
          charset: "UTF-8",
          isText: true,
          isBinary: false,
          contentAvailable: true,
          textAvailable: true,
          fileType: "md",
          parser: "officeparser",
          textLength: 128,
          markdownLength: 144,
          chunkCount: 2,
          warningCount: 0,
          textPreview: "Plain text preview should remain in raw artifact only.",
          markdownPreview: "# Policy\n\nMarkdown preview is the model-facing document preview.",
          chunks: {
            item: [
              {
                index: 0,
                text: "Chunk text should remain in raw artifact only.",
                length: 47,
                metadata: {},
              },
            ],
          },
          message: "Document was probed and text was extracted by the configured parser.",
        }],
      },
    },
  },
  ImageVisionTool: {
    expectedKinds: [
      "image_vision_result",
    ],
    result: {
      images: {
        item: [{
          uploadUri: "senera://upload/upl_image_policy",
          status: "analyzed",
          task: "describe",
          question: "What is visible?",
          name: "screenshot.png",
          mime: "image/png",
          size: 2048,
          answer: "The image shows a settings panel.",
          providerId: "image-vision",
          providerEndpoint: "Responses",
          providerModel: "gpt-4.1-mini",
          message: "Image was analyzed by the configured vision model.",
        }],
      },
    },
  },
  ArtifactMemoryReadTool: {
    expectedKinds: [
      "artifact_memory",
    ],
    result: {
      artifacts: {
        item: [{
          artifactUri: "senera://artifact/art_1234567890abcdef12345678",
          artifactId: "art_1234567890abcdef12345678",
          status: "found",
          message: "Artifact memory loaded.",
          availableRefs: {
            item: [{
              ref: "projection",
              byteLength: 42,
            }],
          },
          availableRefCount: 1,
          memories: {
            item: [{
              ref: "projection",
              content: "- WTH1 forecast for Shanghai, China: Cloudy",
              byteLength: 42,
              truncated: false,
            }],
          },
          memoryCount: 1,
        }],
      },
      guidance: "Use returned memories as evidence for the current turn.",
    },
  },
  AgentDelegateTool: {
    expectedKinds: [
      "agent_delegation_job",
    ],
    expectedEvidenceCount: 3,
    result: {
      workflow: {
        name: "ParallelPullRequestReview",
        title: "并行变更审查",
        description: "按安全、测试缺口和可维护性并行审查变更。",
        pluginName: "AgentWorkflowSkillsPlugin",
      },
      objective: "并行审查当前 PR。",
      execution: {
        mode: "plan",
        status: "readyForRuntime",
      },
      jobs: {
        item: [
          agentDelegationJobFixture("job_security", "SecurityReviewer", "安全审查代理"),
          agentDelegationJobFixture("job_test", "TestGapReviewer", "测试缺口代理"),
          agentDelegationJobFixture("job_maintainability", "MaintainabilityReviewer", "可维护性审查代理"),
        ],
      },
      jobCount: 3,
      mergePolicy: {
        name: "FindingsBySeverity",
        description: "将多个审查代理的发现按严重度、证据和文件位置合并。",
        strategy: "findings.bySeverity",
        templateFile: "System/Plugins/AgentWorkflowSkillsPlugin/merges/FindingsBySeverity.liquid",
        outputSchema: "System/Plugins/AgentWorkflowSkillsPlugin/schemas/FindingList.schema.json",
      },
    },
  },
  AskUserTool: {
    expectedKinds: [
      "clarification_request",
    ],
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
  const missingFixtures = tools
    .map((tool) => tool.name)
    .filter((name) => !fixtures[name]);
  assert.deepEqual(missingFixtures, [], `Missing artifact policy fixtures: ${missingFixtures.join(", ")}`);

  const missingPolicy = tools
    .filter((tool) => !tool.artifactPolicy)
    .map((tool) => tool.name);
  assert.deepEqual(missingPolicy, [], `Missing artifact policies: ${missingPolicy.join(", ")}`);

  const recorder = new AgentToolExecutionArtifactRecorder({
    workspaceRoot,
    config: resolveArtifactsConfig(config),
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
    assertEvidence(result.name, result.artifact.evidence, fixture);
    assertArtifactFiles(result.name, result.artifact);
  }

  const ledger = new AgentActionPlannerContextBuilder(workspaceRoot, artifactRoot)
    .advanceAfterToolResults({
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

  const expectedEvidenceTotal = Object.values(fixtures)
    .reduce((total, fixture) => total + (fixture.expectedEvidenceCount ?? fixture.expectedKinds.length), 0);
  assert.equal(ledger.evidence.length, expectedEvidenceTotal);
  assert.equal(
    ledger.deltas.filter((entry) => entry.op === "AddEvidence").length,
    expectedEvidenceTotal,
  );
  assertPlannerProjection(recorded, ledger);

  console.log("Plugin artifact policy verification passed.");
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
    assert.ok(rule.Presentation.RefPrefix.trim(), `${tool.name} evidence rule needs Presentation.RefPrefix`);
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
    assert.equal(entry.ref.trim().length > 0, true, `${toolName} evidence ref should not be empty`);
    assert.equal(entry.locator.trim().length > 0, true, `${toolName} evidence locator should not be empty`);
    assert.equal(entry.display.trim().length > 0, true, `${toolName} evidence display should not be empty`);
    assert.equal(entry.label.trim().length > 0, true, `${toolName} evidence label should not be empty`);
    assert.equal(entry.source.trim().length > 0, true, `${toolName} evidence source should not be empty`);
    assert.equal(entry.modelSlots.length > 0, true, `${toolName} evidence modelSlots should not be empty`);
    assert.equal(entry.plannerMemory.facts.length > 0, true, `${toolName} evidence plannerMemory facts should not be empty`);
    assert.equal(keys.has(entry.key), false, `${toolName} evidence key should be unique: ${entry.key}`);
    assert.equal(refs.has(entry.ref), false, `${toolName} evidence ref should be unique: ${entry.ref}`);
    keys.add(entry.key);
    refs.add(entry.ref);
  }
}

function assertArtifactFiles(
  toolName: string,
  artifact: NonNullable<ExecutedToolCallResult["artifact"]>,
): void {
  const evidenceText = fs.readFileSync(artifact.files.evidence, "utf8");
  const evidenceJson = JSON.parse(evidenceText) as {
    evidence?: Array<Record<string, unknown>>;
  };
  for (const entry of evidenceJson.evidence ?? []) {
    assert.equal(typeof entry.key, "string", `${toolName} evidence.json should retain internal key`);
    assert.equal(typeof entry.ref, "string", `${toolName} evidence.json should contain ref`);
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
    assert.equal(summary.includes(entry.ref) || projection.includes(entry.ref), true, `${toolName} visible artifact text should contain evidence ref`);
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
  assert.equal(xml.includes("<ref>"), true, "tool result XML should expose evidence ref");
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
  const plannerJson = JSON.stringify(input);
  const timelineJson = JSON.stringify(input.timeline);
  const timelineText = input.timeline.map((turn) => turn.content).join("\n");
  const runStateJson = JSON.stringify(input.runState);
  assert.equal(JSON.stringify(input.evidenceMemory).includes("\"key\""), false);
  assert.equal(timelineText.includes("key:"), false, "planner timeline should not expose internal key");
  assert.equal(timelineText.includes("artifactPath"), false, "planner timeline should not expose artifact absolute path");
  assert.equal(timelineText.includes("relativePath"), false, "planner timeline should not expose artifact relative path");
  assert.equal(timelineText.includes("ref:"), true, "planner timeline should expose evidence refs");
  assert.equal(timelineText.includes("slots:"), true, "planner timeline should expose projected slots");
  assert.equal(timelineText.includes("confidence:"), true, "planner timeline should expose confidence");
  assert.equal(timelineJson.includes("evidenceRefs"), true, "planner timeline should expose turn evidenceRefs");
  assert.equal(runStateJson.includes("\"ref\""), false, "planner runState should not duplicate evidence details");
  assert.equal(runStateJson.includes("\"slots\""), false, "planner runState should not duplicate evidence slots");

  const memoryEntries = createToolEvidenceMemoryEntries({
    requestId: "policy-verification",
    step: 1,
    results: recorded,
    timestamp: "2026-06-12T00:00:00.000Z",
  });
  const memoryJson = JSON.stringify(memoryEntries);
  assert.equal(memoryJson.includes("\"source\""), false, "planner memory should not duplicate evidence source");
  assert.equal(memoryJson.includes("\"summary\""), false, "planner memory should not duplicate artifact summary");
  assert.equal(memoryJson.includes("\"slots\""), false, "planner memory should not duplicate model slots");
  assert.equal(memoryJson.includes("\"snippet\""), false, "planner memory should not keep search snippets");
  assert.equal(memoryJson.includes("\"content\""), false, "planner memory should not keep web result content");
  assert.equal(memoryJson.includes("\"facts\""), true, "planner memory should expose compact facts");
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
    assert.equal(text.includes("RedactionKeyPatterns"), false, `${manifestPath} should not use global redaction key patterns`);
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

  return fs.readdirSync(root, { withFileTypes: true })
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

function agentDelegationJobFixture(
  jobId: string,
  agentName: string,
  agentTitle: string,
): Record<string, unknown> {
  return {
    jobId,
    index: 0,
    status: "planned",
    workflowName: "ParallelPullRequestReview",
    agentName,
    agentTitle,
    agentPluginName: "AgentWorkflowSkillsPlugin",
    agentDescriptionFile: `System/Plugins/AgentWorkflowSkillsPlugin/agents/${agentName}.md`,
    agentInstructionsFile: `System/Plugins/AgentWorkflowSkillsPlugin/agents/${agentName}.instructions.md`,
    taskFile: `System/Plugins/AgentWorkflowSkillsPlugin/tasks/${agentName}.md`,
    contextPack: "DiffFocusedReadOnly",
    contextPackDescription: "只给子代理当前变更、diff 证据、相关文件和审查目标。",
    contextTemplateFile: "System/Plugins/AgentWorkflowSkillsPlugin/contexts/DiffFocusedReadOnly.liquid",
    contextInputs: {
      item: [
        "latestUserRequest",
        "activeSkill",
        "workspaceDiff",
        "evidenceRefs",
        "artifactRefs",
      ],
    },
    toolScope: "agentRecommendedTools",
    historyPolicy: "none",
    artifactPolicy: "referencesOnly",
    evidencePolicy: "compact",
    recommendedTools: {
      item: [
        "FastContextHybridSearchTool",
        "FastContextReadTool",
      ],
    },
    runtimeProfile: "ReadOnlyReview",
    outputSchema: "System/Plugins/AgentWorkflowSkillsPlugin/schemas/FindingList.schema.json",
    required: true,
    suppliedEvidenceRefs: {
      item: [
        "DIFF1",
      ],
    },
    suppliedArtifactUris: {
      item: [
        "senera://artifact/art_1234567890abcdef12345678",
      ],
    },
  };
}

function searchResultFixture(
  query: string,
  source: "ripgrep" | "flexsearch" | "index" | "scan" | "path" | "symbol" | "combined",
): unknown {
  return {
    query,
    workspaceRoot,
    results: {
      item: [
        {
          path: "Source/AgentSystem/Artifacts/AgentToolExecutionArtifactRecorder.ts",
          startLine: 264,
          endLine: 291,
          line: 271,
          snippet: "function collectEvidence(value, policy) { ... }",
          score: 0.94,
          source,
          matches: {
            item: [
              "collectEvidence",
            ],
          },
          reason: "matches artifact evidence projection",
        },
        {
          path: "Source/AgentSystem/Schemas/PluginManifestSchema.ts",
          startLine: 55,
          endLine: 82,
          line: 61,
          snippet: "const ToolArtifactEvidenceSchema = z.object({ ... })",
          score: 0.88,
          source,
          matches: {
            item: [
              "ToolArtifactEvidenceSchema",
            ],
          },
          reason: "matches plugin manifest policy schema",
        },
      ],
    },
    warnings: {
      item: [],
    },
    availableRoots: {
      item: [
        workspaceRoot,
      ],
    },
    stats: {
      resultCount: 2,
      ripgrepMatchCount: source === "ripgrep" ? 2 : 0,
      queryPatternCount: 1,
      indexDocumentCount: 120,
      refreshedIndex: false,
      elapsedMs: 19,
    },
  };
}
