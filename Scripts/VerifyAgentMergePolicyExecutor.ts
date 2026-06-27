import assert from "node:assert/strict";
import path from "node:path";
import { AgentChildAgentRuntime } from "../Source/AgentSystem/AgentChildAgentRuntime.js";
import { AgentDelegationExecutor } from "../Source/AgentSystem/AgentDelegationExecutor.js";
import { AgentDelegationWorkflowRunner } from "../Source/AgentSystem/AgentDelegationWorkflowRunner.js";
import { buildAgentDelegationPlan } from "../Source/AgentSystem/AgentDelegationPlan.js";
import {
  AgentEventKinds,
  type AgentDomainEvent,
  type AgentEventContext,
} from "../Source/AgentSystem/AgentEvent.js";
import { AgentMergePolicyExecutor } from "../Source/AgentSystem/AgentMergePolicyExecutor.js";
import type {
  AgentLanguageModel,
  AgentLanguageModelRequest,
  AgentLanguageModelResponse,
  AgentLanguageModelStream,
} from "../Source/AgentSystem/AgentLanguageModel.js";
import type { AgentModelProviderMetadata } from "../Source/AgentSystem/AgentModelMetadata.js";
import { AgentSystemRuntime } from "../Source/AgentSystem/AgentSystemRuntime.js";
import type { AgentSystemConfig } from "../Source/AgentSystem/Types/AgentConfigTypes.js";

const workspaceRoot = path.resolve(process.cwd());

async function main(): Promise<void> {
  const runtime = AgentSystemRuntime.fromConfig({
    workspaceRoot,
    config: verificationConfig(),
  });

  try {
    const childTemplate = runtime.registry.getTemplate("ChildAgentSystemPrompt");
    const mergeTemplate = runtime.registry.getTemplate("AgentMergeSystemPrompt");
    assert.ok(childTemplate, "ChildAgentSystemPrompt should be registered");
    assert.ok(mergeTemplate, "AgentMergeSystemPrompt should be registered");

    const plan = buildAgentDelegationPlan({
      workflow: "ParallelPullRequestReview",
      objective: "并行审查当前 PR 的安全、测试缺口和可维护性风险。",
      evidenceUris: ["DIFF1"],
    }, {
      registry: runtime.registry,
      workspaceRoot,
    });
    assert.equal(plan.mergePolicy.templateFile, "System/Plugins/AgentWorkflowSkillsPlugin/merges/FindingsBySeverity.liquid");
    assert.equal(plan.mergePolicy.outputSchema, "System/Plugins/AgentWorkflowSkillsPlugin/schemas/FindingList.schema.json");

    const childModel = new QueuedResponseModel(
      "fake-child-model",
      plan.jobs.item.map((job) =>
        `{"findings":[{"title":"${job.agentName} finding","severity":"low","evidence":["DIFF1"]}]}`),
    );
    const delegationExecutor = new AgentDelegationExecutor({
      childRuntime: new AgentChildAgentRuntime({
        workspaceRoot,
        systemTemplateFile: childTemplate.path,
        model: childModel,
      }),
    });
    const mergeModel = new QueuedResponseModel("fake-merge-model", [
      "{\"findings\":[{\"title\":\"merged\",\"severity\":\"low\",\"evidence\":[\"DIFF1\"]}]}",
    ]);
    const mergeExecutor = new AgentMergePolicyExecutor({
      workspaceRoot,
      systemTemplateFile: mergeTemplate.path,
      model: mergeModel,
    });
    const scopedEvents: AgentDomainEvent[] = [];
    const workflowRun = await new AgentDelegationWorkflowRunner({
      delegationExecutor,
      mergeExecutor,
    }).run({
      requestId: "merge-policy-verification",
      step: 1,
      plan,
      latestUserRequest: "请审查当前 PR 是否有安全、测试和维护风险。",
      onEvent: (event) => {
        scopedEvents.push(event);
      },
    });

    assert.equal(workflowRun.status, "completed");
    assert.equal(workflowRun.mode, "parallelDirectModelWithMerge");
    assert.equal(workflowRun.delegation.schedule.strategy, "parallel");
    assert.equal(workflowRun.delegation.completedCount, 3);
    const merge = workflowRun.merge;
    assert.equal(merge.status, "completed");
    assert.equal(merge.mode, "directModel");
    assert.equal(merge.workflowName, "ParallelPullRequestReview");
    assert.equal(merge.mergePolicyName, "FindingsBySeverity");
    assert.equal(merge.text, "{\"findings\":[{\"title\":\"merged\",\"severity\":\"low\",\"evidence\":[\"DIFF1\"]}]}");
    assert.equal(mergeModel.requests.length, 1);
    const scopedContexts = scopedEvents.map((event) => event.context as AgentEventContext);
    assert.equal(scopedContexts.filter((context) => context.scope?.role === "childAgent").length, 3);
    assert.equal(scopedContexts.filter((context) => context.scope?.role === "merge").length, 1);
    const scopedOnlyContexts = scopedContexts.filter((context) => context.scope);
    assert.equal(
      scopedOnlyContexts.every((context) => context.scope?.parentRequestId === "merge-policy-verification"),
      true,
    );

    const request = mergeModel.requests[0];
    assert.ok(request);
    assert.equal(request.requestId, "merge-policy-verification");
    assert.equal(request.systemPrompt.includes("<senera_agent_merge>"), true);
    assert.equal(request.systemPrompt.includes("FindingsBySeverity"), true);
    assert.equal(request.systemPrompt.includes("\"findings\""), true);
    assert.equal(request.messages.length, 1);
    assert.equal(request.messages[0]?.content.includes("<merge_task name=\"FindingsBySeverity\">"), true);
    assert.equal(request.messages[0]?.content.includes("SecurityReviewer finding"), true);
    assert.equal(request.messages[0]?.content.includes("TestGapReviewer finding"), true);
    assert.equal(request.messages[0]?.content.includes("MaintainabilityReviewer finding"), true);
    assert.equal(request.messages[0]?.content.includes("DIFF1"), true);

    const visibleText = [
      request.systemPrompt,
      ...request.messages.map((message) => message.content),
    ].join("\n");
    assert.equal(visibleText.includes(workspaceRoot), false);
    assert.equal(visibleText.includes("conversationEntries"), false);
    assert.equal(visibleText.includes("plannerLedger"), false);
    assert.equal(path.isAbsolute(merge.prompt.files.systemTemplateFile), true);
    assert.equal(path.isAbsolute(merge.prompt.files.mergeTemplateFile), true);
    assert.equal(path.isAbsolute(merge.prompt.files.outputSchemaFile), true);

    console.log("Agent merge policy executor verification passed.");
  } finally {
    runtime.toolSearch.close();
  }
}

class QueuedResponseModel implements AgentLanguageModel {
  readonly metadata: AgentModelProviderMetadata;

  readonly requests: AgentLanguageModelRequest[] = [];

  constructor(
    model: string,
    private readonly responses: readonly string[],
  ) {
    this.metadata = {
      id: model,
      kind: "Fake",
      endpoint: "Complete",
      baseUrl: "memory://fake",
      model,
    };
  }

  async complete(request: AgentLanguageModelRequest): Promise<AgentLanguageModelResponse> {
    this.requests.push(request);
    const responseIndex = this.requests.length - 1;
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
    const response = this.responses[responseIndex];
    if (response === undefined) {
      throw new Error("QueuedResponseModel 缺少响应。");
    }

    return {
      text: response,
    };
  }

  async stream(_request: AgentLanguageModelRequest): Promise<AgentLanguageModelStream> {
    throw new Error("QueuedResponseModel.stream is not used by this verification.");
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
  };
}

void main();
