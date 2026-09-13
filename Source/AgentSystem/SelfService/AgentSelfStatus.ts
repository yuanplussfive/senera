import type { AgentSelfServicePort } from "./AgentSelfServiceTypes.js";

export interface AgentSelfStatusReport {
  readonly workspaceRoot: string;
  readonly config: {
    readonly revision?: number;
    readonly source: "sqlite" | "json";
    readonly modelProviders: number;
    readonly endpoints: number;
  };
  readonly manifest: {
    readonly available: boolean;
    readonly pid?: number;
    readonly startedAt?: string;
    readonly host?: string;
    readonly port?: number;
    readonly protocol?: number;
  };
}

/** Live service status assembled from the runtime manifest and the current
 * config snapshot. A missing manifest is reported explicitly as unavailable —
 * never silently omitted. */
export function projectAgentSelfStatus(port: AgentSelfServicePort): AgentSelfStatusReport {
  const snapshot = port.config.getSnapshot();
  const value = snapshot.value as {
    readonly ModelProviderEndpoints?: readonly unknown[];
    readonly ModelProviders?: readonly unknown[];
  };
  const manifest = port.status?.manifest();
  return {
    workspaceRoot: port.workspaceRoot,
    config: {
      revision: snapshot.revision,
      source: snapshot.source,
      modelProviders: value.ModelProviders?.length ?? 0,
      endpoints: value.ModelProviderEndpoints?.length ?? 0,
    },
    manifest: {
      available: manifest !== undefined,
      pid: manifest?.pid,
      startedAt: manifest?.startedAt,
      host: manifest?.host,
      port: manifest?.port,
      protocol: manifest?.protocol,
    },
  };
}

export function describeAgentSelfStatus(report: AgentSelfStatusReport): string {
  const lines: string[] = [
    `工作区: ${report.workspaceRoot}`,
    `配置: revision ${report.config.revision ?? "unknown"} · ${report.config.source} · 模型 ${report.config.modelProviders} 个 · 端点 ${report.config.endpoints} 个`,
  ];
  if (report.manifest.available) {
    lines.push(
      `服务: pid ${report.manifest.pid} · 启动于 ${report.manifest.startedAt} · ${report.manifest.host}:${report.manifest.port} · 协议 v${report.manifest.protocol}`,
    );
  } else {
    lines.push("服务: 运行清单不可用（主机未绑定 manifest 存储）");
  }
  return lines.join("\n");
}
