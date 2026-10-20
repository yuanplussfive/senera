import type {
  AgentSelfCommand,
  AgentSelfCommandOutput,
  AgentSelfServicePort,
  AgentSelfSkillCheckReport,
  AgentSelfSkillMutationResult,
  AgentSelfSkillSearchMatch,
  AgentSelfSkillSummary,
} from "./AgentSelfServiceTypes.js";
import type { AgentSelfCommandExecutionOptions } from "./AgentSelfApprovalTypes.js";
import { stringifyAgentCanonicalJson } from "../Core/AgentCanonicalJson.js";

const SkillMutationApprovalReason = "Skill 会改变后续模型行为，需要确认工作区指令资产的变更。";

type AgentSelfSkillMutationCommand = Extract<
  AgentSelfCommand,
  { readonly command: "skills"; readonly action: "create" | "update" | "archive" | "restore" }
>;

type DeferredApprovalProjector = (
  command: AgentSelfCommand,
  approvalId: string,
  reason: string,
  deadlineAt: string,
) => AgentSelfCommandOutput;

export async function executeAgentSelfSkills(
  invocation: Extract<AgentSelfCommand, { readonly command: "skills" }>,
  port: AgentSelfServicePort,
  options: AgentSelfCommandExecutionOptions,
  projectDeferredApproval: DeferredApprovalProjector,
): Promise<AgentSelfCommandOutput> {
  if (!port.skills) {
    return { ok: false, text: "Skill 主机不可用（当前服务未绑定 Skill 来源）。", error: "skills_unavailable" };
  }
  switch (invocation.action) {
    case "list": {
      const skills = port.skills.list();
      return {
        ok: skills.every((skill) => skill.valid),
        text: describeSkills(skills),
        data: { skills },
      };
    }
    case "search": {
      if (!port.skills.search) {
        return {
          ok: false,
          text: "Skill 检索主机不可用（当前服务未绑定 Skill 搜索实现）。",
          error: "skills_search_unavailable",
        };
      }
      const matches = port.skills.search(invocation.query, invocation.limit);
      return {
        ok: true,
        text: describeSkillSearch(matches),
        data: { query: invocation.query, results: matches },
      };
    }
    case "inspect": {
      const result = port.skills.inspect(invocation.name);
      if (result.status === "missing" || result.status === "ambiguous") {
        return {
          ok: false,
          text: result.error,
          error: projectSkillReadError(result.status),
          data: result,
        };
      }
      return {
        ok: result.skill.valid,
        text: result.content,
        ...(result.skill.valid ? {} : { error: "skill_invalid" }),
        data: result,
      };
    }
    case "resources": {
      const result = port.skills.resources(invocation.name);
      if (result.status !== "found") {
        return {
          ok: false,
          text: result.error,
          error: projectSkillReadError(result.status),
          data: result,
        };
      }
      return {
        ok: true,
        text: describeSkillResources(result.resources),
        data: result,
      };
    }
    case "read": {
      const result = port.skills.readResource(invocation.name, invocation.path, invocation.revision);
      if (result.status === "stale") {
        return {
          ok: false,
          text: `Skill revision 已变化（期望 ${result.expectedRevision}，实际 ${result.actualRevision}），请重新读取资源清单。`,
          error: "skill_revision_conflict",
          data: result,
        };
      }
      if (result.status !== "found") {
        return {
          ok: false,
          text: result.error,
          error: result.status === "missing" ? "skill_not_found" : "skill_ambiguous",
          data: result,
        };
      }
      return {
        ok: true,
        text:
          result.resource.encoding === "utf8" ? result.resource.content : stringifyAgentCanonicalJson(result.resource),
        data: result,
      };
    }
    case "diff": {
      const result = port.skills.diff(invocation.name, invocation.revision);
      if (result.status !== "found") {
        return {
          ok: false,
          text: result.error,
          error: result.status === "missing" ? "skill_revision_not_found" : projectSkillReadError(result.status),
          data: result,
        };
      }
      return {
        ok: true,
        text: describeSkillDiff(result.entries),
        data: result,
      };
    }
    case "check": {
      const report = port.skills.check(invocation.name);
      return {
        ok: report.valid,
        text: describeSkillCheck(report),
        data: report,
        ...(report.valid ? {} : { error: "skill_check_failed" }),
      };
    }
    case "history": {
      const history = port.skills.history(invocation.name);
      return {
        ok: true,
        text:
          history.length === 0
            ? `Skill ${invocation.name} 没有可恢复的历史修订。`
            : history.map((entry) => `${entry.revision} · ${entry.action} · ${entry.createdAt}`).join("\n"),
        data: { name: invocation.name, history },
      };
    }
    case "create":
    case "update":
    case "archive":
    case "restore":
      return executeSkillMutation(invocation, port, options, projectDeferredApproval);
  }
}

export function isSkillMutationCommand(command: AgentSelfCommand): command is AgentSelfSkillMutationCommand {
  return (
    command.command === "skills" &&
    (command.action === "create" ||
      command.action === "update" ||
      command.action === "archive" ||
      command.action === "restore")
  );
}

export function executeSkillMutationDirect(
  invocation: AgentSelfSkillMutationCommand,
  port: AgentSelfServicePort,
): AgentSelfCommandOutput {
  if (!port.skills) {
    return { ok: false, text: "Skill 主机不可用（当前服务未绑定 Skill 来源）。", error: "skills_unavailable" };
  }
  switch (invocation.action) {
    case "create":
      return projectSkillMutation(port.skills.create(invocation.name, invocation.content), invocation.name);
    case "update":
      return projectSkillMutation(
        port.skills.update(invocation.name, invocation.content, invocation.expectedRevision),
        invocation.name,
      );
    case "archive":
      return projectSkillMutation(port.skills.archive(invocation.name, invocation.expectedRevision), invocation.name);
    case "restore":
      return projectSkillMutation(port.skills.restore(invocation.name, invocation.revision), invocation.name);
  }
}

async function executeSkillMutation(
  invocation: AgentSelfSkillMutationCommand,
  port: AgentSelfServicePort,
  options: AgentSelfCommandExecutionOptions,
  projectDeferredApproval: DeferredApprovalProjector,
): Promise<AgentSelfCommandOutput> {
  const channel = options.approvals;
  if (!channel) {
    return {
      ok: false,
      text: "Skill 变更需要审批，但当前执行环境没有可用的审批通道。",
      error: "approval_denied",
    };
  }
  const verdict = await channel.request({
    kind: "skill",
    command: invocation,
    skillName: invocation.name,
    operation: invocation.action,
    reason: SkillMutationApprovalReason,
    mode: options.approvalMode,
  });
  if (verdict.status === "denied") return { ok: false, text: verdict.message, error: "approval_denied" };
  if (verdict.status === "deferred") {
    return projectDeferredApproval(invocation, verdict.approvalId, SkillMutationApprovalReason, verdict.deadlineAt);
  }
  return executeSkillMutationDirect(invocation, port);
}

function projectSkillMutation(result: AgentSelfSkillMutationResult, name: string): AgentSelfCommandOutput {
  switch (result.status) {
    case "created":
      return { ok: true, text: `已创建 Skill ${name}（revision ${result.revision}）。`, data: result };
    case "updated":
      return { ok: true, text: `已更新 Skill ${name}（revision ${result.revision}）。`, data: result };
    case "restored":
      return { ok: true, text: `已恢复 Skill ${name}（revision ${result.revision}）。`, data: result };
    case "archived":
      return { ok: true, text: `已归档 Skill ${name}（revision ${result.revision}）。`, data: result };
    case "exists":
      return { ok: false, text: `Skill 已存在: ${name}`, error: "skill_exists", data: result };
    case "missing":
      return { ok: false, text: `Skill 不存在: ${name}`, error: "skill_not_found", data: result };
    case "conflict":
      return {
        ok: false,
        text: `Skill ${name} 的 revision 已变化（期望 ${result.expectedRevision}，实际 ${result.actualRevision ?? "unknown"}）。请重新读取后再写入。`,
        error: "skill_revision_conflict",
        data: result,
      };
    case "invalid":
      return {
        ok: false,
        text: `Skill ${name} 无法写入:\n${result.issues.join("\n")}`,
        error: "skill_invalid",
        data: result,
      };
    case "failed":
      return {
        ok: false,
        text: `Skill ${name} 变更失败: ${result.error}`,
        error: "skill_mutation_failed",
        data: result,
      };
    case "unavailable":
      return { ok: false, text: result.reason, error: "skills_unavailable", data: result };
  }
}

function describeSkills(skills: readonly AgentSelfSkillSummary[]): string {
  if (skills.length === 0) return "未发现 Skill。";
  return skills
    .map((skill) => {
      const status = skill.valid ? "有效" : `无效: ${skill.issues.join("；")}`;
      const invocation = skill.disableModelInvocation ? " · 仅显式调用" : "";
      return `${skill.name} · ${skill.source.displayName} · revision ${skill.revision ?? "unknown"}${invocation} · ${status}`;
    })
    .join("\n");
}

function describeSkillSearch(matches: readonly AgentSelfSkillSearchMatch[]): string {
  if (matches.length === 0) return "没有找到匹配的有效 Skill；请先使用 senera skills list/check 检查来源。";
  return matches
    .map((match) => {
      const terms = match.matchedTerms.length > 0 ? ` · 命中 ${match.matchedTerms.join(", ")}` : "";
      const mode = match.skill.disableModelInvocation ? " · 仅显式调用" : "";
      return `${match.skill.name} · ${match.skill.source.displayName} · score ${match.score.toFixed(3)}${mode}${terms}`;
    })
    .join("\n");
}

function describeSkillCheck(report: AgentSelfSkillCheckReport): string {
  const header = `Skill 校验 ${report.valid ? "通过" : "失败"} · ${report.skills.length} 个 · ${report.checkedAt}`;
  return report.issues.length > 0 ? [header, ...report.issues.map((issue) => `- ${issue}`)].join("\n") : header;
}

function describeSkillResources(
  resources: readonly {
    readonly relativePath: string;
    readonly kind: string;
    readonly bytes: number;
    readonly digest: string;
  }[],
): string {
  if (resources.length === 0) return "Skill 没有可读取资源。";
  return resources
    .map(
      (resource) =>
        `${resource.relativePath} · ${resource.kind} · ${resource.bytes} bytes · ${resource.digest.slice(0, 12)}`,
    )
    .join("\n");
}

function describeSkillDiff(entries: readonly { readonly path: string; readonly kind: string }[]): string {
  if (entries.length === 0) return "Skill 包没有资源差异。";
  return entries.map((entry) => `${entry.kind.padEnd(9)} ${entry.path}`).join("\n");
}

function projectSkillReadError(status: "missing" | "ambiguous" | "invalid"): string {
  return { missing: "skill_not_found", ambiguous: "skill_ambiguous", invalid: "skill_invalid" }[status];
}
