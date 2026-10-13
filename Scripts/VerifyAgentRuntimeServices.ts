import assert from "node:assert/strict";
import {
  AgentRuntimeModuleComposer,
  type AgentRuntimeModule,
} from "../Source/AgentSystem/Runtime/AgentRuntimeModule.js";
import { AgentSystemRuntime } from "../Source/AgentSystem/Runtime/AgentSystemRuntime.js";
import { projectAgentDelegatedRolePromptContext } from "../Source/AgentSystem/Loop/AgentTurnPromptRenderer.js";
import { createIsolatedVerificationRuntimeConfig } from "./VerificationRuntimeConfig.js";
import {
  renderAgentPromptContextWires,
  type AgentPromptContextWireSet,
} from "../Source/AgentSystem/Prompt/AgentPromptContextWireRenderer.js";
import { normalizeAgentWorkflowTemplateContext } from "../Source/AgentSystem/Prompt/AgentPromptTemplateContextNormalizer.js";
import { ToolLoadingModes } from "../Source/AgentSystem/Types/AgentToolContractTypes.js";

const workspaceRoot = process.cwd();
const isolatedConfig = await createIsolatedVerificationRuntimeConfig(workspaceRoot);
const configPath = isolatedConfig.configPath;
try {
  const runtime = AgentSystemRuntime.load({
    workspaceRoot,
    configPath,
    toolSearchScenarioSource: isolatedConfig.createToolSearchScenarioSource(),
  });

  assert.ok(runtime.services.retrieval);
  assert.ok(runtime.services.promptContext);
  assert.ok(runtime.services.pi);
  assert.ok(runtime.services.execution);
  assert.equal(runtime.services.pi.model().id, runtime.modelProviderConfig.Model);

  const skills = await runtime.services.promptContext.activateSkills({
    input: "检查项目结构并总结作用",
  });
  assert.ok(Array.isArray(skills));

  const workflowSkills = await runtime.services.promptContext.activateSkills({
    input: "继续全面优化拓展代码质量，不要硬编码，运行测试验证直到完成",
  });
  assert.equal(
    workflowSkills.some((skill) => skill.name === "execution-workflow"),
    true,
  );
  assert.equal(
    workflowSkills.some((skill) => skill.name === "agent-orchestration"),
    true,
  );
  assert.deepEqual(runtime.services.promptContext.recommendedSkillToolRouting(workflowSkills), {
    directToolNames: ["AgentSpawn", "AgentList", "AgentWait", "AgentInput", "AgentStop", "AgentResume"],
    dynamicToolNames: [],
    nativeToolNames: [],
    requiredToolNames: [],
  });
  const investigationSkills = await runtime.services.promptContext.activateSkills({
    input: "现在的 shell 工具怎么实现的，读取 SeneraShellPlatform 的片段并分析",
  });
  assert.equal(
    investigationSkills.some((skill) => skill.name === "workspace-investigation"),
    true,
  );

  const toolCatalog = runtime.services.promptContext.toolCatalog();
  assert.ok(toolCatalog.length > 0);
  const bootstrapToolName = toolCatalog.find(
    (tool) => runtime.registry.getTool(tool.name)?.loading === ToolLoadingModes.Bootstrap,
  )?.name;
  const dynamicToolName = toolCatalog.find(
    (tool) => runtime.registry.getTool(tool.name)?.loading === ToolLoadingModes.Dynamic,
  )?.name;
  assert.ok(bootstrapToolName, "The runtime must expose at least one Bootstrap tool.");
  assert.ok(dynamicToolName, "The runtime must register at least one Dynamic tool.");
  assert.ok(runtime.services.pi.activeToolNames().includes(bootstrapToolName));
  assert.ok(runtime.services.pi.toolDefinitions().some((tool) => tool.name === bootstrapToolName));
  assert.ok(!runtime.services.pi.activeToolNames().includes(dynamicToolName));
  assert.ok(!runtime.services.pi.toolDefinitions().some((tool) => tool.name === dynamicToolName));

  const baseContext = runtime.services.promptContext.buildBaseContext({
    loadedToolNames: [bootstrapToolName],
  });
  assert.ok(baseContext.ToolCards.some((tool) => tool.name === bootstrapToolName));
  assert.equal(baseContext.ExecutionEnvironment.workspace.root, workspaceRoot);
  assert.equal(baseContext.ExecutionEnvironment.workspace.logicalRoot, ".");
  assert.equal(baseContext.ExecutionEnvironment.workspace.preferredPathForm, "workspace-relative");
  assert.ok(baseContext.ExecutionEnvironment.shell.invocation.length > 0);
  assert.equal(baseContext.ExecutionEnvironment.executionTargets.sandbox, null);
  const localShellDialect = baseContext.ExecutionEnvironment.executionTargets.local.shellDialect;
  assert.equal(baseContext.ExecutionEnvironment.executionTargets.local.workspaceRoot, workspaceRoot);
  assert.equal(baseContext.ExecutionEnvironment.executionTargets.local.workspaceMount, "host");
  const promptWires = renderAgentPromptContextWires(
    {
      continuity: baseContext.ContinuityMemory,
      workflow: normalizeAgentWorkflowTemplateContext(baseContext.Workflow),
    },
    { estimateTokens: (text) => text.length },
  );
  const templateWireContext = projectTemplateWireContext(promptWires);
  for (const templateName of ["PiNativeSystemPrompt", "PiBamlSystemPrompt"]) {
    const template = runtime.registry.getTemplate(templateName);
    assert.ok(template);
    const renderedPrompt = runtime.promptRenderer.renderFileSync(template.path, {
      ...baseContext,
      DelegatedRole: projectAgentDelegatedRolePromptContext(),
      ...templateWireContext,
    });
    assert.ok(renderedPrompt.includes("<execution_environment>"));
    assert.ok(renderedPrompt.includes("<logical_root>.</logical_root>"));
    assert.ok(renderedPrompt.includes(`<workspace_root>${workspaceRoot}</workspace_root>`));
    assert.ok(renderedPrompt.includes("<preferred_path_form>workspace-relative</preferred_path_form>"));
    assert.ok(renderedPrompt.includes(`<shell_dialect>${localShellDialect}</shell_dialect>`));
    assert.ok(!renderedPrompt.includes("<sandbox>"));
    assert.ok(!renderedPrompt.includes("Sandbox shell tools"));
    assert.ok(!renderedPrompt.includes("senera_root_command"));
    assert.ok(!renderedPrompt.includes("pi_tool_turn"));
  }

  const shellDefinition = runtime.services.pi.toolDefinitions().find((tool) => tool.name === "ShellCommandTool");
  assert.ok(shellDefinition);
  const shellSchema = JSON.stringify(shellDefinition.parameters);
  for (const requiredField of ['"mode"', '"dialect"', '"script"', '"posix-sh"', '"powershell"']) {
    assert.ok(shellSchema.includes(requiredField), `ShellCommandTool schema is missing ${requiredField}`);
  }
  assert.equal(
    runtime.services.pi.toolDefinitions().some((tool) => tool.name === "ShellStartTool"),
    false,
  );

  const toolSearchDefinition = runtime.services.pi.toolDefinitions().find((tool) => tool.name === "ToolSearch");
  assert.ok(toolSearchDefinition);
  const toolSearchProperties = readRecord(toolSearchDefinition.parameters.properties);
  assert.ok(toolSearchProperties.query);
  assert.equal(toolSearchProperties.catalogRevision, undefined);
  assert.equal(toolSearchProperties.preferredSources, undefined);
  assert.equal(toolSearchProperties.includeLoaded, undefined);

  assert.ok(runtime.services.pi.activeToolNames().includes("ShellCommandTool"));
  assert.ok(runtime.services.pi.activeToolNames().includes("WorkspaceApplyPatch"));
  const initialLoadedTools = await runtime.toolSearch.resolveInitialLoadedTools(
    "shell command terminal execute workspace inspection",
  );
  const projectedBootstrapToolNames = runtime.services.pi
    .activeToolNames()
    .filter((toolName) => runtime.registry.getTool(toolName) !== undefined);
  assert.deepEqual(
    [...initialLoadedTools].sort(),
    [...projectedBootstrapToolNames].sort(),
    "The initial tool set must contain exactly the Bootstrap tools projected for the active planning mode.",
  );

  const answerRootCommand = runtime.services.promptContext.buildRootCommand({
    decision: { action: "answer" },
    loadedToolNames: [],
  });
  assert.equal(answerRootCommand.action, "answer");

  const loadedTools = await runtime.services.retrieval.resolvePlannedLoadedTools({
    input: "检查项目结构并总结作用",
    preferredTools: [],
    queries: ["项目结构"],
    needs: [],
    discover: true,
  });
  assert.ok(loadedTools.includes("ToolSearch"));

  let observedFinishedRequest: string | undefined;

  const runtimeModule: AgentRuntimeModule = {
    id: "verify.retrieval-observer",
    services: ({ services }) => [
      {
        service: "retrieval",
        create: () => ({
          ...services.retrieval,
          finishRequest: (requestId) => {
            observedFinishedRequest = requestId;
            return services.retrieval.finishRequest(requestId);
          },
        }),
      },
    ],
  };

  const services = new AgentRuntimeModuleComposer().compose(runtime.services, [runtimeModule]);
  services.retrieval.finishRequest("verify-runtime-services");

  assert.equal(observedFinishedRequest, "verify-runtime-services");

  observedFinishedRequest = undefined;
  const runtimeWithModule = AgentSystemRuntime.load({
    workspaceRoot,
    configPath,
    runtimeModules: [runtimeModule],
    toolSearchScenarioSource: isolatedConfig.createToolSearchScenarioSource(),
  });
  runtimeWithModule.services.retrieval.finishRequest("verify-runtime-module");
  assert.equal(observedFinishedRequest, "verify-runtime-module");

  await Promise.all([runtime.close(), runtimeWithModule.close()]);

  console.log("Agent runtime services verification passed.");
} finally {
  await isolatedConfig.dispose();
}

function readRecord(value: unknown): Record<string, unknown> {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}

function projectTemplateWireContext(wires: AgentPromptContextWireSet): Record<string, string> {
  return {
    LiveStateWire: wires.liveState.text,
  };
}
