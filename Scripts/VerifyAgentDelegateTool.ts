import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { AgentSystemRuntime } from "../Source/AgentSystem/Runtime/AgentSystemRuntime.js";
import { AgentToolRunner } from "../Source/AgentSystem/ToolRuntime/AgentToolRunner.js";
import { createDefaultHostCapabilityRegistry } from "../Source/AgentSystem/AgentDefaultHostCapabilities.js";
import type { AgentSystemConfig } from "../Source/AgentSystem/Types/AgentConfigTypes.js";

const workspaceRoot = path.resolve(process.cwd());
const artifactRoot = ".senera/artifacts/delegate-verification";

void main();

async function main(): Promise<void> {
  const artifactRootPath = path.join(workspaceRoot, artifactRoot);
  fs.rmSync(artifactRootPath, { recursive: true, force: true });

  const runtime = AgentSystemRuntime.fromConfig({
    workspaceRoot,
    config: verificationConfig(),
  });

  try {
    const tool = runtime.registry.getTool("AgentDelegateTool");
    assert.ok(tool, "AgentDelegateTool should be registered");
    assert.equal(tool.handler.kind, "HostCapability");
    assert.equal(tool.handler.capability, "agent.delegate");

    const discovered = runtime.toolSearch.search({
      query: "请用子代理并行审查当前 PR 的安全、测试缺口和可维护性。",
      includeLoaded: true,
      loadedToolNames: [],
    });
    assert.ok(
      discovered.some((entry) => entry.toolName === "AgentDelegateTool"),
      "tool search should discover AgentDelegateTool for subagent workflow tasks",
    );

    const activeSkills = runtime.skillActivation.activate({
      input: "请用子代理并行审查当前 PR 的安全、测试缺口和可维护性。",
    });
    assert.ok(
      activeSkills.some((skill) => skill.name === "PullRequestReviewSkill"),
      "PR review requests should activate PullRequestReviewSkill",
    );
    assert.ok(
      activeSkills.some((skill) => skill.name === "WorkspaceInvestigationSkill"),
      "PR review requests should also activate workspace investigation guidance",
    );
    assert.ok(
      runtime.skillActivation.recommendedToolNames(activeSkills).includes("AgentDelegateTool"),
      "workflow skill should recommend AgentDelegateTool",
    );

    const loadedToolNames = runtime.toolSearch.resolvePlannedLoadedTools({
      input: "请用子代理并行审查当前 PR 的安全、测试缺口和可维护性。",
      loadedTools: "dynamic",
      currentLoadedTools: ["ToolSearchTool"],
      preferredTools: runtime.skillActivation.recommendedToolNames(activeSkills),
    });
    if (loadedToolNames === "all") {
      throw new Error("dynamic tool loading unexpectedly returned all tools");
    }
    assert.ok(
      loadedToolNames.includes("AgentDelegateTool"),
      "dynamic tool loading should include AgentDelegateTool from workflow skill recommendations",
    );

    const runner = new AgentToolRunner(
      runtime.config,
      runtime.xmlPolicy.protocol,
      workspaceRoot,
      createDefaultHostCapabilityRegistry({ toolSearch: runtime.toolSearch }),
      runtime.registry,
    );
    const args = {
      workflow: "ParallelPullRequestReview",
      objective: "并行审查当前 PR 的安全、测试缺口和可维护性风险。",
      evidenceUris: {
        item: ["DIFF1"],
      },
      artifactUris: {
        item: ["senera://artifact/art_0123456789abcdef01234567"],
      },
    };
    const execution = await runner.run(tool, args, {
      requestId: "delegate-verification",
      step: 1,
      visibleToolNames: loadedToolNames,
    });
    assert.equal(execution.response.ok, true, execution.response.error?.message);

    const result = execution.response.result as AgentDelegateToolResult;
    assert.equal(result.execution.mode, "plan");
    assert.equal(result.schedule.strategy, "parallel");
    assert.equal(result.schedule.maxConcurrency, 3);
    assert.equal(result.workflow.name, "ParallelPullRequestReview");
    assert.equal(result.jobCount, 3);
    assert.deepEqual(result.jobs.item.map((job) => job.agentName), [
      "SecurityReviewer",
      "TestGapReviewer",
      "MaintainabilityReviewer",
    ]);
    assert.ok(result.jobs.item.every((job) => job.contextPack === "DiffFocusedReadOnly"));
    assert.ok(result.jobs.item.every((job) => job.suppliedEvidenceUris.item.includes("DIFF1")));
    assert.ok(JSON.stringify(result).includes(workspaceRoot) === false);

    const recorded = await runtime.artifactRecorder.record({
      requestId: "delegate-verification",
      step: 1,
      results: [{
        callId: "call-delegate",
        name: tool.name,
        arguments: args,
        process: {
          exitCode: execution.exitCode,
          signal: execution.signal,
          stderr: execution.stderr,
        },
        result,
        artifactPolicy: tool.artifactPolicy,
      }],
    });
    const artifact = recorded[0]?.artifact;
    assert.ok(artifact, "delegation plan should be recorded as an artifact");
    assert.equal(artifact.evidence.length, 3);
    assert.deepEqual(artifact.evidence.map((entry) => entry.kind), [
      "agent_delegation_job",
      "agent_delegation_job",
      "agent_delegation_job",
    ]);
    assert.equal(fs.existsSync(artifact.files.summary), true);
    assert.equal(fs.existsSync(artifact.files.projection), true);
    assert.equal(fs.existsSync(artifact.files.evidence), true);
    assert.equal(fs.readFileSync(artifact.files.summary, "utf8").includes("SecurityReviewer planned"), true);
    assert.equal(fs.readFileSync(artifact.files.projection, "utf8").includes("DiffFocusedReadOnly"), true);
    assert.equal(fs.readFileSync(artifact.files.projection, "utf8").includes(workspaceRoot), false);

    const runArtifactRecords = await runtime.artifactRecorder.record({
      requestId: "delegate-run-verification",
      step: 1,
      results: [{
        callId: "call-delegate-run",
        name: tool.name,
        arguments: {
          ...args,
          executionMode: "run",
        },
        process: {
          exitCode: execution.exitCode,
          signal: execution.signal,
          stderr: execution.stderr,
        },
        result: buildSyntheticRunResult(result),
        artifactPolicy: tool.artifactPolicy,
      }],
    });
    const runArtifact = runArtifactRecords[0]?.artifact;
    assert.ok(runArtifact, "delegation run should be recorded as an artifact");
    assert.deepEqual(runArtifact.evidence.map((entry) => entry.kind), [
      "agent_delegation_job",
      "agent_delegation_job",
      "agent_delegation_job",
      "agent_child_result",
      "agent_merge_result",
    ]);
    assert.equal(fs.readFileSync(runArtifact.files.summary, "utf8").includes("SecurityReviewer completed"), true);
    assert.equal(fs.readFileSync(runArtifact.files.summary, "utf8").includes("FindingsBySeverity merged"), true);

    console.log("Agent delegate tool verification passed.");
  } finally {
    runtime.toolSearch.close();
    fs.rmSync(artifactRootPath, { recursive: true, force: true });
  }
}

function verificationConfig(): AgentSystemConfig {
  return {
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
    ModelProviderEndpoints: [{
      Id: "test",
      BaseUrl: "https://example.invalid/v1",
      ApiKey: "test",
    }],
    ModelProviders: [{
      Id: "test",
      ProviderId: "test",
      Endpoint: "Responses",
      Model: "test",
      Temperature: 0,
      MaxOutputTokens: -1,
      Stream: true,
      TimeoutSeconds: 0.001,
      MaxNetworkRetries: 0,
    }],
    Artifacts: {
      RootDir: artifactRoot,
      SummaryMaxChars: 3200,
      RawJsonMaxBytes: 1048576,
      TextFileMaxBytes: 262144,
    },
  };
}

interface AgentDelegateToolResult {
  workflow: {
    name: string;
  };
  execution: {
    mode: "plan";
  };
  schedule: {
    strategy: "parallel" | "sequential";
    maxConcurrency?: number;
  };
  jobs: {
    item: Array<{
      agentName: string;
      contextPack: string;
      jobId: string;
      workflowName: string;
      suppliedEvidenceUris: {
        item: string[];
      };
    }>;
  };
  jobCount: number;
  mergePolicy: {
    name: string;
  };
}

function buildSyntheticRunResult(plan: AgentDelegateToolResult) {
  const child = plan.jobs.item[0];
  if (!child) {
    throw new Error("Synthetic run fixture requires at least one delegation job.");
  }

  return {
    ...plan,
    execution: {
      mode: "agentLoop",
      status: "completed",
    },
    run: {
      workflowName: plan.workflow.name,
      status: "completed",
      mode: "parallelAgentLoopWithMerge",
      delegation: {
        workflowName: plan.workflow.name,
        status: "completed",
        mode: "parallelAgentLoop",
        schedule: plan.schedule,
        completedCount: 1,
        jobs: {
          item: [{
            jobId: child.jobId,
            workflowName: child.workflowName,
            agentName: child.agentName,
            status: "completed",
            mode: "agentLoop",
            text: "{\"findings\":[]}",
            loopResult: {
              terminal: {
                kind: "FinalAnswer",
                content: "{\"findings\":[]}",
              },
            },
          }],
        },
      },
      merge: {
        workflowName: plan.workflow.name,
        mergePolicyName: plan.mergePolicy.name,
        status: "completed",
        mode: "directModel",
        text: "{\"findings\":[]}",
      },
    },
  };
}
