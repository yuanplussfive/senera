import type { AgentSelfServicePort, AgentSelfSessionSummary } from "./AgentSelfServiceTypes.js";

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
