import path from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";
import { AgentSystemRuntime } from "../Source/AgentSystem/Runtime/AgentSystemRuntime.js";
import { ToolLoadingModes } from "../Source/AgentSystem/Types/AgentToolContractTypes.js";
import { errorMessage } from "../Source/AgentSystem/Core/AgentErrors.js";
import { AgentModelTokenEstimator } from "../Source/AgentSystem/Text/AgentTextBudget.js";
import { buildToolSearchResultProjection } from "../Source/AgentSystem/ToolSearch/AgentToolSearchResultProjector.js";
import {
  AgentToolDescriptionProtocol,
  AgentToolDiscoveryProtocol,
} from "../Source/AgentSystem/ToolSearch/AgentToolMetaToolProtocol.js";
import { projectToolDescription } from "../Source/AgentSystem/ToolSearch/AgentToolMetaToolProjector.js";
import { resolveAgentToolOwner } from "../Source/AgentSystem/Types/AgentToolOwner.js";
import { resolveAgentWorkspaceConfigPath } from "../Source/AgentSystem/Core/AgentWorkspaceLayout.js";
import { AgentJsonSchemaPromptContractProjector } from "../Source/AgentSystem/ToolContracts/AgentJsonSchemaPromptContractProjector.js";
import { projectAgentToolInvocationSchema } from "../Source/AgentSystem/ToolRuntime/AgentToolExecutionPlan.js";
import { projectAgentToolInteraction } from "../Source/AgentSystem/ToolRuntime/AgentToolInteractionProjector.js";
import type { RegisteredTool } from "../Source/AgentSystem/Types/AgentToolRuntimeTypes.js";
import type {
  AgentToolSearchDiscovery,
  AgentToolSearchResult,
} from "../Source/AgentSystem/ToolSearch/AgentToolSearchTypes.js";

const DefaultPrompts = [
  "请用一句话说明你是谁",
  "检查当前工作区的插件协议并运行验证",
  "查询北京天气",
  "读取 package.json",
  "运行 npm test",
  "修改 Source/AgentSystem 文件",
] as const;
const MaxReportedScenarioSignals = 5;
const LegacyOutputSummaryMaxChars = 1_200;
const descriptionContracts = new AgentJsonSchemaPromptContractProjector();

const argumentsSchema = {
  workspace: { type: "string" },
  config: { type: "string" },
  prompt: { type: "string", multiple: true },
  "inspect-tool": { type: "string", multiple: true },
  "settle-ms": { type: "string" },
  repetitions: { type: "string" },
} as const;

void main().catch((error) => {
  process.stderr.write(`${errorMessage(error)}\n`);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const { values } = parseArgs({ options: argumentsSchema, allowPositionals: false });
  const workspaceRoot = path.resolve(values.workspace ?? process.cwd());
  const configPath = resolveAgentWorkspaceConfigPath(workspaceRoot, values.config);
  const prompts = values.prompt?.map((prompt) => prompt.trim()).filter(Boolean) ?? [...DefaultPrompts];
  const settleMilliseconds = parseNonNegativeInteger(values["settle-ms"], "settle-ms");
  const repetitions = parsePositiveInteger(values.repetitions, "repetitions") ?? 1;
  const inspectedToolNames = values["inspect-tool"]?.map((name) => name.trim()).filter(Boolean) ?? [];
  const runtime = AgentSystemRuntime.load({ workspaceRoot, configPath });

  try {
    await runtime.initialize();
    if (settleMilliseconds > 0) await wait(settleMilliseconds);
    const tools = runtime.registry.listTools();
    const bootstrapTools = tools.filter((tool) => tool.loading === ToolLoadingModes.Bootstrap).map((tool) => tool.name);
    const results = [];
    for (const prompt of prompts) {
      results.push(await benchmarkPrompt(runtime, prompt, bootstrapTools, repetitions));
    }
    process.stdout.write(
      `${JSON.stringify(
        {
          registeredToolCount: tools.length,
          bootstrapTools,
          policy: runtime.toolSearchConfig.Ranking,
          settleMilliseconds,
          repetitions,
          inspectedTools: inspectedToolNames.map((name) => projectInspectedTool(runtime, name)),
          results,
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await runtime.close();
  }
}

async function benchmarkPrompt(
  runtime: AgentSystemRuntime,
  prompt: string,
  bootstrapTools: readonly string[],
  repetitions = 1,
) {
  const runs = [];
  for (let index = 0; index < repetitions; index += 1) {
    runs.push(await benchmarkPromptRun(runtime, prompt, bootstrapTools));
  }
  const first = runs[0];
  if (!first) throw new Error("ToolSearch benchmark did not complete a run.");
  const searchDurations = runs.map((run) => run.searchDurationMs).sort((left, right) => left - right);
  return {
    ...first,
    searchDurationMs: first.searchDurationMs,
    latency: {
      firstMs: first.searchDurationMs,
      minMs: searchDurations[0],
      medianMs: percentile(searchDurations, 0.5),
      p95Ms: percentile(searchDurations, 0.95),
      maxMs: searchDurations.at(-1),
    },
    ...(runs.length > 1 ? { runs } : {}),
  };
}

async function benchmarkPromptRun(runtime: AgentSystemRuntime, prompt: string, bootstrapTools: readonly string[]) {
  const loadStartedAt = performance.now();
  const loadedTools = await runtime.toolSearch.resolveInitialLoadedTools(prompt);
  const initialLoadDurationMs = elapsedMilliseconds(loadStartedAt);
  const searchStartedAt = performance.now();
  const discovery = await runtime.toolSearch.discover({
    query: prompt,
    loadedToolNames: bootstrapTools,
  });
  const searchDurationMs = elapsedMilliseconds(searchStartedAt);
  const ranked = discovery.match;

  return {
    prompt,
    initialLoadDurationMs,
    searchDurationMs,
    loadedTools,
    loadedToolCount: loadedTools.length,
    discovery: projectDiscovery(discovery),
    wire: measureDiscoveryWire(discovery, runtime.modelProviderConfig.Model),
    ranked: ranked.map((result) => ({
      toolName: result.toolName,
      score: result.score,
      semanticScore: result.semanticScore,
      ranks: result.ranks,
      matchedTerms: result.matchedTerms,
      matchedCapabilities: result.matchedCapabilities.map((capability) => capability.id),
      parameterSummary: result.parameterSummary,
      scenarioSignals: result.scenarioSignals.slice(0, MaxReportedScenarioSignals).map((signal) => ({
        term: signal.term,
        confidence: signal.confidence,
        support: signal.support,
      })),
    })),
  };
}

function projectDiscovery(discovery: AgentToolSearchDiscovery) {
  return {
    match: discovery.match.map(projectResult),
    maybe: discovery.maybe.map(projectResult),
    omitted: discovery.omitted.map(projectResult),
  };
}

function projectResult(result: AgentToolSearchResult) {
  return {
    toolName: result.toolName,
    title: result.title,
    score: result.score,
    semanticScore: result.semanticScore,
    ranks: result.ranks,
  };
}

function measureDiscoveryWire(discovery: AgentToolSearchDiscovery, model: string) {
  const compact = {
    type: AgentToolDiscoveryProtocol.type,
    ...buildToolSearchResultProjection(discovery, { model, tokenBudget: 640 }),
  };
  const expanded = projectExpandedDiscoveryBaseline(discovery);
  const estimator = new AgentModelTokenEstimator({ model });
  const compactRaw = JSON.stringify(compact);
  const expandedRaw = JSON.stringify(expanded);
  const compactTokens = estimator.estimate(compactRaw).tokenCount;
  const expandedTokens = estimator.estimate(expandedRaw).tokenCount;
  return {
    model,
    compact: { raw: compactRaw, tokens: compactTokens },
    expandedBaseline: { raw: expandedRaw, tokens: expandedTokens },
    savedTokens: Math.max(0, expandedTokens - compactTokens),
    savedRatio: expandedTokens === 0 ? 0 : Number(((expandedTokens - compactTokens) / expandedTokens).toFixed(4)),
  };
}

function projectExpandedDiscoveryBaseline(discovery: AgentToolSearchDiscovery): object {
  const entries = [...discovery.match, ...discovery.maybe, ...discovery.omitted];
  return {
    type: "senera.tool_discovery.expanded_baseline",
    tools: {
      item: entries.map((result, index) => ({
        name: result.toolName,
        title: result.title,
        summary: result.summary,
        whenToUse: result.whenToUse,
        parameters: result.parameterSummary,
        permissions: result.permissions,
        rank: index + 1,
        score: result.score,
        semanticScore: result.semanticScore,
        ranks: result.ranks,
        matches: {
          terms: result.matchedTerms,
          capabilities: result.matchedCapabilities,
          scenarios: result.scenarioSignals,
        },
        sources: result.sources,
        state: result.state,
      })),
    },
  };
}

function parseNonNegativeInteger(value: string | undefined, name: string): number {
  if (value === undefined) return 0;
  if (!/^\d+$/u.test(value)) throw new Error(`--${name} must be a non-negative integer.`);
  return Number(value);
}

function parsePositiveInteger(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = parseNonNegativeInteger(value, name);
  if (parsed <= 0) throw new Error(`--${name} must be greater than zero.`);
  return parsed;
}

function percentile(sorted: readonly number[], ratio: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))] ?? 0;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function projectInspectedTool(runtime: AgentSystemRuntime, name: string) {
  const tool = runtime.registry.getTool(name);
  if (!tool) return { name, available: false };
  return {
    name: tool.name,
    available: true,
    title: tool.owner.title,
    description: tool.owner.description,
    search: tool.search,
    contract: tool.contract
      ? {
          digest: tool.contract.digest,
          arguments: (tool.contract.arguments?.properties ?? []).map((property) => ({
            name: property.name,
            type: property.typeText,
            required: property.required,
            comment: property.comment,
          })),
        }
      : undefined,
    descriptionWire: measureToolDescriptionWire(tool, runtime.modelProviderConfig.Model),
  };
}

/**
 * The expanded shape mirrors the retired description observation so this CLI
 * can measure an equal-information baseline. It is benchmark-only: runtime
 * discovery and execution use the compact v2 tuple protocol exclusively.
 */
function measureToolDescriptionWire(tool: RegisteredTool, model: string) {
  const compact = {
    type: AgentToolDescriptionProtocol.type,
    tools: [projectToolDescription(tool)],
  };
  const expanded = {
    type: "senera.tool_description.expanded_baseline",
    tools: { item: [projectExpandedToolDescriptionBaseline(tool)] },
  };
  const estimator = new AgentModelTokenEstimator({ model });
  const compactRaw = JSON.stringify(compact);
  const expandedRaw = JSON.stringify(expanded);
  const compactTokens = estimator.estimate(compactRaw).tokenCount;
  const expandedTokens = estimator.estimate(expandedRaw).tokenCount;
  return {
    model,
    compact: { raw: compactRaw, tokens: compactTokens },
    expandedBaseline: { raw: expandedRaw, tokens: expandedTokens },
    savedTokens: Math.max(0, expandedTokens - compactTokens),
    savedRatio: expandedTokens === 0 ? 0 : Number(((expandedTokens - compactTokens) / expandedTokens).toFixed(4)),
  };
}

function projectExpandedToolDescriptionBaseline(tool: RegisteredTool): Record<string, unknown> {
  const owner = resolveAgentToolOwner(tool);
  const interaction = projectAgentToolInteraction(tool);
  const declaredContract = tool.contract?.arguments;
  const invocationContract = declaredContract
    ? descriptionContracts.project(projectAgentToolInvocationSchema(tool, declaredContract.jsonSchema))
    : undefined;
  return {
    name: tool.name,
    title: interaction.title,
    summary: interaction.purpose,
    loading: tool.loading,
    usage: {
      purpose: interaction.purpose,
      useCases: { item: interaction.useCases },
      examples: { item: interaction.examples },
      avoid: { item: interaction.avoid },
      tags: { item: tool.search?.Tags ?? [] },
    },
    capabilities: {
      item: interaction.capabilities.map((capability) => ({
        id: capability.id,
        title: capability.title,
        description: capability.description,
        aliases: { item: capability.aliases },
      })),
    },
    contract: {
      typescript: { lines: { item: invocationContract?.tsHintLines ?? [] } },
      xml: invocationContract?.xmlPreview ?? "",
      requiredInputs: {
        item:
          invocationContract?.properties
            .filter((property) => property.required)
            .map((property) => ({ name: property.name, type: property.typeText, description: property.comment })) ?? [],
      },
      optionalInputs: {
        item:
          invocationContract?.properties
            .filter((property) => !property.required)
            .map((property) => ({ name: property.name, type: property.typeText, description: property.comment })) ?? [],
      },
      output: summarizeLegacyOutputSchema(tool.contract?.outputSchema),
    },
    effects: {
      executionTargets: { item: tool.execution.Targets },
      network: tool.execution.Network,
      workspace: tool.execution.Workspace,
      permissions: { item: tool.permissions },
      approval: tool.approval?.Mode ?? "allow",
    },
    source: {
      origin: owner.kind,
      id: owner.name,
      revision: owner.revision,
      items: { item: tool.sources.map((source) => ({ id: source.Id, title: source.Title })) },
    },
  };
}

function summarizeLegacyOutputSchema(schema: Readonly<Record<string, unknown>> | undefined): string {
  if (!schema) return "Unspecified result object.";
  const properties = isRecord(schema.properties) ? Object.keys(schema.properties).sort() : [];
  const required = Array.isArray(schema.required)
    ? schema.required.filter((value): value is string => typeof value === "string")
    : [];
  const summary = JSON.stringify({ type: schema.type ?? "object", required, properties });
  return summary.length <= LegacyOutputSummaryMaxChars
    ? summary
    : `${summary.slice(0, LegacyOutputSummaryMaxChars - 3)}...`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function elapsedMilliseconds(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}
