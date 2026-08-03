import assert from "node:assert/strict";
import {
  AgentRuntimeModuleComposer,
  type AgentRuntimeModule,
} from "../Source/AgentSystem/Runtime/AgentRuntimeModule.js";
import { AgentSystemRuntime } from "../Source/AgentSystem/Runtime/AgentSystemRuntime.js";
import type { LoadedToolsState } from "../Source/AgentSystem/ToolSearch/AgentToolSearchRuntime.js";
import { SeneraMicrosandboxDefaults } from "../Source/AgentSystem/Execution/SeneraMicrosandboxDefaults.js";
import { createIsolatedVerificationRuntimeConfig } from "./VerificationRuntimeConfig.js";

const workspaceRoot = process.cwd();
const isolatedConfig = await createIsolatedVerificationRuntimeConfig(workspaceRoot);
const configPath = isolatedConfig.configPath;
try {
  const runtime = AgentSystemRuntime.load({
    workspaceRoot,
    configPath,
    toolSearchMemoryStore: isolatedConfig.createToolSearchMemoryStore(),
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
  assert.deepEqual(runtime.services.promptContext.recommendedSkillTools(workflowSkills), []);
  const investigationSkills = await runtime.services.promptContext.activateSkills({
    input: "现在的 shell 工具怎么实现的，读取 SeneraShellPlatform 的片段并分析",
  });
  assert.equal(
    investigationSkills.some((skill) => skill.name === "workspace-investigation"),
    true,
  );

  const toolCatalog = runtime.services.promptContext.toolCatalog();
  assert.ok(toolCatalog.length > 0);
  const visibleToolName = toolCatalog[0].name;
  assert.ok(runtime.services.pi.activeToolNames().includes(visibleToolName));
  assert.ok(runtime.services.pi.toolDefinitions().some((tool) => tool.name === visibleToolName));

  const baseContext = runtime.services.promptContext.buildBaseContext({
    loadedToolNames: [visibleToolName],
  });
  assert.ok(baseContext.ToolCards.some((tool) => tool.name === visibleToolName));
  assert.equal(baseContext.ExecutionEnvironment.workspace.root, workspaceRoot);
  assert.equal(baseContext.ExecutionEnvironment.workspace.preferredPathForm, "workspace-relative");
  assert.ok(baseContext.ExecutionEnvironment.shell.invocation.length > 0);
  assert.deepEqual(baseContext.ExecutionEnvironment.executionTargets.sandbox, {
    os: "Linux",
    boundary: "sandbox",
    shellDialect: "posix-sh",
    shellCommand: "/bin/sh",
    image: SeneraMicrosandboxDefaults.image,
  });
  const baseTemplate = runtime.registry.getTemplate("BaseSystemPrompt");
  assert.ok(baseTemplate);
  const renderedBasePrompt = runtime.promptRenderer.renderFileSync(baseTemplate.path, {
    ...baseContext,
  });
  assert.ok(renderedBasePrompt.includes("<execution_environment>"));
  assert.ok(renderedBasePrompt.includes("<preferred_path_form>workspace-relative</preferred_path_form>"));
  assert.ok(renderedBasePrompt.includes("<shell_dialect>posix-sh</shell_dialect>"));

  const shellStartDefinition = runtime.services.pi.toolDefinitions().find((tool) => tool.name === "ShellStartTool");
  assert.ok(shellStartDefinition);
  const shellStartSchema = JSON.stringify(shellStartDefinition.parameters);
  for (const requiredField of ['"mode"', '"dialect"', '"script"', '"posix-sh"', '"powershell"']) {
    assert.ok(shellStartSchema.includes(requiredField), `ShellStartTool schema is missing ${requiredField}`);
  }

  const discoverySources = runtime.registry.listDiscoverySources();
  const toolSearchDefinition = runtime.services.pi.toolDefinitions().find((tool) => tool.name === "ToolSearchTool");
  assert.ok(toolSearchDefinition);
  const toolSearchProperties = readRecord(toolSearchDefinition.parameters.properties);
  const preferredSourcesSchema = readRecord(toolSearchProperties.preferredSources);
  const preferredSourceItems = readRecord(preferredSourcesSchema.items);
  assert.deepEqual(
    preferredSourceItems.enum,
    discoverySources.map((source) => source.id),
  );
  for (const source of discoverySources) {
    assert.ok(toolSearchDefinition.description.includes(`${source.id}: ${source.title}`));
  }

  assert.ok(runtime.services.pi.activeToolNames().includes("ShellCommandTool"));
  assert.ok(runtime.services.pi.activeToolNames().includes("WorkspaceApplyPatch"));
  const initialLoadedTools = await runtime.toolSearch.resolveInitialLoadedTools(
    "shell command terminal execute workspace inspection",
  );
  assert.ok(initialLoadedTools.includes("ShellCommandTool"));

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
  assert.ok(loadedTools.includes("ToolSearchTool"));

  let observedAutoSearch:
    | {
        requestId: string;
        query: string;
        loadedToolNames: LoadedToolsState;
      }
    | undefined;

  const runtimeModule: AgentRuntimeModule = {
    id: "verify.retrieval-observer",
    services: ({ services }) => [
      {
        service: "retrieval",
        create: () => ({
          ...services.retrieval,
          rememberAutoSearch: (requestId, query, loadedToolNames) => {
            observedAutoSearch = {
              requestId,
              query,
              loadedToolNames,
            };
            return services.retrieval.rememberAutoSearch(requestId, query, loadedToolNames);
          },
        }),
      },
    ],
  };

  const services = new AgentRuntimeModuleComposer().compose(runtime.services, [runtimeModule]);
  services.retrieval.rememberAutoSearch("verify-runtime-services", "项目结构", loadedTools);

  assert.deepEqual(observedAutoSearch, {
    requestId: "verify-runtime-services",
    query: "项目结构",
    loadedToolNames: loadedTools,
  });

  observedAutoSearch = undefined;
  const runtimeWithModule = AgentSystemRuntime.load({
    workspaceRoot,
    configPath,
    runtimeModules: [runtimeModule],
    toolSearchMemoryStore: isolatedConfig.createToolSearchMemoryStore(),
  });
  runtimeWithModule.services.retrieval.rememberAutoSearch("verify-runtime-module", "模块装配", loadedTools);
  assert.deepEqual(observedAutoSearch, {
    requestId: "verify-runtime-module",
    query: "模块装配",
    loadedToolNames: loadedTools,
  });

  await Promise.all([runtime.close(), runtimeWithModule.close()]);

  console.log("Agent runtime services verification passed.");
} finally {
  await isolatedConfig.dispose();
}

function readRecord(value: unknown): Record<string, unknown> {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}
