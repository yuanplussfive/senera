import {
  AgentSandboxRuntimeProvider,
  type AgentSandboxRuntimeState,
  type AgentSandboxRuntimeSnapshot,
} from "./AgentSandboxRuntimeTypes.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import { resolveSandboxRuntimeConfig } from "../AgentDefaults.js";
import { resolveAgentSandboxRuntimePaths } from "./AgentSandboxRuntimePreparation.js";

export interface AgentSandboxRuntimePreparationStatus {
  state: AgentSandboxRuntimeState;
  message?: string;
  error?: string;
  updatedAt?: string;
}

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
  private preparationStatus: AgentSandboxRuntimePreparationStatus = {
    state: "unknown",
  };

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
    const state = supported ? this.preparationStatus.state : "fallback";
    const effectiveMode = supported && state === "ready" ? "sandbox" : "fallback";
    const diagnostics = this.diagnostics(supported, state);
    return {
      provider: AgentSandboxRuntimeProvider,
      platform: this.platform,
      state,
      supported,
      effectiveMode,
      paths,
      dependencies: {
        errors: this.dependencyErrors(supported, state),
        warnings: this.dependencyWarnings(supported, state),
      },
      diagnostics,
      message: this.message(supported, state),
      updatedAt: this.clock().toISOString(),
    };
  }

  markPreparing(message = "正在准备 microsandbox 沙箱运行时。"): void {
    this.preparationStatus = {
      state: "preparing",
      message,
      updatedAt: this.clock().toISOString(),
    };
  }

  markReady(message = "microsandbox 沙箱运行时已可用。"): void {
    this.preparationStatus = {
      state: "ready",
      message,
      updatedAt: this.clock().toISOString(),
    };
  }

  markFallback(error: unknown, message = "microsandbox 沙箱运行时不可用，已回落到本地执行边界。"): void {
    this.preparationStatus = {
      state: "fallback",
      message,
      error: errorMessage(error),
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

  private dependencyErrors(
    supported: boolean,
    state: AgentSandboxRuntimeState,
  ): string[] {
    if (!supported) {
      return ["microsandbox package is not resolvable"];
    }
    if (state === "fallback" && this.preparationStatus.error) {
      return [this.preparationStatus.error];
    }
    return [];
  }

  private dependencyWarnings(
    supported: boolean,
    state: AgentSandboxRuntimeState,
  ): string[] {
    if (!supported) {
      return [];
    }
    if (state === "unknown") {
      return ["microsandbox host runtime has not been checked yet"];
    }
    if (state === "preparing") {
      return ["microsandbox host runtime is being prepared"];
    }
    if (state === "fallback") {
      return ["commands continue through the local fallback backend when allowed by tool policy"];
    }
    return [];
  }

  private diagnostics(
    supported: boolean,
    state: AgentSandboxRuntimeState,
  ): AgentSandboxRuntimeSnapshot["diagnostics"] {
    if (!supported) {
      return [microsandboxMissingDiagnostic()];
    }
    if (state === "ready") {
      return [microsandboxReadyDiagnostic()];
    }
    if (state === "preparing") {
      return [microsandboxPreparingDiagnostic()];
    }
    if (state === "fallback") {
      return [microsandboxFallbackDiagnostic(this.preparationStatus.error)];
    }
    return [microsandboxConfiguredDiagnostic()];
  }

  private message(
    supported: boolean,
    state: AgentSandboxRuntimeState,
  ): string {
    if (!supported) {
      return "microsandbox 包不可用，当前使用本地执行边界。";
    }
    if (state === "ready") {
      return this.preparationStatus.message ?? "microsandbox 沙箱运行时已可用。";
    }
    if (state === "preparing") {
      return this.preparationStatus.message ?? "正在准备 microsandbox 沙箱运行时。";
    }
    if (state === "fallback") {
      return this.preparationStatus.message ?? "microsandbox 沙箱运行时不可用，当前使用本地执行边界。";
    }
    return "microsandbox 沙箱后端已配置，命令执行会优先进入 microVM。";
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

function microsandboxPreparingDiagnostic(): AgentSandboxRuntimeSnapshot["diagnostics"][number] {
  return {
    code: "microsandbox_runtime_preparing",
    severity: "warning",
    message: "microsandbox 沙箱运行时正在准备。",
    recommendation: "可继续使用 Senera；准备完成前允许 fallback 的工具会使用本地执行边界。",
    details: [
      "桌面端首次启动会自动检查并准备沙箱运行时。",
      "首次使用沙箱镜像可能需要网络。",
    ],
  };
}

function microsandboxReadyDiagnostic(): AgentSandboxRuntimeSnapshot["diagnostics"][number] {
  return {
    code: "microsandbox_runtime_ready",
    severity: "warning",
    message: "microsandbox 沙箱运行时可用。",
    recommendation: "支持沙箱的工具会优先进入 microVM；工具策略允许时仍可在不可用时 fallback。",
    details: [
      "默认使用只读工作区挂载。",
      "默认禁用沙箱网络，除非工具策略声明允许网络。",
    ],
  };
}

function microsandboxFallbackDiagnostic(error: string | undefined): AgentSandboxRuntimeSnapshot["diagnostics"][number] {
  return {
    code: "microsandbox_runtime_fallback",
    severity: "warning",
    message: "microsandbox 沙箱运行时不可用。",
    recommendation: "如需 OS 沙箱隔离，请启用系统虚拟化能力后重启 Senera。",
    details: [
      "Senera 会继续使用本地执行边界、工作区路径守卫和审批系统。",
      "Windows 通常需要启用 Windows Hypervisor Platform / Virtual Machine Platform。",
      ...(error ? [`最近一次准备错误：${error}`] : []),
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
