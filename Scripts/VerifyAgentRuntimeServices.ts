import assert from "node:assert/strict";
import { AgentRuntimeModuleComposer, type AgentRuntimeModule } from "../Source/AgentSystem/AgentRuntimeModule.js";
import { AgentSystemRuntime } from "../Source/AgentSystem/AgentSystemRuntime.js";
import type { LoadedToolsState } from "../Source/AgentSystem/AgentToolSearchRuntime.js";
import { verificationConfigPath } from "./VerificationConfig.js";

const workspaceRoot = process.cwd();
const configPath = verificationConfigPath(workspaceRoot);
const runtime = AgentSystemRuntime.load({ workspaceRoot, configPath });

assert.ok(runtime.services.planning);
assert.ok(runtime.services.retrieval);
assert.ok(runtime.services.promptContext);
assert.ok(runtime.services.workflow);
assert.ok(runtime.services.execution);

const skills = runtime.services.promptContext.activateSkills({
  input: "检查项目结构并总结作用",
});
assert.ok(Array.isArray(skills));

const toolCatalog = runtime.services.promptContext.toolCatalog();
assert.ok(toolCatalog.length > 0);
const visibleToolName = toolCatalog[0].name;

const baseContext = runtime.services.promptContext.buildBaseContext({
  loadedToolNames: [visibleToolName],
});
assert.ok(baseContext.ToolCards.some((tool) => tool.name === visibleToolName));

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

let observedAutoSearch: {
  requestId: string;
  query: string;
  loadedToolNames: LoadedToolsState;
} | undefined;

const runtimeModule: AgentRuntimeModule = {
  id: "verify.retrieval-observer",
  services: ({ services }) => [{
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
  }],
};

const services = new AgentRuntimeModuleComposer().compose(runtime.services, [runtimeModule]);
services.retrieval.rememberAutoSearch(
  "verify-runtime-services",
  "项目结构",
  loadedTools,
);

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
runtimeWithModule.services.retrieval.rememberAutoSearch(
  "verify-runtime-module",
  "模块装配",
  loadedTools,
);
assert.deepEqual(observedAutoSearch, {
  requestId: "verify-runtime-module",
  query: "模块装配",
  loadedToolNames: loadedTools,
});

runtime.toolSearch.close();
runtimeWithModule.toolSearch.close();

console.log("Agent runtime services verification passed.");
