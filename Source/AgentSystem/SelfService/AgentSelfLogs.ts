import type {
  AgentSelfCommand,
  AgentSelfLogDetailResult,
  AgentSelfLogFile,
  AgentSelfLogHealth,
  AgentSelfLogQuery,
  AgentSelfLogQueryResult,
  AgentSelfLogStream,
  AgentSelfServicePort,
} from "./AgentSelfServiceTypes.js";

type AgentSelfLogReadCommand = Extract<
  AgentSelfCommand,
  {
    readonly command: "logs";
    readonly action: "latest" | "range" | "session" | "next" | "trace";
  }
>;

/** Log file listing for `senera logs list`. Hosts without a log store fail
 * deterministically; an empty directory is a valid, explicit result. */
export function listAgentSelfLogs(port: AgentSelfServicePort): {
  readonly ok: boolean;
  readonly text: string;
  readonly data?: { readonly root: string; readonly files: readonly AgentSelfLogFile[] };
  readonly error?: string;
} {
  if (!port.logs) {
    return {
      ok: false,
      text: "日志存储不可用（当前主机未绑定日志目录）。",
      error: "logs_unavailable",
    };
  }
  const disabled = logsDisabled(port);
  if (disabled) return disabled;
  const files = port.logs.list();
  if (files.length === 0) {
    return { ok: true, text: `日志目录暂无文件: ${port.logs.root()}`, data: { root: port.logs.root(), files } };
  }
  const text = files
    .map((file) => `${file.name} · ${formatBytes(file.sizeBytes)} · ${file.updatedAt ?? ""}`)
    .join("\n");
  return { ok: true, text, data: { root: port.logs.root(), files } };
}

/** Trailing log read for `senera logs tail`. The host validates the name
 * against its log root; traversal attempts are rejected, not resolved. */
export function readAgentSelfLogTail(
  port: AgentSelfServicePort,
  name: string,
  lines?: number,
): {
  readonly ok: boolean;
  readonly text: string;
  readonly data?: { readonly name: string; readonly lines?: number; readonly content: string };
  readonly error?: string;
} {
  if (!port.logs) {
    return {
      ok: false,
      text: "日志存储不可用（当前主机未绑定日志目录）。",
      error: "logs_unavailable",
    };
  }
  const disabled = logsDisabled(port);
  if (disabled) return disabled;
  const result = port.logs.read(name, lines);
  if (result.status === "found") {
    return {
      ok: true,
      text: result.content,
      data: { name, ...(lines === undefined ? {} : { lines }), content: result.content },
    };
  }
  return {
    ok: false,
    text: result.error,
    error: result.status === "rejected" ? "logs_path_rejected" : "logs_file_missing",
  };
}

export function queryAgentSelfLogs(
  port: AgentSelfServicePort,
  query: AgentSelfLogQuery,
): {
  readonly ok: boolean;
  readonly text: string;
  readonly data?: AgentSelfLogQueryResult;
  readonly error?: string;
} {
  if (!port.logs?.query) {
    return {
      ok: false,
      text: "结构化日志查询不可用（当前主机未绑定日志查询实现）。",
      error: "logs_query_unavailable",
    };
  }
  const disabled = logsDisabled(port);
  if (disabled) return disabled;
  const result = port.logs.query(query);
  return {
    ok: true,
    text: describeLogQuery(result, query),
    data: result,
  };
}

/** Projects the small intent-specific log commands onto one store query.
 * Command-specific ordering is deliberate: latest/range are diagnostic
 * snapshots, while session/trace preserve causal order. */
export function queryAgentSelfLogCommand(
  port: AgentSelfServicePort,
  invocation: AgentSelfLogReadCommand,
): {
  readonly ok: boolean;
  readonly text: string;
  readonly data?: AgentSelfLogQueryResult;
  readonly error?: string;
} {
  switch (invocation.action) {
    case "latest":
      return queryAgentSelfLogs(port, {
        kind: invocation.kind,
        level: invocation.level,
        scope: invocation.scope,
        stream: invocation.stream,
        limit: invocation.limit,
        order: "desc",
      });
    case "range":
      return queryAgentSelfLogs(port, {
        from: invocation.from,
        to: invocation.to,
        kind: invocation.kind,
        level: invocation.level,
        scope: invocation.scope,
        stream: invocation.stream,
        limit: invocation.limit,
        order: "desc",
      });
    case "session":
      return queryAgentSelfLogs(port, {
        sessionId: invocation.sessionId,
        limit: invocation.limit,
        order: "asc",
      });
    case "next":
      return queryAgentSelfLogs(port, { cursor: invocation.cursor, limit: invocation.limit });
    case "trace":
      return queryAgentSelfLogs(port, {
        requestId: invocation.requestId,
        limit: invocation.limit,
        order: "asc",
      });
  }
}

export function readAgentSelfLogDetail(
  port: AgentSelfServicePort,
  detailId: string,
): {
  readonly ok: boolean;
  readonly text: string;
  readonly data?: AgentSelfLogDetailResult;
  readonly error?: string;
} {
  if (!port.logs?.detail) {
    return {
      ok: false,
      text: "日志详情查询不可用（当前主机未绑定详情存储）。",
      error: "logs_detail_unavailable",
    };
  }
  const disabled = logsDisabled(port);
  if (disabled) return disabled;
  const result = port.logs.detail(detailId);
  if (result.status !== "found") {
    return {
      ok: false,
      text: result.error,
      data: result,
      error: result.status === "rejected" ? "logs_detail_rejected" : "logs_detail_missing",
    };
  }
  return { ok: true, text: JSON.stringify(result.value, null, 2), data: result };
}

export function readAgentSelfLogHealth(port: AgentSelfServicePort): {
  readonly ok: boolean;
  readonly text: string;
  readonly data?: AgentSelfLogHealth;
  readonly error?: string;
} {
  if (!port.logs?.health) {
    return { ok: false, text: "日志健康检查不可用（当前主机未绑定日志存储）。", error: "logs_health_unavailable" };
  }
  const report = port.logs.health();
  const ok = !report.lastError;
  return {
    ok,
    text: [
      `日志状态: ${report.enabled ? "启用" : "关闭"}`,
      `目录: ${report.root}`,
      `投影: ${report.projectionFiles} 个文件，${report.projectionBytes} bytes`,
      `详情: ${report.detailFiles} 个`,
      ...(report.lastError ? [`最近错误: ${report.lastError}`] : []),
    ].join("\n"),
    data: report,
    ...(ok ? {} : { error: "logs_degraded" }),
  };
}

export function listAgentSelfLogStreams(port: AgentSelfServicePort): {
  readonly ok: boolean;
  readonly text: string;
  readonly data?: readonly AgentSelfLogStream[];
  readonly error?: string;
} {
  if (!port.logs?.streams) {
    return { ok: false, text: "日志流目录清单不可用（当前主机未绑定日志存储）。", error: "logs_streams_unavailable" };
  }
  const disabled = logsDisabled(port);
  if (disabled) return disabled;
  const streams = port.logs.streams();
  return {
    ok: true,
    text:
      streams.length === 0
        ? "当前工作区没有结构化日志流。"
        : streams.map((stream) => `${stream.name} · ${stream.files.length} 个文件`).join("\n"),
    data: streams,
  };
}

function describeLogQuery(result: AgentSelfLogQueryResult, query: AgentSelfLogQuery): string {
  if (result.items.length === 0) {
    return query.cursor || query.after ? "游标之后没有新的日志事件。" : "当前工作区没有匹配的日志事件。";
  }
  const lines = result.items.map((item) => {
    const identity = [item.stream, item.kind, item.requestId, item.detailId].filter(Boolean).join(" · ");
    return `${item.timestamp} ${item.level} ${item.message}${identity ? ` · ${identity}` : ""}`;
  });
  return [
    ...lines,
    ...(result.nextCursor ? [`nextCursor=${result.nextCursor}`] : []),
    `hasMore=${result.hasMore ? "true" : "false"}`,
  ].join("\n");
}

function logsDisabled(
  port: AgentSelfServicePort,
): { readonly ok: false; readonly text: string; readonly error: string } | undefined {
  const health = port.logs?.health?.();
  if (health?.enabled !== false) return undefined;
  if (health.lastError) {
    return { ok: false, text: `当前工作区日志不可用: ${health.lastError}`, error: "logs_degraded" };
  }
  return { ok: false, text: "当前工作区日志已关闭，请先启用 Persistence.Logs.Enabled。", error: "logs_disabled" };
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_024 * 1_024) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${(bytes / (1_024 * 1_024)).toFixed(1)} MB`;
}
