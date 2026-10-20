import { AgentSelfPhilosophy } from "./AgentSelfPhilosophy.js";
import { projectAgentSelfCommandCapabilities, type AgentSelfCommandCapability } from "./AgentSelfCommandRegistry.js";
import { projectAgentSelfCommandContract, type AgentSelfCommandContractSnapshot } from "./AgentSelfCommandContract.js";
import {
  AgentWorkbenchContract,
  projectAgentWorkbenchRuleIndex,
  type AgentWorkbenchContractIndexProjection,
} from "./AgentWorkbenchContract.js";
import { projectAgentSelfHarnessDisclosure, type AgentSelfHarnessDisclosure } from "./AgentSelfHarness.js";

export interface AgentSelfCapabilitiesReport {
  readonly protocolVersion: 1;
  readonly workbenchContract: AgentWorkbenchContractIndexProjection;
  readonly commandContract: Pick<AgentSelfCommandContractSnapshot, "version" | "revision">;
  readonly commands: readonly AgentSelfCommandCapability[];
  readonly harness: AgentSelfHarnessDisclosure;
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
    harness: projectAgentSelfHarnessDisclosure(),
    invariants: AgentSelfPhilosophy,
    mutationWorkflow: [
      "先用 capabilities/status/config get 读取当前事实。",
      "只执行满足用户意图的最小变更；敏感路径等待审批结果。",
      "用 config check、status 或新的配置快照验证变更，并记录返回的 revision。",
      "验证失败时使用 config history 和 config rollback 恢复，不直接改原始文件。",
      "预设先用 preset list/status/read 发现和检查 Markdown，再用 preset enable/disable 切换并重新读取 status 验证。",
      "渠道先用 channels list/get 读取脱敏配置，再用 channels update 修改单个字段；配置服务负责校验、审批、revision 和回读验证。",
      "Skill 变更先读取来源与 revision；只写工作区 Skill，经过审批和校验后再激活，使用 skills history/restore 恢复。",
      "排查运行问题先用 logs health/streams 确认日志存储和流，再按意图使用 logs latest/range/session/trace；有 nextCursor 时只用 logs next 继续读取，不要直接扫描或修改 .senera/logs。",
      "需要还原一次请求时用 logs trace REQUEST_ID，再用返回的 detailId 调用 logs detail；日志是脱敏证据，不能替代运行时快照。",
      "Skill 使用先用 skills list/search/inspect/read/check 确认来源与 revision，再用 logs latest/range/trace 核验实际激活、工具调用和失败原因。",
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
    `Harness 板块: ${report.harness.domains.join(", ")} · 入口: ${report.harness.tool} ${report.harness.discovery}`,
    "变更流程: 读取事实 → 最小变更 → 验证 revision → 必要时回滚。",
    "所有宿主配置和状态变更必须通过 SeneraCommand；不可直接写 .senera 或数据库。",
  ].join("\n");
}
