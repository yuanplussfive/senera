import path from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";
import { AgentSystemRuntime } from "../Source/AgentSystem/Runtime/AgentSystemRuntime.js";
import { ToolLoadingModes } from "../Source/AgentSystem/Types/PluginToolManifestTypes.js";

const DefaultPrompts = [
  "请用一句话说明你是谁",
  "检查当前工作区的插件协议并运行验证",
  "查询北京天气",
  "读取 package.json",
  "运行 npm test",
  "修改 Source/AgentSystem 文件",
] as const;
const MaxReportedLearningSignals = 5;

const argumentsSchema = {
  workspace: { type: "string" },
  config: { type: "string" },
  prompt: { type: "string", multiple: true },
} as const;

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const { values } = parseArgs({ options: argumentsSchema, allowPositionals: false });
  const workspaceRoot = path.resolve(values.workspace ?? process.cwd());
  const configPath = path.resolve(workspaceRoot, values.config ?? "senera.config.json");
  const prompts = values.prompt?.map((prompt) => prompt.trim()).filter(Boolean) ?? [...DefaultPrompts];
  const runtime = AgentSystemRuntime.load({ workspaceRoot, configPath });

  try {
    const tools = runtime.registry.listTools();
    const bootstrapTools = tools.filter((tool) => tool.loading === ToolLoadingModes.Bootstrap).map((tool) => tool.name);
    const results = prompts.map((prompt) => benchmarkPrompt(runtime, prompt, bootstrapTools));
    process.stdout.write(
      `${JSON.stringify(
        {
          registeredToolCount: tools.length,
          bootstrapTools,
          policy: runtime.toolSearchConfig.Ranking,
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

function benchmarkPrompt(runtime: AgentSystemRuntime, prompt: string, bootstrapTools: readonly string[]) {
  const startedAt = performance.now();
  const loadedTools = runtime.toolSearch.resolveInitialLoadedTools(prompt);
  const durationMs = elapsedMilliseconds(startedAt);
  const ranked = runtime.toolSearch.search({
    query: prompt,
    includeLoaded: false,
    loadedToolNames: bootstrapTools,
  });

  return {
    prompt,
    durationMs,
    loadedTools,
    loadedToolCount: loadedTools.length,
    ranked: ranked.map((result) => ({
      toolName: result.toolName,
      score: result.score,
      matchedTerms: result.matchedTerms,
      matchedCapabilities: result.matchedCapabilities.map((capability) => capability.id),
      learningSignals: result.learningSignals.slice(0, MaxReportedLearningSignals).map((signal) => ({
        term: signal.term,
        confidence: signal.confidence,
        support: signal.support,
      })),
    })),
  };
}

function elapsedMilliseconds(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}
