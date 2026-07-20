import assert from "node:assert/strict";
import {
  AgentRuntimeModuleComposer,
  type AgentRuntimeModule,
} from "../Source/AgentSystem/Runtime/AgentRuntimeModule.js";
import { AgentSystemRuntime } from "../Source/AgentSystem/Runtime/AgentSystemRuntime.js";
import type { LoadedToolsState } from "../Source/AgentSystem/ToolSearch/AgentToolSearchRuntime.js";
import { SeneraMicrosandboxDefaults } from "../Source/AgentSystem/Execution/SeneraMicrosandboxDefaults.js";
import { verificationConfigPath } from "./VerificationConfig.js";

const workspaceRoot = process.cwd();
const configPath = verificationConfigPath(workspaceRoot);
const runtime = AgentSystemRuntime.load({ workspaceRoot, configPath });

assert.ok(runtime.services.planning);
assert.ok(runtime.services.retrieval);
assert.ok(runtime.services.promptContext);
assert.ok(runtime.services.pi);
assert.ok(runtime.services.execution);
assert.equal(runtime.services.pi.model().id, runtime.modelProviderConfig.Model);

const skills = runtime.services.promptContext.activateSkills({
  input: "检查项目结构并总结作用",
});
assert.ok(Array.isArray(skills));

const workflowSkills = runtime.services.promptContext.activateSkills({
  input: "继续全面优化拓展代码质量，不要硬编码，运行测试验证直到完成",
});
assert.equal(
  workflowSkills.some((skill) => skill.name === "ExecutionWorkflowSkill"),
  true,
);
assert.ok(runtime.services.promptContext.recommendedSkillTools(workflowSkills).includes("WorkspaceApplyPatch"));
assert.ok(runtime.services.promptContext.recommendedSkillTools(workflowSkills).includes("ShellCommandTool"));
const investigationSkills = runtime.services.promptContext.activateSkills({
  input: "现在的 shell 工具怎么实现的，读取 SeneraShellPlatform 的片段并分析",
});
assert.ok(runtime.services.promptContext.recommendedSkillTools(investigationSkills).includes("ShellCommandTool"));

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
assert.deepEqual(baseContext.ExecutionEnvironment.executionTargets.sandboxPreferred, {
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

const shellSearchResults = runtime.toolSearch.search({
  query: "PowerShell Get-Content read file slice rg search shell",
  includeLoaded: true,
  loadedToolNames: [],
});
assert.ok(shellSearchResults.some((result) => result.toolName === "ShellCommandTool"));
const patchSearchResults = runtime.toolSearch.search({
  query: "apply patch modify code add file move file unified hunk",
  includeLoaded: true,
  loadedToolNames: [],
});
assert.ok(patchSearchResults.some((result) => result.toolName === "WorkspaceApplyPatch"));

const answerRootCommand = runtime.services.promptContext.buildRootCommand({
  decision: { action: "answer" },
  loadedToolNames: [],
});
assert.equal(answerRootCommand.action, "answer");

const loadedTools = runtime.services.retrieval.resolvePlannedLoadedTools({
  input: "检查项目结构并总结作用",
  loadedTools: "dynamic",
  preferredTools: [],
  queries: ["项目结构"],
  needs: [],
  discover: true,
});
assert.ok(loadedTools === "all" || Array.isArray(loadedTools));

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
});
runtimeWithModule.services.retrieval.rememberAutoSearch("verify-runtime-module", "模块装配", loadedTools);
assert.deepEqual(observedAutoSearch, {
  requestId: "verify-runtime-module",
  query: "模块装配",
  loadedToolNames: loadedTools,
});

await Promise.all([runtime.close(), runtimeWithModule.close()]);

console.log("Agent runtime services verification passed.");
