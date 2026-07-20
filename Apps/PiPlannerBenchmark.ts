import path from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";
import { resolveActionPlannerConfig, resolveModelProviderConfig } from "../Source/AgentSystem/AgentDefaults.js";
import { AgentActionPlannerModelClient } from "../Source/AgentSystem/ActionPlanner/AgentActionPlannerModelClient.js";
import { projectPreparedInteractionRoute } from "../Source/AgentSystem/ActionPlanner/AgentInteractionRouter.js";
import type { AgentRootCommand } from "../Source/AgentSystem/AgentRootCommand.js";
import type { ActionPlanInput } from "../Source/AgentSystem/BamlClient/baml_client/types.js";
import { AgentConfigLoader } from "../Source/AgentSystem/Config/AgentConfigLoader.js";
import type { AgentModelTimingRecord } from "../Source/AgentSystem/ModelEndpoints/AgentModelTiming.js";
import type { AgentBamlStructuredOutputTraceEvent } from "../Source/AgentSystem/BamlClient/AgentBamlStructuredOutputRunner.js";
import { AgentPiAssistantCompiler } from "../Source/AgentSystem/PiProxy/AgentPiAssistantCompiler.js";
import { AgentPiFinalAnswerGenerator } from "../Source/AgentSystem/PiProxy/AgentPiFinalAnswerGenerator.js";
import { AgentPiPreparedActionLease } from "../Source/AgentSystem/PiProxy/AgentPiPreparedActionLease.js";
import { AgentSystemRuntime } from "../Source/AgentSystem/Runtime/AgentSystemRuntime.js";
import type { AgentPiToolCard } from "../Source/AgentSystem/PiProxy/AgentPiAssistantMessageTypes.js";
import type { PiOpenAiTool } from "../Source/AgentSystem/PiProxy/AgentPiOpenAiWireTypes.js";

const BenchmarkDefaults = {
  configFile: "senera.config.json",
  iterations: 1,
  maximumIterations: 10,
  prompt: "判断当前请求是否需要工具；当前没有可用工具。",
  stage: "select-action" as const,
} as const;

type BenchmarkStage =
  "prepare-interaction" | "select-action" | "direct-flow" | "cached-direct-flow" | "prepared-flow" | "both";

const argumentsSchema = {
  workspace: { type: "string" },
  config: { type: "string" },
  "planning-model-provider-id": { type: "string" },
  iterations: { type: "string" },
  prompt: { type: "string" },
  stage: { type: "string", default: BenchmarkDefaults.stage },
} as const;

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const { values } = parseArgs({ options: argumentsSchema, allowPositionals: false });
  const workspaceRoot = path.resolve(values.workspace ?? process.cwd());
  const configPath = path.resolve(workspaceRoot, values.config ?? BenchmarkDefaults.configFile);
  const config = AgentConfigLoader.load(configPath);
  const provider = resolveModelProviderConfig(config);
  const planningProviderId = values["planning-model-provider-id"];
  const benchmarkConfig = planningProviderId
    ? {
        ...config,
        ActionPlanner: {
          ...config.ActionPlanner,
          PlanningClient: {
            ...config.ActionPlanner?.PlanningClient,
            ModelProviderId: planningProviderId,
          },
        },
      }
    : config;
  const plannerConfig = resolveActionPlannerConfig(benchmarkConfig, provider.Id);
  const planningProvider = plannerConfig.PlanningClient.ModelProvider;
  const timings: AgentModelTimingRecord[] = [];
  const structuredAttempts: Array<{
    functionName: string;
    phase: string;
    status: string;
    issues: string[];
    rawOutputPreview?: string;
  }> = [];
  const iterations = parseIterations(values.iterations);
  const prompt = values.prompt?.trim() || BenchmarkDefaults.prompt;
  const stage = parseStage(values.stage);
  const candidates = await projectBenchmarkCandidateTools(workspaceRoot, configPath, prompt);
  const results: Array<{ stage: string; outcome: string }> = [];
  const directFlows: Array<{ firstOutputMs?: number; durationMs: number; responseCharacters: number }> = [];
  const plannerClient = new AgentActionPlannerModelClient(provider, plannerConfig.PlanningClient, {
    maxRepairAttempts: plannerConfig.MaxRepairAttempts,
    traceSink: {
      record: async (event: AgentBamlStructuredOutputTraceEvent) => {
        structuredAttempts.push({
          functionName: event.functionName,
          phase: event.phase,
          status: event.status,
          issues: [...event.issues],
          rawOutputPreview: event.status === "failed" ? event.rawOutput?.slice(0, 1_000) : undefined,
        });
      },
    },
    timingSink: (timing) => {
      timings.push(timing);
    },
  });
  const compiler = new AgentPiAssistantCompiler({
    modelProvider: provider,
    actionPlannerConfig: plannerConfig,
    timingSink: (timing) => {
      timings.push(timing);
    },
  });
  const finalAnswers = new AgentPiFinalAnswerGenerator(
    provider,
    plannerConfig.FinalAnswerClient,
    undefined,
    (timing) => {
      timings.push(timing);
    },
  );

  for (let index = 0; index < iterations; index += 1) {
    const iterationStartedAt = performance.now();
    const preparation =
      stage === "prepare-interaction" ||
      stage === "both" ||
      stage === "direct-flow" ||
      stage === "cached-direct-flow" ||
      stage === "prepared-flow"
        ? await plannerClient.prepareInteraction(createPreparationInput(prompt), {
            candidateTools: candidates.cards,
          })
        : undefined;
    if (preparation) {
      results.push({ stage: "PrepareInteraction", outcome: projectPreparedInteractionRoute(preparation).mode });
    }
    if (stage === "select-action" || stage === "both") {
      const compilation = await compiler.compile({
        request: {
          model: provider.Model,
          messages: [{ role: "user", content: prompt }],
          tools: [],
          tool_choice: "none",
          stream: true,
        },
        runtime: {
          requestId: `pi-planner-benchmark-${index + 1}`,
          step: 1,
        },
      });
      results.push({ stage: "SelectPiAction", outcome: compilation.kind });
    }
    if ((stage === "direct-flow" || stage === "cached-direct-flow" || stage === "prepared-flow") && preparation) {
      const flowStartedAt = stage === "cached-direct-flow" ? performance.now() : iterationStartedAt;
      const route = projectPreparedInteractionRoute(preparation);
      if (stage !== "prepared-flow" && route.mode !== "direct_response") {
        results.push({ stage: "DirectFlow", outcome: `not_direct:${route.mode}` });
        continue;
      }
      const compilation = await compiler.compile({
        request: {
          model: provider.Model,
          messages: [{ role: "user", content: prompt }],
          tools: candidates.tools,
          stream: true,
        },
        runtime: {
          requestId: `pi-direct-flow-benchmark-${index + 1}`,
          step: 1,
          rootCommand:
            route.mode === "direct_response"
              ? answerRootCommand(route.objective)
              : toolRootCommand(
                  route.objective,
                  candidates.cards.map((tool) => tool.name),
                ),
          interactionRoute: route,
          turnUnderstanding: preparation.turnUnderstanding,
          preparedAction: new AgentPiPreparedActionLease(preparation.initialAction),
        },
      });
      if (compilation.kind !== "final_answer") {
        const durationMs = elapsedMilliseconds(flowStartedAt);
        directFlows.push({ firstOutputMs: durationMs, durationMs, responseCharacters: compilation.content.length });
        results.push({
          stage: stage === "prepared-flow" ? "PreparedFlow" : "DirectFlow",
          outcome: compilation.kind,
        });
        continue;
      }

      const stream = await finalAnswers.stream(compilation.input, {
        requestId: `pi-direct-flow-benchmark-${index + 1}`,
        step: 1,
      });
      let responseCharacters = 0;
      let firstOutputMs: number | undefined;
      for await (const chunk of stream) {
        firstOutputMs ??= elapsedMilliseconds(flowStartedAt);
        responseCharacters = chunk.accumulatedText.length;
      }
      directFlows.push({
        firstOutputMs,
        durationMs: elapsedMilliseconds(flowStartedAt),
        responseCharacters,
      });
      results.push({
        stage:
          stage === "cached-direct-flow"
            ? "CachedDirectFlow"
            : stage === "prepared-flow"
              ? "PreparedFlow"
              : "DirectFlow",
        outcome: compilation.decisionSource,
      });
    }
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        sessionProviderId: provider.Id,
        planningProviderId: planningProvider.Id,
        model: planningProvider.Model,
        iterations,
        stage,
        results,
        directFlow: summarizeDirectFlows(directFlows),
        summary: summarizeTimingsByStage(timings),
        timings,
        structuredAttempts,
      },
      null,
      2,
    )}\n`,
  );
}

function parseStage(value: string): BenchmarkStage {
  if (
    value === "prepare-interaction" ||
    value === "select-action" ||
    value === "direct-flow" ||
    value === "cached-direct-flow" ||
    value === "prepared-flow" ||
    value === "both"
  ) {
    return value;
  }
  throw new Error(
    "--stage must be prepare-interaction, select-action, direct-flow, cached-direct-flow, prepared-flow, or both.",
  );
}

async function projectBenchmarkCandidateTools(
  workspaceRoot: string,
  configPath: string,
  prompt: string,
): Promise<{ cards: AgentPiToolCard[]; tools: PiOpenAiTool[] }> {
  const runtime = AgentSystemRuntime.load({ workspaceRoot, configPath });
  try {
    const visibleToolNames = runtime.toolSearch.resolveInitialLoadedTools(prompt, runtime.agentLoopConfig.LoadedTools);
    const definitions = runtime.services.pi.toolDefinitions({ visibleToolNames });
    return {
      cards: runtime.services.pi.planningToolCards({ visibleToolNames }),
      tools: definitions.map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: structuredClone(tool.parameters),
        },
      })),
    };
  } finally {
    await runtime.close();
  }
}

function parseIterations(value: string | undefined): number {
  if (value === undefined) return BenchmarkDefaults.iterations;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > BenchmarkDefaults.maximumIterations) {
    throw new Error(`--iterations must be between 1 and ${BenchmarkDefaults.maximumIterations}.`);
  }
  return parsed;
}

function summarizeTimings(timings: readonly AgentModelTimingRecord[]) {
  const completed = timings.filter((timing) => timing.status === "completed");
  return {
    completed: completed.length,
    failed: timings.length - completed.length,
    firstTokenMs: distribution(completed.flatMap((timing) => timing.firstTokenMs ?? [])),
    durationMs: distribution(completed.map((timing) => timing.durationMs)),
    requestCharacters: distribution(completed.map((timing) => timing.requestCharacters)),
    responseCharacters: distribution(completed.map((timing) => timing.responseCharacters)),
  };
}

function summarizeTimingsByStage(timings: readonly AgentModelTimingRecord[]) {
  return Object.fromEntries(
    [...new Set(timings.map((timing) => timing.stage))].map((stage) => [
      stage,
      summarizeTimings(timings.filter((timing) => timing.stage === stage)),
    ]),
  );
}

function summarizeDirectFlows(
  flows: readonly { firstOutputMs?: number; durationMs: number; responseCharacters: number }[],
) {
  return flows.length === 0
    ? undefined
    : {
        completed: flows.length,
        firstOutputMs: distribution(flows.flatMap((flow) => flow.firstOutputMs ?? [])),
        durationMs: distribution(flows.map((flow) => flow.durationMs)),
        responseCharacters: distribution(flows.map((flow) => flow.responseCharacters)),
      };
}

function createPreparationInput(prompt: string): ActionPlanInput {
  return {
    currentUserTurn: { content: prompt },
    roleplayPreset: { enabled: false, activePresetName: null, documents: [] },
    runState: {
      currentStep: 1,
      dynamicTools: true,
      loadedTools: [],
      progress: {
        totalToolCalls: 0,
        totalEvidence: 0,
        lastNewEvidenceStep: 0,
        repeatedCallCount: 0,
        stalled: false,
      },
      warnings: [],
      calls: [],
    },
    timeline: [
      {
        index: 0,
        role: "user",
        kind: "user_message",
        content: prompt,
        evidenceUris: [],
        artifactUris: [],
      },
    ],
    evidenceMemory: [],
    evidenceState: [],
    plannerJournal: [],
    toolTagCatalog: [],
    compactToolCatalog: [],
    toolCatalog: [],
    activeSkills: [],
  };
}

function distribution(values: readonly number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted.length === 0
    ? undefined
    : {
        min: sorted[0],
        median: percentile(sorted, 0.5),
        p90: percentile(sorted, 0.9),
        max: sorted.at(-1),
      };
}

function percentile(sorted: readonly number[], ratio: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))] ?? 0;
}

function answerRootCommand(objective: string): AgentRootCommand {
  return {
    authority: "senera_runtime_root",
    action: "answer",
    outputMode: "final_text",
    toolAccess: "restricted",
    objective,
    instruction: null,
    allowedTools: [],
    forbiddenOutputs: [],
    insufficiencyPolicy: "ask",
    preferredTools: [],
    toolSearchQueries: [],
    needs: [],
    includeToolCatalog: false,
    visibleOutput: {
      audience: "user",
      start: "",
      format: "text",
      rules: [],
      repair: { instruction: "", rules: [] },
    },
  };
}

function toolRootCommand(objective: string, allowedTools: readonly string[]): AgentRootCommand {
  return {
    ...answerRootCommand(objective),
    action: "use_tools",
    outputMode: "open",
    toolAccess: "restricted",
    instruction: objective,
    allowedTools: [...allowedTools],
    preferredTools: [...allowedTools],
  };
}

function elapsedMilliseconds(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}
