import assert from "node:assert/strict";
import { AgentDecisionParser } from "../Source/AgentSystem/AgentDecisionParser.js";
import { AgentDecisionErrorFactory } from "../Source/AgentSystem/AgentDecisionErrorFactory.js";
import { AgentXmlParser, AgentXmlSourceHelper } from "../Source/AgentSystem/AgentXmlParser.js";
import { createXmlProtocolPolicy, createXmlProtocolSpec } from "../Source/AgentSystem/AgentXmlPolicy.js";
import type { AgentPluginRegistry } from "../Source/AgentSystem/AgentPluginRegistry.js";
import { AgentSchemaValidator } from "../Source/AgentSystem/AgentSchemaValidator.js";
import { AgentDecisionXmlStreamAssembler } from "../Source/AgentSystem/AgentDecisionXmlStreamAssembler.js";
import { AgentXmlStreamStates } from "../Source/AgentSystem/AgentXmlStatus.js";
import type { AgentSystemConfig } from "../Source/AgentSystem/Types.js";

async function main(): Promise<void> {
  const policy = createXmlProtocolPolicy({
    ModelProviders: [],
    PluginRoots: {
      System: [],
      User: [],
    },
  } satisfies AgentSystemConfig);

  const toolCallsXml = [
    "<tool_calls>",
    "  <tool_call>",
    "    <name>AskUserTool</name>",
    "    <arguments>",
    "      <question>需要哪个范围？</question>",
    "    </arguments>",
    "  </tool_call>",
    "</tool_calls>",
  ].join("\n");

  const registry = {
    listDecisionActions: () => [{
      kind: "ToolCalls",
      xmlRoot: "tool_calls",
    }],
    getDecisionActionByRoot: (root: string) =>
      root === "tool_calls"
        ? {
            kind: "ToolCalls",
            xmlRoot: "tool_calls",
            schemaPath: "",
          }
        : undefined,
    getTemplate: () => ({
      path: "",
    }),
  } as unknown as AgentPluginRegistry;

  const parser = new AgentDecisionParser(
    new AgentXmlParser({
      policy,
    }),
    registry,
    {
      validate: async (_schemaPath: string, value: unknown) => value,
    } as unknown as AgentSchemaValidator,
    {
      policy,
      errorFactory: new AgentDecisionErrorFactory({
        registry,
        promptRenderer: {
          renderFileSync: () => "",
        } as never,
        workspaceRoot: process.cwd(),
        protocol: policy.protocol,
      }),
    },
  );

  const parsed = await parser.parseSanitized(toolCallsXml);
  assert.equal(parsed.decision.kind, "ToolCalls");
  assert.equal(parsed.sanitized.xml, toolCallsXml);
  assert.equal(parsed.sanitized.changed, false);

  const factory = new AgentDecisionErrorFactory({
    registry,
    promptRenderer: {
      renderFileSync: () => "",
    } as never,
    workspaceRoot: process.cwd(),
    protocol: createXmlProtocolSpec(),
  });

  const unknownRootError = factory.unknownDecisionRoot({
    rootName: "svg",
    source: new AgentXmlSourceHelper("<svg></svg>"),
    allowedRoots: ["tool_calls"],
  });
  const unknownRootDetails = unknownRootError.instruction.details as { suggestion?: string } | undefined;

  assert.match(
    unknownRootDetails?.suggestion ?? "",
    /普通回复应直接输出自然语言，不需要 XML 外壳/u,
  );

  const streamAssembler = new AgentDecisionXmlStreamAssembler({
    policy,
    acceptRoot: (rootName) => rootName === "tool_calls",
    allowEmbeddedCandidates: false,
  });

  const plainSnapshot = streamAssembler.push("只是说明文字，没有 XML 根节点。");
  assert.equal(plainSnapshot.state, AgentXmlStreamStates.Collecting);
  assert.equal(plainSnapshot.candidateXml, "只是说明文字，没有 XML 根节点。");

  const embeddedSnapshot = streamAssembler.push(`\n示例：${toolCallsXml}`);
  assert.equal(embeddedSnapshot.state, AgentXmlStreamStates.Collecting);

  const toolAssembler = new AgentDecisionXmlStreamAssembler({
    policy,
    acceptRoot: (rootName) => rootName === "tool_calls",
    allowEmbeddedCandidates: false,
  });
  const toolSnapshot = toolAssembler.push(toolCallsXml);
  assert.equal(toolSnapshot.state, AgentXmlStreamStates.RootClosed);
  assert.equal(toolSnapshot.candidateXml, toolCallsXml);

  await assert.rejects(
    () => parser.parse("<svg></svg>"),
    (error) =>
      error instanceof Error
      && "instruction" in error
      && (error.instruction as { code?: string }).code === "UnknownDecisionRoot",
  );

  await assert.rejects(
    () => parser.parse(""),
    (error) =>
      error instanceof Error
      && "instruction" in error
      && (error.instruction as { code?: string }).code === "EmptyDecisionXml",
  );

  console.log("XML envelope verification passed.");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
