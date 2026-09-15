import type { AgentSelfLogFile, AgentSelfServicePort } from "./AgentSelfServiceTypes.js";

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
  lines = 200,
): {
  readonly ok: boolean;
  readonly text: string;
  readonly data?: { readonly name: string; readonly lines: number; readonly content: string };
  readonly error?: string;
} {
  if (!port.logs) {
    return {
      ok: false,
      text: "日志存储不可用（当前主机未绑定日志目录）。",
      error: "logs_unavailable",
    };
  }
  const result = port.logs.read(name, lines);
  if (result.status === "found") {
    return { ok: true, text: result.content, data: { name, lines, content: result.content } };
  }
  return {
    ok: false,
    text: result.error,
    error: result.status === "rejected" ? "logs_path_rejected" : "logs_file_missing",
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_024 * 1_024) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${(bytes / (1_024 * 1_024)).toFixed(1)} MB`;
}
