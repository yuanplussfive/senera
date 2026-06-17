import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { readArtifactMemoryHostTool } from "../Source/AgentSystem/AgentArtifactMemoryRuntime.js";
import { resolveArtifactsConfig } from "../Source/AgentSystem/AgentDefaults.js";
import { AgentToolExecutionArtifactRecorder } from "../Source/AgentSystem/Artifacts/AgentToolExecutionArtifactRecorder.js";
import {
  createAgentArtifactUri,
  normalizeAgentArtifactUri,
} from "../Source/AgentSystem/Artifacts/AgentArtifactLocator.js";
import type {
  AgentSystemConfig,
  RegisteredTool,
  ToolArtifactPolicyManifest,
} from "../Source/AgentSystem/Types.js";

const workspaceRoot = path.resolve(process.cwd());
const artifactRoot = ".senera/artifacts/memory-read-verification";

const config: AgentSystemConfig = {
  PluginRoots: {
    System: [],
    User: [],
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

const artifactMemoryTool: RegisteredTool = {
  plugin: {
    rootPath: path.join(workspaceRoot, "System", "Plugins", "AgentArtifactMemoryPlugin"),
    rootKind: "System",
    manifestPath: path.join(workspaceRoot, "System", "Plugins", "AgentArtifactMemoryPlugin", "PluginManifest.json"),
    config: {
      fileName: "PluginConfig.toml",
      path: path.join(workspaceRoot, "System", "Plugins", "AgentArtifactMemoryPlugin", "PluginConfig.toml"),
      exists: true,
      source: "file",
      templateExists: false,
      needsUserConfig: false,
      toml: "[senera]\nenabled = true\n",
      sections: [],
      runtime: {
        enabled: true,
        tools: {},
      },
      diagnostics: [],
    },
    manifest: {
      Plugin: {
        Name: "AgentArtifactMemoryPlugin",
        Version: "0.1.0",
        Kind: "Tool",
      },
    },
  },
  name: "ArtifactMemoryReadTool",
  permissions: [
    "filesystem:read:artifacts",
  ],
  handler: {
    kind: "HostCapability",
    capability: "artifact.memory.read",
  },
};

async function main(): Promise<void> {
  const absoluteArtifactRoot = path.join(workspaceRoot, artifactRoot);
  fs.rmSync(absoluteArtifactRoot, { recursive: true, force: true });

  const recorder = new AgentToolExecutionArtifactRecorder({
    workspaceRoot,
    config: resolveArtifactsConfig(config),
  });
  const recorded = await recorder.record({
    requestId: "artifact-memory-read",
    step: 1,
    results: [{
      callId: "call-weather",
      name: "WeatherTool",
      arguments: {
        location: "Shanghai, China",
      },
      process: {
        exitCode: 0,
        signal: null,
        stderr: "",
      },
      result: {
        resolvedLocation: "Shanghai, China",
        forecast: {
          item: [{
            date: "2026-06-12",
            condition: "Cloudy",
            localPath: path.join(workspaceRoot, "Source", "AgentSystem", "Types.ts"),
          }],
        },
        source: "WeatherAPI",
      },
      artifactPolicy: weatherArtifactPolicy,
    }],
  });

  const artifact = recorded[0]?.artifact;
  assert.ok(artifact);
  assert.equal(artifact.artifactUri, createAgentArtifactUri(artifact.artifactId));
  assert.equal(fs.existsSync(artifact.files.projection), true);

  const defaultRead = readOkToolResult(await readArtifactMemoryHostTool({
    artifactUris: {
      item: [
        artifact.artifactUri,
      ],
    },
  }, hostContext()));
  assert.equal(defaultRead.artifacts.item.length, 1);
  assert.equal(defaultRead.artifacts.item[0]?.status, "found");
  assert.deepEqual(defaultRead.artifacts.item[0]?.memories.item.map((entry) => entry.ref), ["projection"]);
  assert.equal(defaultRead.artifacts.item[0]?.memories.item[0]?.content.includes("weather forecast"), true);
  assert.equal(JSON.stringify(defaultRead).includes(workspaceRoot), false);

  const legacyUri = `urn:senera:artifact:${artifact.artifactId}`;
  assert.equal(normalizeAgentArtifactUri(legacyUri), artifact.artifactUri);
  const batchRead = readOkToolResult(await readArtifactMemoryHostTool({
    artifactUris: {
      item: [
        legacyUri,
        artifact.artifactUri,
      ],
    },
    refs: {
      item: [
        "projection",
        "evidence",
        "raw",
      ],
    },
  }, hostContext()));
  assert.equal(batchRead.artifacts.item.length, 2);
  assert.equal(batchRead.artifacts.item[0]?.artifactUri, artifact.artifactUri);
  assert.equal(batchRead.artifacts.item[1]?.artifactUri, artifact.artifactUri);
  assert.equal(batchRead.artifacts.item.every((entry) => entry.memoryCount === 3), true);
  assert.equal(JSON.stringify(batchRead).includes(workspaceRoot), false);
  assert.equal(JSON.stringify(batchRead).includes("Source/AgentSystem/Types.ts"), true);
  assert.equal(JSON.stringify(batchRead).includes("artifactPath"), false);

  const invalidRead = readOkToolResult(await readArtifactMemoryHostTool({
    artifactUris: {
      item: [
        "artifact://old/path-style",
      ],
    },
  }, hostContext()));
  assert.equal(invalidRead.artifacts.item[0]?.status, "invalid");

  console.log("Artifact memory read tool verification passed.");
  fs.rmSync(absoluteArtifactRoot, { recursive: true, force: true });
}

function hostContext(): Parameters<typeof readArtifactMemoryHostTool>[1] {
  return {
    tool: artifactMemoryTool,
    config,
    workspaceRoot,
    registry: {
      getTool: (name) => name === artifactMemoryTool.name ? artifactMemoryTool : undefined,
    },
  };
}

function readOkToolResult(result: Awaited<ReturnType<typeof readArtifactMemoryHostTool>>): ArtifactMemoryReadResult {
  assert.equal(result.response.ok, true, result.response.error?.message);
  assert.ok(result.response.result);
  return result.response.result as ArtifactMemoryReadResult;
}

interface ArtifactMemoryReadResult {
  artifacts: {
    item: Array<{
      artifactUri: string;
      status: string;
      memories: {
        item: Array<{
          ref: string;
          content: string;
        }>;
      };
      memoryCount: number;
    }>;
  };
}

const weatherArtifactPolicy: ToolArtifactPolicyManifest = {
  Evidence: [{
    Kind: "weather_forecast_day",
    Records: "$.forecast.item[*]",
    Slots: {
      resolvedLocation: {
        Selector: "$.resolvedLocation",
        Scope: "Root",
      },
      date: "$.date",
      condition: "$.condition",
      localPath: "$.localPath",
      source: {
        Selector: "$.source",
        Scope: "Root",
      },
    },
    Identity: {
      Parts: [
        "resolvedLocation",
        "date",
      ],
    },
    Presentation: {
      RefPrefix: "WTH",
      Locator: "{{ resolvedLocation }} @ {{ date }}",
      Display: "forecast for {{ resolvedLocation }} on {{ date }}: {{ condition }}",
      Label: "{{ resolvedLocation }} forecast {{ date }}",
      Source: "{{ source }}",
    },
    ModelProjection: {
      Slots: [
        "resolvedLocation",
        "date",
        "condition",
      ],
    },
    PlannerMemory: {
      Facts: [
        "resolvedLocation",
        "date",
        "condition",
      ],
      ArtifactRefs: [
        "evidence",
        "projection",
      ],
    },
    Projection: {
      SummaryTemplate: "{% for e in evidence %}- {{ e.ref }} {{ e.display }}\n{% endfor %}",
      ArtifactTemplate: "{% for e in evidence %}- {{ e.ref }} weather forecast\n  location: {{ e.slots.resolvedLocation }}\n  date: {{ e.slots.date }}\n  condition: {{ e.slots.condition }}\n{% endfor %}",
    },
    Confidence: 0.8,
  }],
  Summary: {
    Template: "{% for block in projections %}{{ block.summary }}\n{% endfor %}",
    ArtifactTemplate: "{% for block in projections %}{{ block.artifact }}\n{% endfor %}",
  },
};

void main();
