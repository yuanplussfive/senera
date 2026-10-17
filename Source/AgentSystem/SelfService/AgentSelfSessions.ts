import type {
  AgentSelfCommand,
  AgentSelfCommandOutput,
  AgentSelfServicePort,
  AgentSelfSessionSummary,
} from "./AgentSelfServiceTypes.js";
import { resolveModelProviderCatalog } from "../AgentDefaults.js";
import { createModelProviderMetadata } from "../ModelEndpoints/AgentModelMetadata.js";

/** Session catalog for `senera sessions list`. Hosts without a session store
 * fail deterministically instead of approximating an empty list. */
export function listAgentSelfSessions(port: AgentSelfServicePort): {
  readonly ok: boolean;
  readonly text: string;
  readonly data?: { readonly sessions: readonly AgentSelfSessionSummary[] };
  readonly error?: string;
} {
  if (!port.sessions) {
    return {
      ok: false,
      text: "会话目录不可用（当前主机未绑定会话存储）。",
      error: "sessions_unavailable",
    };
  }
  const sessions = [...port.sessions.list()].sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  if (sessions.length === 0) {
    return { ok: true, text: "暂无会话记录。", data: { sessions } };
  }
  const text = sessions
    .map(
      (session) =>
        `${session.id} · ${session.title} · ${session.messageCount} 条消息 · ${session.updatedAt ?? ""}${
          session.modelProviderId ? ` · model=${session.modelProviderId}` : ""
        }`,
    )
    .join("\n");
  return { ok: true, text, data: { sessions } };
}

export async function executeAgentSelfSessionModel(
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
    return { ok: false, text: "session model set 需要 modelProviderId。", error: "model_provider_id_required" };
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
