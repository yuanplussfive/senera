import type { AgentRuntimeDependencyDescriptor } from "./AgentRuntimeDependencyTypes.js";

export const AgentRuntimeDependencyCatalog = [
  {
    id: "agent-browser",
    kind: "controller",
    displayName: { "zh-CN": "agent-browser 控制器", "en-US": "agent-browser controller" },
    description: {
      "zh-CN": "负责驱动浏览器会话、页面快照和交互操作的本机控制器。",
      "en-US": "The local controller for browser sessions, page snapshots, and interactions.",
    },
    capabilities: ["browser-controller"],
    installable: false,
  },
  {
    id: "chromium",
    kind: "browser",
    displayName: { "zh-CN": "Chromium 浏览器内核", "en-US": "Chromium browser engine" },
    description: {
      "zh-CN": "由 agent-browser 官方安装流程管理，用于浏览器自动化和页面渲染。",
      "en-US": "Managed by the official agent-browser installer for automation and page rendering.",
    },
    capabilities: ["browser-page", "browser-screenshot", "browser-form"],
    installable: true,
    installCommand: ["install"],
  },
] as const satisfies readonly AgentRuntimeDependencyDescriptor[];

export function findAgentRuntimeDependency(dependencyId: string): AgentRuntimeDependencyDescriptor | undefined {
  return AgentRuntimeDependencyCatalog.find((dependency) => dependency.id === dependencyId);
}
