import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";

/**
 * The single runtime-owned contract for operating Senera itself.
 *
 * Prompt templates and Skills are projections of this contract. They may add
 * procedure and examples, but they must not invent a different authority or
 * mutation lifecycle.
 */
export interface AgentWorkbenchPrinciple {
  readonly id: string;
  readonly key: string;
  readonly text: string;
  readonly scope: "self-service" | "conversation";
  readonly authority: "runtime" | "host-observation" | "session";
  readonly enforcedBy: string;
}

const principleDefinitions = [
  {
    id: "evidence.first",
    key: "evidenceFirst",
    text: "先读取运行时快照或工具结果，再作状态判断；没有成功结果就不能声称变更完成。",
    scope: "self-service",
    authority: "host-observation",
    enforcedBy: "AgentSelfCommandResult",
  },
  {
    id: "degradation.explicit",
    key: "noSilentDowngrades",
    text: "能力、路径或服务不可用时必须明确报告失败，不得静默改用未声明的替代路径。",
    scope: "self-service",
    authority: "runtime",
    enforcedBy: "AgentCapabilityBoundary",
  },
  {
    id: "mutation.governed",
    key: "governedSelfModification",
    text: "配置、预设和宿主状态只能通过受控命令面修改，不能直接写原始文件或数据库。",
    scope: "self-service",
    authority: "runtime",
    enforcedBy: "SeneraCommand",
  },
  {
    id: "mutation.verify",
    key: "verifyAfterMutation",
    text: "每次变更都要用新的快照或诊断结果验证，并保留 revision 以便回滚。",
    scope: "self-service",
    authority: "host-observation",
    enforcedBy: "AgentConfigService",
  },
  {
    id: "activation.scoped",
    key: "scopedActivation",
    text: "会话级选择与全局默认分离；正在运行的轮次保持原模型，下一轮按已验证的会话偏好生效。",
    scope: "conversation",
    authority: "session",
    enforcedBy: "AgentSessionStore",
  },
  {
    id: "cache.conversation-stable",
    key: "stableConversationCache",
    text: "会话的冻结提示词、工具契约和缓存作用域保持稳定；动态变化延迟到下一轮或下一会话，并记录失效原因。",
    scope: "conversation",
    authority: "runtime",
    enforcedBy: "AgentPiPromptCache",
  },
  {
    id: "skill.source-integrity",
    key: "skillSourceIntegrity",
    text: "Skill 必须来自已注册来源并通过校验；同名来源冲突显式报告，不使用未声明的优先级回退。",
    scope: "self-service",
    authority: "runtime",
    enforcedBy: "AgentSkillScanner",
  },
  {
    id: "skill.mutation-boundary",
    key: "skillMutationBoundary",
    text: "Skill 创建、更新、归档、恢复和学习生成只能作用于唯一工作区来源，必须经过审批、完整文档校验、revision 并发保护与可恢复历史；系统 Skill 只读。",
    scope: "self-service",
    authority: "runtime",
    enforcedBy: "AgentSkillActivationService",
  },
] as const satisfies readonly AgentWorkbenchPrinciple[];

const frozenPrinciples = Object.freeze(principleDefinitions.map((principle) => Object.freeze(principle)));

const contractBody = {
  id: "senera.workbench",
  version: 1 as const,
  authority: "runtime" as const,
  principles: frozenPrinciples,
} as const;

export const AgentWorkbenchContract = Object.freeze({
  ...contractBody,
  revision: sha256HexOfCanonicalJson(contractBody),
});

export type AgentWorkbenchPrincipleKey = (typeof frozenPrinciples)[number]["key"];
export type AgentWorkbenchPrincipleId = (typeof frozenPrinciples)[number]["id"];

export interface AgentWorkbenchContractProjection {
  readonly id: string;
  readonly version: number;
  readonly authority: string;
  readonly revision: string;
  readonly principles: readonly AgentWorkbenchPrinciple[];
}

export interface AgentWorkbenchRuleProjection {
  readonly id: AgentWorkbenchPrincipleId;
  readonly key: AgentWorkbenchPrincipleKey;
  readonly scope: AgentWorkbenchPrinciple["scope"];
  readonly authority: AgentWorkbenchPrinciple["authority"];
  readonly enforcedBy: string;
}

export interface AgentWorkbenchContractIndexProjection {
  readonly id: string;
  readonly version: number;
  readonly authority: string;
  readonly revision: string;
  readonly rules: readonly AgentWorkbenchRuleProjection[];
}

export function projectAgentWorkbenchContract(): AgentWorkbenchContractProjection {
  return {
    id: AgentWorkbenchContract.id,
    version: AgentWorkbenchContract.version,
    authority: AgentWorkbenchContract.authority,
    revision: AgentWorkbenchContract.revision,
    principles: AgentWorkbenchContract.principles,
  };
}

/** Returns the compact rule index used by capabilities and diagnostics. */
export function projectAgentWorkbenchRuleIndex(): readonly AgentWorkbenchRuleProjection[] {
  return AgentWorkbenchContract.principles.map(({ id, key, scope, authority, enforcedBy }) => ({
    id,
    key,
    scope,
    authority,
    enforcedBy,
  }));
}

export function projectAgentWorkbenchPhilosophy(): Readonly<Record<AgentWorkbenchPrincipleKey, string>> {
  return Object.freeze(
    Object.fromEntries(AgentWorkbenchContract.principles.map((principle) => [principle.key, principle.text])) as Record<
      AgentWorkbenchPrincipleKey,
      string
    >,
  );
}

/**
 * Stable, low-token prompt index. Full rule text stays behind the capabilities
 * command; the model can carry rule identities and ask for the live contract
 * only when a self-service task needs it.
 */
export function renderAgentWorkbenchContractIndex(): string {
  const rules = AgentWorkbenchContract.principles.map(
    ({ id, scope, authority, enforcedBy }) =>
      `    <rule id="${escapeXml(id)}" scope="${scope}" authority="${authority}" enforcedBy="${escapeXml(enforcedBy)}" />`,
  );
  return [
    `<senera_workbench_contract id="${AgentWorkbenchContract.id}" version="${AgentWorkbenchContract.version}" revision="${AgentWorkbenchContract.revision}">`,
    ...rules,
    "</senera_workbench_contract>",
  ].join("\n");
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&apos;";
      default:
        return character;
    }
  });
}
