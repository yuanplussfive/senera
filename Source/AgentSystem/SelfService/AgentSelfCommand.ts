import type {
  AgentSelfCommand,
  AgentSelfCommandOutput,
  AgentSelfServicePort,
  AgentSelfPromptPresetStatus,
  AgentSelfPromptPresetMutationResult,
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
import { describeAgentSelfWorkspace, projectAgentSelfWorkspaceInfo } from "./AgentSelfWorkspace.js";
import { describeAgentSelfDoctor, projectAgentSelfDoctorReport } from "./AgentSelfDoctor.js";
import { executeAgentSelfSessionModel, listAgentSelfSessions } from "./AgentSelfSessions.js";
import { describeAgentSelfStatus, projectAgentSelfStatus } from "./AgentSelfStatus.js";
import {
  listAgentSelfLogs,
  listAgentSelfLogStreams,
  queryAgentSelfLogCommand,
  readAgentSelfLogDetail,
  readAgentSelfLogHealth,
  readAgentSelfLogTail,
} from "./AgentSelfLogs.js";
import { projectAgentSelfRedacted } from "./AgentSelfRedaction.js";
import { findAgentSelfPluginCommand, listAgentSelfBuiltinCommandSpecs } from "./AgentSelfCommandRegistry.js";
import { AgentSelfCommandSchema, AgentSelfPluginCommandEnvelopeSchema } from "./AgentSelfCommandSchema.js";
import type { AgentSelfInvocation } from "./AgentSelfServiceTypes.js";
import { describeAgentSelfCapabilities, projectAgentSelfCapabilities } from "./AgentSelfCapabilities.js";
import { stringifyAgentCanonicalJson } from "../Core/AgentCanonicalJson.js";
import { projectInvalidAgentSelfInvocation, readAgentSelfCommandRoot } from "./AgentSelfCommandValidation.js";
import { AgentChannelsConfigPathPrefix } from "../Channels/AgentChannelsConfig.js";
import {
  executeAgentSelfSkills,
  executeSkillMutationDirect,
  isSkillMutationCommand,
} from "./AgentSelfSkillCommands.js";
export { projectAgentSelfInvocationValidationFailure } from "./AgentSelfCommandValidation.js";

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
      case "workspace":
        return {
          ok: true,
          text: describeAgentSelfWorkspace(projectAgentSelfWorkspaceInfo(port)),
          data: projectAgentSelfWorkspaceInfo(port),
        };
      case "sessions":
        return listAgentSelfSessions(port);
      case "session":
        return await executeAgentSelfSessionModel(invocation, port);
      case "plugins":
        return describeAgentSelfPlugins(port);
      case "preset":
        return await executePromptPreset(invocation, port);
      case "channels":
        return await executeChannels(invocation, port, options);
      case "skills":
        return await executeAgentSelfSkills(invocation, port, options, projectDeferredApproval);
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
    return projectInvalidAgentSelfInvocation(builtIn.error.issues, readAgentSelfCommandRoot(invocation));
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

async function executePromptPreset(
  invocation: Extract<AgentSelfCommand, { command: "preset" }>,
  port: AgentSelfServicePort,
): Promise<AgentSelfCommandOutput> {
  if (!port.promptPresets) {
    return { ok: false, text: "提示词预设服务不可用（当前主机未绑定工作区预设）。", error: "preset_unavailable" };
  }
  switch (invocation.action) {
    case "list":
    case "status": {
      const status = await port.promptPresets.status();
      const text = describePromptPresetStatus(status, invocation.action === "list");
      return { ok: status.valid, text, data: status };
    }
    case "read": {
      const result = await port.promptPresets.read(invocation.path);
      return {
        ok: result.status === "found",
        text: result.status === "found" ? result.content : result.error,
        data: result,
        ...(result.status !== "found" ? { error: result.status } : {}),
      };
    }
    case "enable": {
      const result = await port.promptPresets.enable(invocation.path);
      return {
        ok: result.status === "enabled",
        text:
          result.status === "enabled"
            ? `已启用提示词预设: ${result.activePath}`
            : describePromptPresetMutationFailure(result),
        data: result,
        ...(result.status !== "enabled" ? { error: result.status } : {}),
      };
    }
    case "disable": {
      const result = await port.promptPresets.disable();
      return {
        ok: result.status === "disabled",
        text:
          result.status === "disabled"
            ? "已停用提示词预设，文件内容未删除。"
            : describePromptPresetMutationFailure(result),
        data: result,
        ...(result.status !== "disabled" ? { error: result.status } : {}),
      };
    }
  }
}

async function executeChannels(
  invocation: Extract<AgentSelfCommand, { command: "channels" }>,
  port: AgentSelfServicePort,
  options: AgentSelfCommandExecutionOptions,
): Promise<AgentSelfCommandOutput> {
  if (!port.channels) {
    return { ok: false, text: "消息渠道服务不可用（当前主机未绑定渠道配置）。", error: "channels_unavailable" };
  }
  if (invocation.action === "update") {
    const channelPath = invocation.path.trim();
    const configPath = `${AgentChannelsConfigPathPrefix}.${invocation.channel}.${channelPath}`;
    return executeConfig(
      { command: "config", action: "update", path: configPath, value: invocation.value },
      port,
      options,
    );
  }
  const snapshot = port.channels.snapshot();
  const data = projectAgentSelfChannels(snapshot);
  if (invocation.action === "get") {
    const channel = (data as { channels?: Record<string, unknown> }).channels?.[invocation.channel];
    if (channel === undefined)
      return { ok: false, text: `未知消息渠道: ${invocation.channel}`, error: "channel_not_found" };
    return {
      ok: true,
      text: stringifyAgentCanonicalJson(channel),
      data: { channel: invocation.channel, config: channel },
    };
  }
  return { ok: true, text: stringifyAgentCanonicalJson(data), data };
}

function projectAgentSelfChannels(
  snapshot: ReturnType<NonNullable<AgentSelfServicePort["channels"]>["snapshot"]>,
): unknown {
  return projectAgentSelfRedacted({
    enabled: snapshot.enabled,
    defaultApprovalMode: snapshot.defaultApprovalMode,
    finalResponseRewrite: snapshot.finalResponseRewrite,
    channels: snapshot.channels,
    profileRoutes: snapshot.profileRoutes?.list(),
  });
}

function describePromptPresetStatus(status: AgentSelfPromptPresetStatus, listOnly: boolean): string {
  const entries = status.presets
    .map((preset) => `${preset.active && preset.enabled ? "*" : "-"} ${preset.path} (${preset.sizeBytes} bytes)`)
    .join("\n");
  if (listOnly) return entries || "prompts/ 下没有 Markdown 预设。";
  return [
    `预设状态: ${status.enabled ? "已启用" : "未启用"}`,
    `当前文件: ${status.activePath ?? "未选择"}`,
    ...(status.error ? [`状态错误: ${status.error}`] : []),
    entries ? `文件:\n${entries}` : "文件: prompts/ 下没有 Markdown 预设。",
  ].join("\n");
}

function describePromptPresetMutationFailure(result: AgentSelfPromptPresetMutationResult): string {
  return "error" in result ? result.error : `预设操作未完成: ${result.status}`;
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
    case "latest":
    case "range":
    case "session":
    case "next":
      return queryAgentSelfLogCommand(port, invocation);
    case "detail":
      return readAgentSelfLogDetail(port, invocation.detailId);
    case "trace":
      return queryAgentSelfLogCommand(port, invocation);
    case "health":
      return readAgentSelfLogHealth(port);
    case "streams":
      return listAgentSelfLogStreams(port);
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
