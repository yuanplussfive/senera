import type {
  AgentSelfCommand,
  AgentSelfCommandOutput,
  AgentSelfServicePort,
  AgentSelfSkillCheckReport,
  AgentSelfSkillMutationResult,
  AgentSelfSkillSearchMatch,
  AgentSelfSkillSummary,
} from "./AgentSelfServiceTypes.js";
import type { AgentSelfApprovalVerdict, AgentSelfCommandExecutionOptions } from "./AgentSelfApprovalTypes.js";
import type { AgentSelfConfigAdjudication } from "./AgentSelfApprovalTypes.js";
import {
  resolveAgentSelfConfigPathRule,
  validateAgentSelfConfigPathValue,
  type AgentSelfConfigPathRule,
} from "./AgentSelfSensitivePath.js";
import {
  diffAgentSelfConfigPaths,
  projectAgentSelfEndpoints,
  projectAgentSelfModels,
  readAgentSelfConfigPath,
  rollbackAgentSelfConfigPath,
  updateAgentSelfConfigPath,
} from "./AgentSelfConfig.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import {
  listAgentSelfPresets,
  showAgentSelfPreset,
  activateAgentSelfPreset,
  saveAgentSelfPreset,
} from "./AgentSelfPreset.js";
import { describeAgentSelfWorkspace, projectAgentSelfWorkspaceInfo } from "./AgentSelfWorkspace.js";
import { describeAgentSelfDoctor, projectAgentSelfDoctorReport } from "./AgentSelfDoctor.js";
import { listAgentSelfSessions } from "./AgentSelfSessions.js";
import { describeAgentSelfStatus, projectAgentSelfStatus } from "./AgentSelfStatus.js";
import { listAgentSelfLogs, readAgentSelfLogTail } from "./AgentSelfLogs.js";
import { projectAgentSelfRedacted } from "./AgentSelfRedaction.js";
import { findAgentSelfPluginCommand, listAgentSelfBuiltinCommandSpecs } from "./AgentSelfCommandRegistry.js";
import { AgentSelfCommandSchema, AgentSelfPluginCommandEnvelopeSchema } from "./AgentSelfCommandSchema.js";
import type { AgentSelfInvocation } from "./AgentSelfServiceTypes.js";
import { describeAgentSelfCapabilities, projectAgentSelfCapabilities } from "./AgentSelfCapabilities.js";
import { resolveModelProviderCatalog } from "../AgentDefaults.js";
import { createModelProviderMetadata } from "../ModelEndpoints/AgentModelMetadata.js";
import { stringifyAgentCanonicalJson } from "../Core/AgentCanonicalJson.js";
import { readAgentUnknownRecord } from "../Core/AgentUnknownValue.js";

const SkillMutationApprovalReason = "Skill 会改变后续模型行为，需要确认工作区指令资产的变更。";

/** Single entry point for every `senera ...` self-service command. */
export async function executeAgentSelfCommand(
  invocation: AgentSelfCommand,
  port: AgentSelfServicePort,
  options: AgentSelfCommandExecutionOptions = {},
): Promise<AgentSelfCommandOutput> {
  try {
    switch (invocation.command) {
      case "config":
        return await executeConfig(invocation, port, options);
      case "approval":
        return await executeApprovalResolve(invocation, port, options);
      case "preset":
        return await executePreset(invocation, port);
      case "workspace":
        return {
          ok: true,
          text: describeAgentSelfWorkspace(projectAgentSelfWorkspaceInfo(port)),
          data: projectAgentSelfWorkspaceInfo(port),
        };
      case "sessions":
        return listAgentSelfSessions(port);
      case "session":
        return await executeSessionModel(invocation, port);
      case "plugins":
        return describeAgentSelfPlugins(port);
      case "skills":
        return await executeSkills(invocation, port, options);
      case "capabilities": {
        const report = projectAgentSelfCapabilities();
        return { ok: true, text: describeAgentSelfCapabilities(report), data: report };
      }
      case "logs":
        return executeLogs(invocation, port);
      case "status": {
        const report = projectAgentSelfStatus(port);
        return { ok: true, text: describeAgentSelfStatus(report), data: report };
      }
      case "doctor": {
        const report = await projectAgentSelfDoctorReport(port);
        return {
          ok: report.config.valid && report.workspace.writable,
          text: describeAgentSelfDoctor(report),
          data: report,
        };
      }
    }
  } catch (error) {
    return {
      ok: false,
      text: error instanceof Error ? error.message : String(error),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function executeSessionModel(
  invocation: Extract<AgentSelfCommand, { command: "session"; action: "model" }>,
  port: AgentSelfServicePort,
): Promise<AgentSelfCommandOutput> {
  const sessions = port.sessions;
  if (!sessions) {
    return { ok: false, text: "会话目录不可用（当前主机未绑定会话存储）。", error: "sessions_unavailable" };
  }
  const sessionId = invocation.sessionId?.trim();
  if (!sessionId) {
    return {
      ok: false,
      text: "session model 需要明确的 sessionId；模型工具应使用当前会话绑定，CLI/API 请显式提供。",
      error: "session_id_required",
    };
  }
  if (invocation.operation === "get") {
    if (!sessions.snapshot(sessionId)) {
      return { ok: false, text: `会话不存在: ${sessionId}`, error: "session_not_found" };
    }
    const preference = sessions.getModelPreference(sessionId);
    const runtime = sessions.getModelRuntime(sessionId);
    const effective = runtime?.effective;
    const catalog = resolveModelProviderCatalog(port.config.getSnapshot().value);
    const defaultProvider = createModelProviderMetadata(catalog.resolve(catalog.defaultId));
    return {
      ok: true,
      text: runtime?.active
        ? `会话 ${sessionId} 当前轮次模型: ${runtime.active.model}（provider ${runtime.active.providerId}，来源 ${runtime.active.source}）`
        : effective
          ? `会话 ${sessionId} 最近完成轮次模型: ${effective.model}（provider ${effective.providerId}，来源 ${effective.source}）`
          : `会话 ${sessionId} 尚无已执行轮次模型。下一轮将按请求、会话偏好或系统默认解析。`,
      data: {
        sessionId,
        effective: effective ?? null,
        preference: runtime?.preference ?? preference ?? null,
        default: { modelProviderId: defaultProvider.id, ...defaultProvider },
        lastRun: runtime?.lastRun ?? null,
        effectiveAt: runtime?.active ? "current" : effective ? "last_run" : "next_turn",
      },
    };
  }

  const requestedModel = invocation.modelProviderId?.trim();
  if (!requestedModel) {
    return {
      ok: false,
      text: "session model set 需要 modelProviderId。",
      error: "model_provider_id_required",
    };
  }
  const resolved = resolveModelProviderCatalog(port.config.getSnapshot().value).resolve(requestedModel);
  const result = await sessions.setModelPreference(sessionId, resolved.Id, "agent");
  if (result.status === "missing") {
    return { ok: false, text: `会话不存在: ${sessionId}`, error: "session_not_found" };
  }
  return {
    ok: true,
    text:
      result.status === "updated"
        ? `已将会话 ${sessionId} 的下一轮模型设置为 ${result.modelProviderId}。当前轮次保持不变。`
        : `会话 ${sessionId} 已经使用 ${result.modelProviderId}，无需重复设置。`,
    data: { sessionId, preference: result, effectiveAt: "next_turn" },
  };
}

/** Dispatches either a built-in command or a command owned by the live plugin
 * registry. This is the shared entry point for HTTP, CLI adapters and the
 * model-facing SeneraCommand tool. */
export async function executeAgentSelfInvocation(
  invocation: AgentSelfInvocation,
  port: AgentSelfServicePort,
  options: AgentSelfCommandExecutionOptions = {},
): Promise<AgentSelfCommandOutput> {
  const builtIn = AgentSelfCommandSchema.safeParse(invocation);
  if (builtIn.success) return executeAgentSelfCommand(builtIn.data, port, options);
  const plugin = AgentSelfPluginCommandEnvelopeSchema.safeParse(invocation);
  if (!plugin.success) {
    return projectInvalidAgentSelfInvocation(builtIn.error.issues, readCommandRoot(invocation));
  }
  if (listAgentSelfBuiltinCommandSpecs().some((spec) => spec.command === plugin.data.command)) {
    return projectInvalidAgentSelfInvocation(builtIn.error.issues, plugin.data.command);
  }
  const entry = findAgentSelfPluginCommand(plugin.data.command, plugin.data.action);
  if (!entry) {
    return {
      ok: false,
      text: `未知命令: ${[plugin.data.command, plugin.data.action].filter(Boolean).join(" ")}（既非内置命令，也非已加载插件命令）。`,
      error: "unknown_command",
    };
  }
  return entry.handler(plugin.data.args ?? [], port, options);
}

/** Converts a catalog-level Zod rejection into the same repairable response
 * used by the direct HTTP/CLI invocation path. */
export function projectAgentSelfInvocationValidationFailure(
  invocation: unknown,
  issues: readonly { readonly code: string; readonly path: readonly PropertyKey[]; readonly message: string }[],
): AgentSelfCommandOutput {
  return projectInvalidAgentSelfInvocation(issues, readCommandRoot(invocation));
}

function readCommandRoot(value: unknown): string | undefined {
  if (!isRecord(value) || typeof value.command !== "string") return undefined;
  const command = value.command.trim();
  return command.length > 0 ? command : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function projectInvalidAgentSelfInvocation(
  issues: readonly { readonly code: string; readonly path: readonly PropertyKey[]; readonly message: string }[],
  command?: string,
): AgentSelfCommandOutput {
  const projected = flattenAgentSelfValidationIssues(issues).slice(0, 8);
  const summary =
    projected.length > 0
      ? projected
          .map((issue) => `${issue.path.length > 0 ? issue.path.join(".") : "(root)"}: ${issue.message}`)
          .join("; ")
      : "参数未通过当前命令契约校验。";
  return {
    ok: false,
    text: `Senera 命令参数无效${command ? `（${command}）` : ""}：${summary}。请先调用 capabilities 获取当前命令契约后重试。`,
    error: "invalid_command",
    data: {
      kind: "schema_validation",
      ...(command ? { command } : {}),
      issues: projected,
      repair: "使用 capabilities 返回的 command/action 和参数名；不要把 CLI 文本字段替换成未声明的字段。",
    },
  };
}

function flattenAgentSelfValidationIssues(value: readonly unknown[]): {
  readonly code: string;
  readonly path: readonly string[];
  readonly message: string;
}[] {
  const flattened: { code: string; path: readonly string[]; message: string }[] = [];
  for (const entry of value) {
    const issue = readAgentUnknownRecord(entry);
    if (!issue) continue;
    const nested = Array.isArray(issue.errors)
      ? issue.errors.flatMap((branch) => (Array.isArray(branch) ? flattenAgentSelfValidationIssues(branch) : []))
      : [];
    if (nested.length > 0) {
      flattened.push(...nested);
      continue;
    }
    if (typeof issue.code !== "string" || typeof issue.message !== "string") continue;
    flattened.push({
      code: issue.code,
      path: Array.isArray(issue.path) ? issue.path.map(String) : [],
      message: issue.message,
    });
  }
  return flattened;
}

async function executeConfig(
  invocation: Extract<AgentSelfCommand, { command: "config" }>,
  port: AgentSelfServicePort,
  options: AgentSelfCommandExecutionOptions,
): Promise<AgentSelfCommandOutput> {
  const effective = () => port.config.getSnapshot().value;
  const redacted = () => projectAgentSelfRedacted(effective());
  switch (invocation.action) {
    case "get": {
      const projected = readAgentSelfConfigPath(redacted(), invocation.path);
      if (!projected.found) return { ok: false, text: projected.error ?? "Config path not found." };
      const text = typeof projected.value === "string" ? projected.value : stringifyAgentCanonicalJson(projected.value);
      return { ok: true, text, data: projected.value };
    }
    case "models": {
      const data = projectAgentSelfModels(effective());
      const text = stringifyAgentCanonicalJson(data);
      return { ok: true, text, data };
    }
    case "endpoints": {
      const data = projectAgentSelfEndpoints(effective());
      const text = stringifyAgentCanonicalJson(data);
      return { ok: true, text, data };
    }
    case "history": {
      const snapshot = port.config.getSnapshot();
      const entries = port.config.history();
      return {
        ok: true,
        text:
          entries.length === 0
            ? "配置历史不可用（未启用配置存储）。"
            : [...entries]
                .reverse()
                .map((entry) => `revision ${entry.revision} · ${entry.source} · ${entry.createdAt}`)
                .join("\n"),
        data: { currentRevision: snapshot.revision, entries },
      };
    }
    case "env-path": {
      const stateRoot = port.slice?.layout.stateRoot;
      const data = {
        workspaceRoot: port.workspaceRoot,
        configPath: port.configPath,
        stateRoot,
      };
      return {
        ok: true,
        text: [
          `工作区: ${port.workspaceRoot}`,
          `配置路径: ${port.configPath ?? "未知（主机未暴露配置文件路径）"}`,
          `状态目录: ${stateRoot ?? "未知"}`,
        ].join("\n"),
        data,
      };
    }
    case "check": {
      const snapshot = port.config.getSnapshot();
      const issues = snapshot.diagnostics.map((diagnostic) => `[${diagnostic.severity}] ${diagnostic.message}`);
      return {
        ok: issues.length === 0,
        text:
          issues.length === 0
            ? `配置有效 (revision ${snapshot.revision ?? "unknown"})。`
            : `配置存在问题:\n${issues.join("\n")}`,
        data: { valid: issues.length === 0, revision: snapshot.revision, issues },
      };
    }
    case "rollback": {
      return await executeConfigRollback(invocation, port, options);
    }
    case "update": {
      const rule = resolveAgentSelfConfigPathRule(invocation.path);
      if (rule) {
        const verdict = await adjudicateAgentSelfConfigUpdate(rule, invocation, options);
        if (verdict.status === "denied") {
          return { ok: false, text: verdict.message, error: "approval_denied" };
        }
        if (verdict.status === "deferred") {
          return projectDeferredApproval(invocation, verdict.approvalId, verdict.reason, verdict.deadlineAt);
        }
      }
      return executeAgentSelfConfigUpdate(port, invocation.path, invocation.value);
    }
  }
}

/**
 * Applies one path/value change through the host config service. Shared by the
 * direct update path and the post-approval replay, so an approved command
 * commits through exactly the same revision-guarded replace.
 */
export function executeAgentSelfConfigUpdate(
  port: AgentSelfServicePort,
  path: string,
  value: unknown,
): AgentSelfCommandOutput {
  const result = updateAgentSelfConfigPath(port, path, value);
  return {
    ok: result.replaced,
    text: result.replaced ? `Updated ${path} (revision ${result.revision}).` : "Config update rejected.",
    data: { path, revision: result.revision },
  };
}

async function executeConfigRollback(
  invocation: Extract<AgentSelfCommand, { command: "config"; action: "rollback" }>,
  port: AgentSelfServicePort,
  options: AgentSelfCommandExecutionOptions,
): Promise<AgentSelfCommandOutput> {
  const target = port.config.readRevision(invocation.revision);
  if (target.status === "unavailable") {
    return { ok: false, text: "配置历史不可用（未启用配置存储）。", error: "history_unavailable" };
  }
  if (target.status === "missing") {
    return {
      ok: false,
      text: `配置修订不存在: ${invocation.revision}（可能已被保留策略清理）。`,
      error: "revision_not_found",
    };
  }
  const verdict = await adjudicateAgentSelfConfigRollback(invocation, target.value, port, options);
  if (verdict.status === "denied") {
    return { ok: false, text: verdict.message, error: "approval_denied" };
  }
  if (verdict.status === "deferred") {
    return projectDeferredApproval(invocation, verdict.approvalId, verdict.reason, verdict.deadlineAt);
  }
  return executeAgentSelfConfigRollback(port, invocation.revision, target.value);
}

/**
 * Restores a historical revision as a new revision. Shared by the direct
 * rollback path and the post-approval replay; both commit through the same
 * revision-guarded replace, so rollback never rewrites history.
 */
export function executeAgentSelfConfigRollback(
  port: AgentSelfServicePort,
  revision: number,
  target: AgentSystemConfig,
): AgentSelfCommandOutput {
  const result = rollbackAgentSelfConfigPath(port, target);
  return {
    ok: result.replaced,
    text: `Rolled back to revision ${revision} (revision ${result.revision}).`,
    data: { restoredFrom: revision, revision: result.revision },
  };
}

async function adjudicateAgentSelfConfigUpdate(
  rule: NonNullable<ReturnType<typeof resolveAgentSelfConfigPathRule>>,
  command: Extract<AgentSelfCommand, { command: "config"; action: "update" }>,
  options: AgentSelfCommandExecutionOptions,
): Promise<AgentSelfConfigAdjudication> {
  if (rule.level === "guard") {
    const verdict = validateAgentSelfConfigPathValue(rule, command.value);
    if (!verdict.valid) return { status: "denied", message: `Config update rejected: ${verdict.message}` };
    return { status: "approved" };
  }
  const channel = options.approvals;
  if (!channel) {
    return {
      status: "denied",
      message: "该配置路径需要审批，但当前执行环境没有可用的审批通道。",
    };
  }
  const verdict = await channel.request({
    kind: "config",
    command,
    path: command.path,
    value: command.value,
    rule,
    mode: options.approvalMode,
  });
  return projectAgentSelfConfigAdjudication(verdict, rule.reason);
}

/**
 * Adjudicates a rollback against the sensitivity rules by diffing the current
 * configuration against the target revision. Any changed guard-level path must
 * validate; the first changed human-level path triggers one approval request.
 */
async function adjudicateAgentSelfConfigRollback(
  command: Extract<AgentSelfCommand, { command: "config"; action: "rollback" }>,
  target: AgentSystemConfig,
  port: AgentSelfServicePort,
  options: AgentSelfCommandExecutionOptions,
): Promise<AgentSelfConfigAdjudication> {
  let trigger: { readonly path: string; readonly value: unknown; readonly rule: AgentSelfConfigPathRule } | undefined;
  for (const change of diffAgentSelfConfigPaths(port.config.getSnapshot().value, target)) {
    const rule = resolveAgentSelfConfigPathRule(change.path);
    if (!rule) continue;
    if (rule.level === "guard") {
      const verdict = validateAgentSelfConfigPathValue(rule, change.after);
      if (!verdict.valid) {
        return { status: "denied", message: `Config rollback rejected: ${change.path} ${verdict.message}` };
      }
      continue;
    }
    trigger ??= { path: change.path, value: change.after, rule };
  }
  if (!trigger) return { status: "approved" };
  const channel = options.approvals;
  if (!channel) {
    return {
      status: "denied",
      message: "回滚涉及敏感配置路径，需要审批，但当前执行环境没有可用的审批通道。",
    };
  }
  const verdict = await channel.request({
    kind: "config",
    command,
    path: trigger.path,
    value: trigger.value,
    rule: trigger.rule,
    mode: options.approvalMode,
  });
  return projectAgentSelfConfigAdjudication(verdict, trigger.rule.reason);
}

function projectAgentSelfConfigAdjudication(
  verdict: AgentSelfApprovalVerdict,
  reason: string,
): AgentSelfConfigAdjudication {
  if (verdict.status === "deferred") {
    return { status: "deferred", approvalId: verdict.approvalId, deadlineAt: verdict.deadlineAt, reason };
  }
  return verdict;
}

function projectDeferredApproval(
  command: AgentSelfCommand,
  approvalId: string,
  reason: string,
  deadlineAt: string,
): AgentSelfCommandOutput {
  return {
    ok: false,
    text: `该操作需要审批: ${reason}`,
    error: "approval_required",
    approvalRequired: { approvalId, command, reason, deadlineAt },
  };
}

async function executeApprovalResolve(
  invocation: Extract<AgentSelfCommand, { command: "approval" }>,
  port: AgentSelfServicePort,
  options: AgentSelfCommandExecutionOptions,
): Promise<AgentSelfCommandOutput> {
  const channel = options.approvals;
  if (!channel?.resolve) {
    return { ok: false, text: "当前执行环境不支持审批决议。", error: "approval_unavailable" };
  }
  const outcome = await channel.resolve(invocation.approvalId, invocation.decision);
  if (outcome.status === "unknown") {
    return { ok: false, text: "审批请求不存在或已过期。", error: "approval_unknown" };
  }
  if (outcome.decision === "deny") {
    return {
      ok: true,
      text: "已拒绝该操作，命令未执行。",
      data: { approvalId: invocation.approvalId, decision: "denied" },
    };
  }
  if (outcome.command.command === "skills" && isSkillMutationCommand(outcome.command)) {
    return projectApprovedReplay(invocation.approvalId, executeSkillMutationDirect(outcome.command, port));
  }
  if (outcome.command.command !== "config") {
    return { ok: false, text: "审批关联的命令不支持重放。", error: "approval_replay_unsupported" };
  }
  if (outcome.command.action === "rollback") {
    const target = port.config.readRevision(outcome.command.revision);
    if (target.status !== "found") {
      return {
        ok: false,
        text: "审批已通过，但目标修订不存在或历史已不可用。",
        error: "approval_replay_failed",
      };
    }
    return projectApprovedReplay(
      invocation.approvalId,
      executeAgentSelfConfigRollback(port, outcome.command.revision, target.value),
    );
  }
  if (outcome.command.action === "update") {
    return projectApprovedReplay(
      invocation.approvalId,
      executeAgentSelfConfigUpdate(port, outcome.command.path, outcome.command.value),
    );
  }
  return { ok: false, text: "审批关联的命令不支持重放。", error: "approval_replay_unsupported" };
}

function isSkillMutationCommand(command: AgentSelfCommand): command is AgentSelfSkillMutationCommand {
  return (
    command.command === "skills" &&
    (command.action === "create" ||
      command.action === "update" ||
      command.action === "archive" ||
      command.action === "restore")
  );
}

function projectApprovedReplay(approvalId: string, executed: AgentSelfCommandOutput): AgentSelfCommandOutput {
  return {
    ...executed,
    text: executed.ok ? `已批准并执行: ${executed.text}` : `审批已通过但执行失败: ${executed.text}`,
    data: { approvalId, decision: "approved", ...(executed.data as object) },
  };
}

async function executeLogs(
  invocation: Extract<AgentSelfCommand, { command: "logs" }>,
  port: AgentSelfServicePort,
): Promise<AgentSelfCommandOutput> {
  switch (invocation.action) {
    case "list":
      return listAgentSelfLogs(port);
    case "tail":
      return readAgentSelfLogTail(port, invocation.name, invocation.lines);
  }
}

function describeAgentSelfPlugins(port: AgentSelfServicePort): AgentSelfCommandOutput {
  if (!port.plugins) {
    return { ok: false, text: "插件主机不可用（当前服务未装载插件运行时）。", error: "plugins_unavailable" };
  }
  const entries = port.plugins.list();
  const lines = entries.map((entry) => {
    const state = entry.loaded
      ? "已加载"
      : entry.enabled
        ? "启用但未加载"
        : entry.builtin
          ? "内置（默认启用）"
          : "未启用";
    const suffix = entry.error ? ` · 加载失败: ${entry.error}` : "";
    return `${entry.id}@${entry.version} · ${entry.kind} · ${entry.source} · ${state}${suffix}`;
  });
  const discoveryWarnings = port.plugins
    .discoveryErrors()
    .map((error) => `发现错误: ${error.pluginId ? `${error.pluginId}: ` : ""}${error.message}`);
  const text =
    entries.length === 0 && discoveryWarnings.length === 0
      ? "未发现任何插件。"
      : [...lines, ...discoveryWarnings].join("\n");
  return { ok: discoveryWarnings.length === 0, text, data: { plugins: entries } };
}

async function executeSkills(
  invocation: Extract<AgentSelfCommand, { readonly command: "skills" }>,
  port: AgentSelfServicePort,
  options: AgentSelfCommandExecutionOptions,
): Promise<AgentSelfCommandOutput> {
  void options;
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
      return executeSkillMutation(invocation, port, options);
    case "update":
    case "archive":
    case "restore":
      return executeSkillMutation(invocation, port, options);
  }
}

type AgentSelfSkillMutationCommand = Extract<
  AgentSelfCommand,
  { readonly command: "skills"; readonly action: "create" | "update" | "archive" | "restore" }
>;

async function executeSkillMutation(
  invocation: AgentSelfSkillMutationCommand,
  port: AgentSelfServicePort,
  options: AgentSelfCommandExecutionOptions,
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

function executeSkillMutationDirect(
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

async function executePreset(
  invocation: Extract<AgentSelfCommand, { command: "preset" }>,
  port: AgentSelfServicePort,
): Promise<AgentSelfCommandOutput> {
  switch (invocation.action) {
    case "list": {
      const result = await listAgentSelfPresets(port);
      return { ok: true, text: result.text, data: { active: result.active, presets: result.presets } };
    }
    case "show": {
      const result = await showAgentSelfPreset(port, invocation.name);
      return { ok: true, text: result.text, data: { name: result.name, card: result.card } };
    }
    case "use": {
      const result = await activateAgentSelfPreset(port, invocation.name);
      return {
        ok: true,
        text: invocation.name ? `Active preset: ${result.active}` : "Preset reset (no active preset).",
        data: result,
      };
    }
    case "create": {
      const content = renderPresetContent(invocation.content);
      const result = await saveAgentSelfPreset(port, { name: invocation.name, content });
      return {
        ok: true,
        text: `${result.created ? "Created" : "Updated"} preset: ${result.name}`,
        data: result,
      };
    }
  }
}

function renderPresetContent(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}
