import {
  AgentSandboxRuntimeProvider,
  type AgentSandboxRuntimeSnapshot,
} from "./AgentSandboxRuntimeTypes.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import { resolveSandboxRuntimeConfig } from "../AgentDefaults.js";
import { resolveAgentSandboxRuntimePaths } from "./AgentSandboxRuntimePreparation.js";

export interface AgentSandboxRuntimeServiceOptions {
  workspaceRoot?: string;
  configSnapshot?: () => AgentSystemConfig;
  platform?: NodeJS.Platform;
  clock?: () => Date;
  packageAvailable?: () => boolean;
}

export class AgentSandboxRuntimeService {
  private readonly workspaceRoot: string;
  private readonly configSnapshot: (() => AgentSystemConfig) | undefined;
  private readonly platform: NodeJS.Platform;
  private readonly clock: () => Date;
  private readonly packageAvailable: () => boolean;

  constructor(options: AgentSandboxRuntimeServiceOptions = {}) {
    this.workspaceRoot = options.workspaceRoot ?? process.cwd();
    this.configSnapshot = options.configSnapshot;
    this.platform = options.platform ?? process.platform;
    this.clock = options.clock ?? (() => new Date());
    this.packageAvailable = options.packageAvailable ?? resolveMicrosandboxPackageAvailable;
  }

  snapshot(): AgentSandboxRuntimeSnapshot {
    const supported = this.packageAvailable();
    const paths = this.runtimePaths();
    return {
      provider: AgentSandboxRuntimeProvider,
      platform: this.platform,
      supported,
      effectiveMode: supported ? "sandbox" : "fallback",
      paths,
      dependencies: {
        errors: supported ? [] : ["microsandbox package is not resolvable"],
        warnings: supported ? ["microsandbox host runtime is checked when a command executes"] : [],
      },
      diagnostics: [supported ? microsandboxConfiguredDiagnostic() : microsandboxMissingDiagnostic()],
      message: supported
        ? "microsandbox 沙箱后端已配置，命令执行会优先进入 microVM。"
        : "microsandbox 包不可用，当前使用本地执行边界。",
      updatedAt: this.clock().toISOString(),
    };
  }

  private runtimePaths(): AgentSandboxRuntimeSnapshot["paths"] {
    const config = this.configSnapshot?.();
    if (!config) {
      return undefined;
    }

    return resolveAgentSandboxRuntimePaths(
      this.workspaceRoot,
      resolveSandboxRuntimeConfig(config),
    );
  }
}

function microsandboxConfiguredDiagnostic(): AgentSandboxRuntimeSnapshot["diagnostics"][number] {
  return {
    code: "microsandbox_backend_configured",
    severity: "warning",
    message: "microsandbox 后端已接入。",
    recommendation: "首次执行时会由 microsandbox SDK 检查本机运行时；不可用时自动回落到本地执行后端。",
    details: [
      "默认使用只读工作区挂载。",
      "默认禁用沙箱网络。",
      "不会再触发旧的 Windows UAC 安装或修复流程。",
    ],
  };
}

function microsandboxMissingDiagnostic(): AgentSandboxRuntimeSnapshot["diagnostics"][number] {
  return {
    code: "microsandbox_package_missing",
    severity: "warning",
    message: "microsandbox 包不可解析。",
    recommendation: "运行 npm install 同步依赖后重启服务。",
    details: [
      "Senera 会继续使用本地执行边界、工作区路径守卫和审批系统。",
    ],
  };
}

function resolveMicrosandboxPackageAvailable(): boolean {
  try {
    import.meta.resolve("microsandbox");
    return true;
  } catch {
    return false;
  }
}
