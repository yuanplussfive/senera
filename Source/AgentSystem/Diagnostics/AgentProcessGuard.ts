import type { AgentLogger } from "./AgentLogger.js";
import { serializeError } from "./AgentErrorSerializer.js";

/**
 * 进程级故障与关闭守卫。
 *
 * Node 15+ 对未处理的 Promise 拒绝默认直接崩溃进程；这里把它降级为
 * 带上下文的错误日志（各调用点仍应自行 catch，这只是最后防线）。
 * 未捕获的同步异常按 Node 官方建议处理：记录、尽力清理、然后退出，
 * 因为此时进程状态已不可信。
 */

export type AgentProcessGuardLogger = Pick<AgentLogger, "error" | "warn">;

export interface AgentProcessGuardTarget {
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  removeListener(event: string, listener: (...args: unknown[]) => void): unknown;
  exit(code: number): void;
}

export interface AgentProcessFailureGuardOptions {
  logger: AgentProcessGuardLogger;
  /** 未捕获异常退出前的尽力清理；超过 fatalExitTimeoutMs 仍未完成则直接退出。 */
  onFatalShutdown?: () => Promise<unknown>;
  fatalExitTimeoutMs?: number;
  target?: AgentProcessGuardTarget;
}

const DefaultFatalExitTimeoutMs = 5_000;

export function installAgentProcessFailureGuard(options: AgentProcessFailureGuardOptions): () => void {
  const target: AgentProcessGuardTarget = options.target ?? process;
  const timeoutMs = options.fatalExitTimeoutMs ?? DefaultFatalExitTimeoutMs;
  let exiting = false;

  const onUnhandledRejection = (reason: unknown): void => {
    options.logger.error("未处理的 Promise 拒绝（缺失的 catch，应修复调用点）", {
      error: serializeError(reason),
    });
  };

  const onUncaughtException = (error: unknown): void => {
    options.logger.error("未捕获的异常，进程即将退出", { error: serializeError(error) });
    if (exiting) {
      target.exit(1);
      return;
    }
    exiting = true;
    if (!options.onFatalShutdown) {
      target.exit(1);
      return;
    }
    // 强制退出定时器不 unref：它必须在清理悬挂时兜底触发。
    const force = setTimeout(() => target.exit(1), timeoutMs);
    void options.onFatalShutdown().then(
      () => {
        clearTimeout(force);
        target.exit(1);
      },
      (shutdownError) => {
        clearTimeout(force);
        options.logger.error("未捕获异常后的清理失败", { error: serializeError(shutdownError) });
        target.exit(1);
      },
    );
  };

  target.on("unhandledRejection", onUnhandledRejection);
  target.on("uncaughtException", onUncaughtException);
  return () => {
    target.removeListener("unhandledRejection", onUnhandledRejection);
    target.removeListener("uncaughtException", onUncaughtException);
  };
}

export interface AgentProcessShutdownGuardOptions {
  stop: () => Promise<unknown>;
  logger: AgentProcessGuardLogger;
  /** 优雅关闭的最长等待；超时强制退出。默认 8 秒，留在 Docker 默认 10 秒 SIGKILL 之前。 */
  timeoutMs?: number;
  signals?: readonly string[];
  target?: AgentProcessGuardTarget;
}

const DefaultShutdownTimeoutMs = 8_000;
const DefaultShutdownSignals = ["SIGINT", "SIGTERM"] as const;

export function installAgentProcessShutdownGuard(options: AgentProcessShutdownGuardOptions): () => void {
  const target: AgentProcessGuardTarget = options.target ?? process;
  const timeoutMs = options.timeoutMs ?? DefaultShutdownTimeoutMs;
  const signals = options.signals ?? DefaultShutdownSignals;
  let stopping = false;
  let force: ReturnType<typeof setTimeout> | undefined;

  const shutdown = (): void => {
    if (stopping) {
      // 第二次信号（例如再按一次 Ctrl+C）不再等待，立即退出。
      if (force) clearTimeout(force);
      options.logger.warn("收到重复关闭信号，跳过剩余清理并退出");
      target.exit(1);
      return;
    }
    stopping = true;
    // 强制退出定时器不 unref：关闭链路悬挂时它是唯一的退出路径。
    force = setTimeout(() => {
      options.logger.error("优雅关闭超时，强制退出", { timeoutMs });
      target.exit(1);
    }, timeoutMs);
    options.stop().then(
      () => {
        clearTimeout(force);
        target.exit(0);
      },
      (error) => {
        clearTimeout(force);
        options.logger.error("优雅关闭失败", { error: serializeError(error) });
        target.exit(1);
      },
    );
  };

  for (const signal of signals) target.on(signal, shutdown);
  return () => {
    for (const signal of signals) target.removeListener(signal, shutdown);
  };
}
