import assert from "node:assert/strict";
import path from "node:path";
import { AgentConfigLoader } from "../Source/AgentSystem/AgentConfigLoader.js";
import { AgentDecisionXmlCollector, AgentDecisionXmlCollectionRetryableError } from "../Source/AgentSystem/AgentDecisionXmlCollector.js";
import { createXmlProtocolPolicy } from "../Source/AgentSystem/AgentXmlPolicy.js";
import type { AgentLanguageModel, AgentLanguageModelStream } from "../Source/AgentSystem/AgentLanguageModel.js";
import type { AgentSystemConfig } from "../Source/AgentSystem/Types/AgentConfigTypes.js";
import type { AgentActionDecision } from "../Source/AgentSystem/AgentActionPlanner.js";
import type { AgentModelProviderMetadata } from "../Source/AgentSystem/AgentModelMetadata.js";
import { AgentRetryPlanner } from "../Source/AgentSystem/AgentRetryPlanner.js";
import { AgentActionMismatchRepairPromptBuilder } from "../Source/AgentSystem/AgentActionMismatchRepairPromptBuilder.js";
import { AgentPromptRenderer } from "../Source/AgentSystem/AgentPromptRenderer.js";
import { AgentPluginRegistry } from "../Source/AgentSystem/AgentPluginRegistry.js";
import { AgentPluginScanner } from "../Source/AgentSystem/AgentPluginScanner.js";
import type { AgentToolCatalogProjector } from "../Source/AgentSystem/AgentToolCatalogProjector.js";
import { AgentPromptContextBuilder } from "../Source/AgentSystem/AgentPromptContextBuilder.js";

async function main(): Promise<void> {
  const workspaceRoot = process.cwd();
  const config = AgentConfigLoader.load(path.join(workspaceRoot, "senera.config.json"));
  const registry = new AgentPluginRegistry();
  for (const plugin of new AgentPluginScanner(workspaceRoot, config).scan()) {
    registry.registerPlugin(plugin);
  }
  const promptContextBuilder = new AgentPromptContextBuilder(registry, config);
  const policy = createXmlProtocolPolicy({
    ModelProviders: [],
    PluginRoots: {
      System: [],
      User: [],
    },
  } satisfies AgentSystemConfig);
  const toolCallsRoot = policy.protocol.roots.toolCalls;
  const toolXml = [
    `<${toolCallsRoot}>`,
    "  <tool_call>",
    "    <name>FastContextWorkspaceMapTool</name>",
    "    <arguments>",
    "      <maxChildrenPerRoot>30</maxChildrenPerRoot>",
    "    </arguments>",
    "  </tool_call>",
    `</${toolCallsRoot}>`,
  ].join("\n");
  const mixed = [
    "好的，我先查看项目结构。",
    "",
    toolXml,
  ].join("\n");

  const useTools = action("use_tools");
  const answer = action("answer");

  const mixedMismatch = await collectError(mixed, useTools, policy, registry, promptContextBuilder);
  assert.equal(mixedMismatch.instruction.code, "MixedXmlContent");
  assert.match(mixedMismatch.instruction.repairPrompt ?? "", /第一个非空字符必须是 &lt;/);

  const finalText = await collect(mixed, answer, policy, registry, promptContextBuilder);
  assert.equal(finalText.kind, "final_text");
  assert.equal(finalText.text, mixed);

  const mismatch = await collectError("我可以直接解释这个项目。", useTools, policy, registry, promptContextBuilder);
  assert.equal(mismatch.instruction.code, "MixedXmlContent");
  assert.match(mismatch.instruction.repairPrompt ?? "", /<visible_output_contract>/);
  assert.match(mismatch.instruction.repairPrompt ?? "", /<repair_contract>/);
  assert.match(mismatch.instruction.repairPrompt ?? "", /<tool_call_root>senera_tool_calls<\/tool_call_root>/);
  assert.match(mismatch.instruction.repairPrompt ?? "", /第一个非空字符必须是 &lt;/);
  assert.match(mismatch.instruction.repairPrompt ?? "", /FastContextWorkspaceMapTool/);

  const repairedMessages = new AgentRetryPlanner().buildRepairConversation(
    [{ role: "user", content: "看看项目是干嘛的" }],
    "我可以直接解释这个项目。",
    mismatch,
  );
  assert.equal(repairedMessages.at(-2)?.role, "assistant");
  assert.doesNotMatch(repairedMessages.at(-2)?.content ?? "", /我可以直接解释这个项目/);
  assert.match(repairedMessages.at(-2)?.content ?? "", /上一条输出已丢弃/);

  const pureTool = await collect(toolXml, useTools, policy, registry, promptContextBuilder);
  assert.equal(pureTool.kind, "tool_calls");
  assert.equal(pureTool.toolCallsXml, toolXml);

  console.log("Action-driven XML resolution verification passed.");
}

async function collectError(
  output: string,
  decision: AgentActionDecision,
  policy: ReturnType<typeof createXmlProtocolPolicy>,
  registry: AgentPluginRegistry,
  promptContextBuilder: AgentPromptContextBuilder,
): Promise<AgentDecisionXmlCollectionRetryableError> {
  try {
    await collect(output, decision, policy, registry, promptContextBuilder);
  } catch (error) {
    if (error instanceof AgentDecisionXmlCollectionRetryableError) {
      return error;
    }
    throw error;
  }

  throw new Error("Expected retryable collection error.");
}

async function collect(
  output: string,
  decision: AgentActionDecision,
  policy: ReturnType<typeof createXmlProtocolPolicy>,
  registry: AgentPluginRegistry,
  promptContextBuilder: AgentPromptContextBuilder,
) {
  const rootCommand = promptContextBuilder.buildRootCommand({
    decision,
    loadedToolNames: ["FastContextWorkspaceMapTool"],
  });
  const collector = new AgentDecisionXmlCollector({
    model: new StaticTextModel(output),
    policy,
    textBudget: {
      measure: () => ({
        state: "within_budget",
        model: "test",
        encodingName: "cl100k_base",
        resolution: "default_encoding",
        tokenCount: 0,
        tokenLimit: 10000,
        remainingTokens: 10000,
      }),
    },
    tokenEstimator: {
      estimate: (text) => ({
        tokenCount: text.length,
      }),
    },
    decisionActions: [{
      kind: "ToolCalls",
      xmlRoot: policy.protocol.roots.toolCalls,
    }],
    actionMismatchRepairPromptBuilder: new AgentActionMismatchRepairPromptBuilder({
      registry,
      promptRenderer: new AgentPromptRenderer(),
      toolCatalog: {
        listVisible: () => [{
          name: "FastContextWorkspaceMapTool",
          title: "Workspace Map",
          summary: "快速查看项目目录结构。",
          tags: [],
          useCases: [],
          examples: ["查看项目结构"],
          avoid: [],
          permissions: [],
          evidenceCapabilities: [],
        }],
      } as unknown as AgentToolCatalogProjector,
      protocol: policy.protocol,
    }),
  });

  return collector.collect({
    requestId: "verify-action-xml",
    step: 1,
    systemPrompt: "",
    messages: [],
    rootCommand,
  });
}

function action(kind: AgentActionDecision["action"]): AgentActionDecision {
  if (kind === "answer") {
    return {
      action: kind,
    };
  }

  if (kind === "ask_user") {
    return {
      action: kind,
      askUser: {
        question: "Which target should I use?",
        reason: null,
      },
    };
  }

  if (kind === "discover_tools") {
    return {
      action: kind,
      discoverTools: {
        queries: ["workspace map"],
        needs: [{
          actions: ["inspect"],
          targets: ["workspace"],
          inputs: [],
          outputs: ["directory-summary"],
          evidence: [],
          effects: ["read-only"],
        }],
      },
    };
  }

  return {
    action: kind,
    useTools: {
      preferredTools: ["FastContextWorkspaceMapTool"],
      instruction: "Call FastContextWorkspaceMapTool.",
      needs: [],
    },
  };
}

class StaticTextModel implements AgentLanguageModel {
  readonly metadata = TestModelMetadata;

  constructor(private readonly text: string) {}

  async complete() {
    return {
      text: this.text,
    };
  }

  async stream(): Promise<AgentLanguageModelStream> {
    return createStream(this.text);
  }
}

function createStream(text: string): AgentLanguageModelStream {
  return {
    metadata: TestModelMetadata,
    abort: () => {},
    async *[Symbol.asyncIterator]() {
      yield {
        textDelta: text,
        accumulatedText: text,
      };
    },
  };
}

const TestModelMetadata = {
  id: "test",
  kind: "OpenAICompatible",
  endpoint: "Responses",
  baseUrl: "",
  model: "test",
} satisfies AgentModelProviderMetadata;

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
