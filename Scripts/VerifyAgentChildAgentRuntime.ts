import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { AgentLoop } from "../Source/AgentSystem/AgentLoop.js";
import type { AgentActionPlanResult } from "../Source/AgentSystem/AgentActionPlanner.js";
import {
  AgentEventKinds,
  type AgentDomainEvent,
  type AgentEventContext,
} from "../Source/AgentSystem/AgentEvent.js";
import { resolveAgentDelegationRuntimeProfile } from "../Source/AgentSystem/AgentDefaults.js";
import { buildAgentDelegationPlan } from "../Source/AgentSystem/AgentDelegationPlan.js";
import { AgentChildAgentRuntime } from "../Source/AgentSystem/AgentChildAgentRuntime.js";
import { AgentDelegationExecutor } from "../Source/AgentSystem/AgentDelegationExecutor.js";
import type {
  AgentLanguageModel,
  AgentLanguageModelRequest,
  AgentLanguageModelResponse,
  AgentLanguageModelStream,
} from "../Source/AgentSystem/AgentLanguageModel.js";
import type { AgentModelProviderMetadata } from "../Source/AgentSystem/AgentModelMetadata.js";
import { AgentSystemRuntime } from "../Source/AgentSystem/AgentSystemRuntime.js";
import type { AgentSystemConfig } from "../Source/AgentSystem/Types.js";

const workspaceRoot = path.resolve(process.cwd());
const artifactRoot = ".senera/artifacts/child-loop-verification";
type PlannerInput = AgentActionPlanResult["input"];
type VerificationPlanner = {
  plan(options: { input: PlannerInput }): Promise<AgentActionPlanResult>;
};

async function main(): Promise<void> {
  const artifactRootPath = path.join(workspaceRoot, artifactRoot);
  fs.rmSync(artifactRootPath, { recursive: true, force: true });

  const config = verificationConfig();
  const runtime = AgentSystemRuntime.fromConfig({
    workspaceRoot,
    config,
  });
  const childLoopRuntimes: AgentSystemRuntime[] = [];

  try {
    const template = runtime.registry.getTemplate("ChildAgentSystemPrompt");
    assert.ok(template, "ChildAgentSystemPrompt should be registered");

    const plan = buildAgentDelegationPlan({
      workflow: "ParallelPullRequestReview",
      objective: "并行审查当前 PR 的安全、测试缺口和可维护性风险。",
      evidenceRefs: ["DIFF1"],
      artifactUris: ["senera://artifact/art_1234567890abcdef12345678"],
    }, {
      registry: runtime.registry,
      workspaceRoot,
    });
    const job = plan.jobs.item.find((entry) => entry.agentName === "SecurityReviewer");
    assert.ok(job, "SecurityReviewer job should exist");
    assert.equal(job.contextTemplateFile, "System/Plugins/AgentWorkflowSkillsPlugin/contexts/DiffFocusedReadOnly.liquid");

    const model = new FakeChildModel();
    const childRuntime = new AgentChildAgentRuntime({
      workspaceRoot,
      systemTemplateFile: template.path,
      model,
    });
    const result = await childRuntime.runJob({
      requestId: "child-runtime-verification",
      step: 1,
      plan,
      job,
      latestUserRequest: "请审查当前 PR 是否有安全风险。",
    });

    assert.equal(result.status, "completed");
    assert.equal(result.mode, "directModel");
    assert.equal(result.agentName, "SecurityReviewer");
    assert.equal(result.text, "{\"findings\":[]}");
    assert.equal(model.requests.length, 1);

    const request = model.requests[0];
    assert.ok(request);
    assert.equal(request.requestId, job.jobId);
    assert.equal(request.messages.length, 1);
    assert.equal(request.messages[0]?.role, "user");
    assert.equal(request.systemPrompt.includes("<senera_child_agent>"), true);
    assert.equal(request.systemPrompt.includes("SecurityReviewer"), true);
    assert.equal(request.systemPrompt.includes("Review changes for concrete security risks"), true);
    assert.equal(request.systemPrompt.includes("\"findings\""), true);
    assert.equal(request.messages[0]?.content.includes("DiffFocusedReadOnly"), true);
    assert.equal(request.messages[0]?.content.includes("请审查当前 PR 是否有安全风险。"), true);
    assert.equal(request.messages[0]?.content.includes("DIFF1"), true);
    assert.equal(request.messages[0]?.content.includes("senera://artifact/art_1234567890abcdef12345678"), true);

    const modelVisibleText = [
      request.systemPrompt,
      ...request.messages.map((message) => message.content),
    ].join("\n");
    assert.equal(modelVisibleText.includes(workspaceRoot), false);
    assert.equal(modelVisibleText.includes("conversationEntries"), false);
    assert.equal(modelVisibleText.includes("plannerLedger"), false);
    assert.equal(path.isAbsolute(result.prompt.files.systemTemplateFile), true);
    assert.equal(path.isAbsolute(result.prompt.files.contextTemplateFile), true);

    const scopedEvents: AgentDomainEvent[] = [];
    await new AgentChildAgentRuntime({
      workspaceRoot,
      systemTemplateFile: template.path,
      model: new EventingFakeChildModel(),
    }).runJob({
      requestId: "parent-run-for-scoped-events",
      step: 1,
      plan,
      job,
      latestUserRequest: "请审查当前 PR 是否有安全风险。",
      onEvent: (event) => {
        scopedEvents.push(event);
      },
    });
    assert.equal(scopedEvents.length, 1);
    const scopedContext = scopedEvents[0]?.context as AgentEventContext | undefined;
    assert.equal(scopedContext?.requestId, job.jobId);
    assert.equal(scopedContext?.scope?.parentRequestId, "parent-run-for-scoped-events");
    assert.equal(scopedContext?.scope?.workflowName, plan.workflow.name);
    assert.equal(scopedContext?.scope?.jobId, job.jobId);
    assert.equal(scopedContext?.scope?.agentName, job.agentName);
    assert.equal(scopedContext?.scope?.role, "childAgent");

    assert.equal(plan.schedule.strategy, "parallel");
    assert.equal(plan.schedule.maxConcurrency, 3);

    const executorModel = new ConcurrentFakeChildModel();
    const executor = new AgentDelegationExecutor({
      childRuntime: new AgentChildAgentRuntime({
        workspaceRoot,
        systemTemplateFile: template.path,
        model: executorModel,
      }),
    });
    const run = await executor.run({
      requestId: "child-runtime-sequential-verification",
      step: 1,
      plan,
      latestUserRequest: "请审查当前 PR 是否有安全、测试和维护风险。",
    });
    assert.equal(run.status, "completed");
    assert.equal(run.mode, "parallelDirectModel");
    assert.equal(run.schedule.strategy, "parallel");
    assert.equal(run.completedCount, 3);
    assert.equal(executorModel.maxActive > 1, true);
    assert.deepEqual(run.jobs.item.map((entry) => entry.agentName), [
      "SecurityReviewer",
      "TestGapReviewer",
      "MaintainabilityReviewer",
    ]);
    assert.equal(executorModel.requests.length, 3);

    const streamedModel = new QueuedStreamModel("delegate-review-model", [
      "<senera_tool_calls><tool_call><name>ToolSearchTool</name><arguments><query>workspace search capability</query></arguments></tool_call></senera_tool_calls>",
      "{\"findings\":[{\"title\":\"child loop used tools\",\"evidence\":[\"T1\"]}]}",
    ]);
    const providerIds: string[] = [];
    const childModelFactory = (providerId?: string) => {
      providerIds.push(providerId ?? "");
      return streamedModel;
    };
    const loopJob = {
      ...job,
      recommendedTools: {
        item: ["ToolSearchTool"],
      },
    };
    const agentLoopRuntime = new AgentChildAgentRuntime({
      workspaceRoot,
      systemTemplateFile: template.path,
      modelFactory: childModelFactory,
      runtimeProfileResolver: (profileName) =>
        resolveAgentDelegationRuntimeProfile(config, profileName),
      loopFactory: ({ modelProviderId, agentLoopConfig }) => {
        const childRuntime = AgentSystemRuntime.fromConfig({
          workspaceRoot,
          config,
          modelProviderId,
        });
        installPlanner(childRuntime);
        childLoopRuntimes.push(childRuntime);
        return new AgentLoop({
          runtime: childRuntime,
          model: childModelFactory(modelProviderId),
          agentLoopConfig,
        });
      },
    });
    const loopResult = await agentLoopRuntime.runJob({
      requestId: "child-agent-loop-verification",
      step: 1,
      plan,
      job: loopJob,
      latestUserRequest: "请审查当前 PR 是否有安全风险。",
    });

    assert.equal(loopResult.status, "completed");
    assert.equal(loopResult.mode, "agentLoop");
    assert.equal(loopResult.text, "{\"findings\":[{\"title\":\"child loop used tools\",\"evidence\":[\"T1\"]}]}");
    assert.equal(loopResult.loopResult?.terminal.kind, "FinalAnswer");
    assert.equal(streamedModel.requests.length, 2);
    assert.deepEqual(providerIds, ["delegate-review-model"]);
    assert.equal(streamedModel.requests[0]?.systemPrompt.includes("<senera_child_agent>"), true);
    assert.equal(streamedModel.requests[0]?.systemPrompt.includes("<decision_protocol>"), true);
    assert.equal(streamedModel.requests[0]?.systemPrompt.includes("ToolSearchTool"), true);
    assert.equal(streamedModel.requests[0]?.messages[0]?.content.includes("DiffFocusedReadOnly"), true);
    assert.equal(
      loopResult.loopResult?.conversationEntries.some((entry) => entry.kind === "context.tool_results"),
      true,
    );

    console.log("Agent child-agent runtime verification passed.");
  } finally {
    runtime.toolSearch.close();
    for (const childRuntime of childLoopRuntimes) {
      childRuntime.toolSearch.close();
    }
    fs.rmSync(artifactRootPath, { recursive: true, force: true });
  }
}

class FakeChildModel implements AgentLanguageModel {
  readonly metadata: AgentModelProviderMetadata = {
    id: "fake-child-model",
    kind: "Fake",
    endpoint: "Complete",
    baseUrl: "memory://fake",
    model: "fake-child-model",
  };

  readonly requests: AgentLanguageModelRequest[] = [];

  async complete(request: AgentLanguageModelRequest): Promise<AgentLanguageModelResponse> {
    this.requests.push(request);
    return {
      text: "{\"findings\":[]}",
    };
  }

  async stream(_request: AgentLanguageModelRequest): Promise<AgentLanguageModelStream> {
    throw new Error("FakeChildModel.stream is not used by this verification.");
  }
}

class ConcurrentFakeChildModel extends FakeChildModel {
  active = 0;
  maxActive = 0;

  override async complete(request: AgentLanguageModelRequest): Promise<AgentLanguageModelResponse> {
    this.requests.push(request);
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    await new Promise((resolve) => setTimeout(resolve, 10));
    this.active -= 1;
    return {
      text: "{\"findings\":[]}",
    };
  }
}

class EventingFakeChildModel extends FakeChildModel {
  override async complete(request: AgentLanguageModelRequest): Promise<AgentLanguageModelResponse> {
    await request.onEvent?.({
      kind: AgentEventKinds.ModelStarted,
      context: {
        requestId: request.requestId,
        step: request.step,
      },
      data: {
        model: this.metadata.model,
        provider: this.metadata,
      },
    });
    return super.complete(request);
  }
}

class QueuedStreamModel implements AgentLanguageModel {
  readonly metadata: AgentModelProviderMetadata;
  readonly requests: AgentLanguageModelRequest[] = [];

  constructor(
    model: string,
    private readonly responses: readonly string[],
  ) {
    this.metadata = {
      id: model,
      kind: "Fake",
      endpoint: "Stream",
      baseUrl: "memory://fake",
      model,
    };
  }

  async complete(_request: AgentLanguageModelRequest): Promise<AgentLanguageModelResponse> {
    throw new Error("QueuedStreamModel.complete is not used by this verification.");
  }

  async stream(request: AgentLanguageModelRequest): Promise<AgentLanguageModelStream> {
    this.requests.push(request);
    const text = this.responses[this.requests.length - 1];
    if (text === undefined) {
      throw new Error("QueuedStreamModel 缺少响应。");
    }

    return {
      metadata: this.metadata,
      abort: () => {},
      async *[Symbol.asyncIterator]() {
        yield {
          textDelta: text,
          accumulatedText: text,
        };
      },
    };
  }
}

function installPlanner(runtime: AgentSystemRuntime): void {
  let calls = 0;
  (runtime as unknown as { actionPlanner: VerificationPlanner }).actionPlanner = {
    plan: async ({ input }) => {
      calls += 1;
      return calls === 1
        ? useToolsPlan(input)
        : answerPlan(input);
    },
  };
}

function useToolsPlan(input: PlannerInput): AgentActionPlanResult {
  return {
    kind: "planned",
    input,
    selectedAction: "use_tools",
    selectionRepaired: false,
    payloadRepaired: false,
    decision: {
      action: "use_tools",
      useTools: {
        preferredTools: ["ToolSearchTool"],
        instruction: "Search the registered tool catalog for workspace search capability.",
        needs: [],
      },
    },
  };
}

function answerPlan(input: PlannerInput): AgentActionPlanResult {
  return {
    kind: "planned",
    input,
    selectedAction: "answer",
    selectionRepaired: false,
    payloadRepaired: false,
    decision: {
      action: "answer",
    },
  };
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
    ModelProviders: [{
      Id: "delegate-default-model",
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
    }, {
      Id: "delegate-review-model",
      Kind: "OpenAICompatible",
      Endpoint: "Responses",
      BaseUrl: "https://example.invalid/v1",
      ApiKey: "test",
      Model: "delegate-review-model",
      Temperature: 0,
      MaxOutputTokens: -1,
      Stream: true,
      TimeoutMs: 1,
      MaxNetworkRetries: 0,
    }],
    AgentDelegation: {
      RuntimeProfileDefaults: {
        Mode: "agentLoop",
        ModelProviderId: "delegate-default-model",
        AgentLoop: {
          MaxSteps: 4,
          MaxRepairAttempts: 1,
          LoadedTools: "dynamic",
        },
      },
      RuntimeProfiles: {
        ReadOnlyReview: {
          ModelProviderId: "delegate-review-model",
        },
      },
      Merge: {
        ModelProviderId: "delegate-default-model",
      },
    },
    Artifacts: {
      RootDir: artifactRoot,
      SummaryMaxChars: 3200,
      RawJsonMaxBytes: 1048576,
      TextFileMaxBytes: 262144,
    },
  };
}

void main();
