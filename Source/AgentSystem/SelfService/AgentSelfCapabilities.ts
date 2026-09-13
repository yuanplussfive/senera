import { AgentSelfPhilosophy } from "./AgentSelfPhilosophy.js";
import { projectAgentSelfCommandCapabilities, type AgentSelfCommandCapability } from "./AgentSelfCommandRegistry.js";
import {
  projectAgentSelfCommandContract,
  type AgentSelfCommandContractSnapshot,
} from "./AgentSelfCommandContract.js";
import {
  AgentWorkbenchContract,
  projectAgentWorkbenchRuleIndex,
  type AgentWorkbenchContractIndexProjection,
} from "./AgentWorkbenchContract.js";

export interface AgentSelfCapabilitiesReport {
  readonly protocolVersion: 1;
  readonly workbenchContract: AgentWorkbenchContractIndexProjection;
  readonly commandContract: Pick<AgentSelfCommandContractSnapshot, "version" | "revision">;
  readonly commands: readonly AgentSelfCommandCapability[];
  readonly invariants: Readonly<Record<string, string>>;
  readonly mutationWorkflow: readonly string[];
}

export function projectAgentSelfCapabilities(): AgentSelfCapabilitiesReport {
  return {
    protocolVersion: 1,
    workbenchContract: {
      id: AgentWorkbenchContract.id,
      version: AgentWorkbenchContract.version,
      authority: AgentWorkbenchContract.authority,
      revision: AgentWorkbenchContract.revision,
      rules: projectAgentWorkbenchRuleIndex(),
    },
    commandContract: projectAgentSelfCommandContract(),
    commands: projectAgentSelfCommandCapabilities(),
    invariants: AgentSelfPhilosophy,
    mutationWorkflow: [
      "先用 capabilities/status/config get 读取当前事实。",
      "只执行满足用户意图的最小变更；敏感路径等待审批结果。",
      "用 config check、status 或新的配置快照验证变更，并记录返回的 revision。",
      "验证失败时使用 config history 和 config rollback 恢复，不直接改原始文件。",
      "Skill 变更先读取来源与 revision；只写工作区 Skill，经过审批和校验后再激活，使用 skills history/restore 恢复。",
    ],
  };
}

export function describeAgentSelfCapabilities(report: AgentSelfCapabilitiesReport): string {
  const builtIns = report.commands.filter((command) => command.source === "builtin").length;
  const plugins = report.commands.length - builtIns;
  return [
    `自服务协议 v${report.protocolVersion} · 内置命令 ${builtIns} 个 · 插件命令 ${plugins} 个`,
    `Workbench 合同 ${report.workbenchContract.id}/v${report.workbenchContract.version} · revision ${report.workbenchContract.revision}`,
    `命令合同 v${report.commandContract.version} · revision ${report.commandContract.revision}`,
    "变更流程: 读取事实 → 最小变更 → 验证 revision → 必要时回滚。",
    "所有宿主配置、预设和状态变更必须通过 SeneraCommand；不可直接写 .senera 或数据库。",
  ].join("\n");
}
