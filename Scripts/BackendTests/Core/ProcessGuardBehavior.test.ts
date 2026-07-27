import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import {
  installAgentProcessFailureGuard,
  installAgentProcessShutdownGuard,
} from "../../../Source/AgentSystem/Diagnostics/AgentProcessGuard.js";

class FakeProcess extends EventEmitter {
  readonly exitCodes: number[] = [];

  exit(code: number): void {
    this.exitCodes.push(code);
  }
}

interface LoggedLine {
  level: "error" | "warn";
  message: string;
  details?: Record<string, unknown>;
}

function createRecordingLogger(): {
  lines: LoggedLine[];
  error(message: string, details?: Record<string, unknown>): void;
  warn(message: string, details?: Record<string, unknown>): void;
} {
  const lines: LoggedLine[] = [];
  return {
    lines,
    error(message: string, details: Record<string, unknown> = {}) {
      lines.push({ level: "error", message, details });
    },
    warn(message: string, details: Record<string, unknown> = {}) {
      lines.push({ level: "warn", message, details });
    },
  };
}

function settle(ms = 30): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("process failure guard", () => {
  it("logs unhandled rejections without exiting", () => {
    const target = new FakeProcess();
    const logger = createRecordingLogger();
    installAgentProcessFailureGuard({ logger, target });

    target.emit("unhandledRejection", new Error("stray rejection"));

    expect(target.exitCodes).toEqual([]);
    expect(logger.lines).toHaveLength(1);
    expect(logger.lines[0]?.level).toBe("error");
    expect(JSON.stringify(logger.lines[0]?.details)).toContain("stray rejection");
  });

  it("exits with code 1 on uncaught exception when no fatal shutdown is provided", () => {
    const target = new FakeProcess();
    const logger = createRecordingLogger();
    installAgentProcessFailureGuard({ logger, target });

    target.emit("uncaughtException", new Error("boom"));

    expect(target.exitCodes).toEqual([1]);
  });

  it("runs the fatal shutdown before exiting", async () => {
    const target = new FakeProcess();
    const logger = createRecordingLogger();
    const order: string[] = [];
    installAgentProcessFailureGuard({
      logger,
      target,
      onFatalShutdown: async () => {
        order.push("shutdown");
      },
    });

    target.emit("uncaughtException", new Error("boom"));
    await settle();

    expect(order).toEqual(["shutdown"]);
    expect(target.exitCodes).toEqual([1]);
  });

  it("force-exits when the fatal shutdown hangs", async () => {
    const target = new FakeProcess();
    const logger = createRecordingLogger();
    installAgentProcessFailureGuard({
      logger,
      target,
      fatalExitTimeoutMs: 20,
      onFatalShutdown: () => new Promise(() => undefined),
    });

    target.emit("uncaughtException", new Error("boom"));
    await settle(60);

    expect(target.exitCodes).toEqual([1]);
  });

  it("stops listening after uninstall", () => {
    const target = new FakeProcess();
    const logger = createRecordingLogger();
    const uninstall = installAgentProcessFailureGuard({ logger, target });

    uninstall();
    target.emit("unhandledRejection", new Error("after uninstall"));

    expect(logger.lines).toEqual([]);
    expect(target.listenerCount("unhandledRejection")).toBe(0);
    expect(target.listenerCount("uncaughtException")).toBe(0);
  });
});

describe("process shutdown guard", () => {
  it("exits 0 after stop resolves", async () => {
    const target = new FakeProcess();
    const logger = createRecordingLogger();
    let stopped = 0;
    installAgentProcessShutdownGuard({
      logger,
      target,
      stop: async () => {
        stopped += 1;
      },
    });

    target.emit("SIGTERM");
    await settle();

    expect(stopped).toBe(1);
    expect(target.exitCodes).toEqual([0]);
  });

  it("force-exits 1 when stop hangs past the deadline", async () => {
    const target = new FakeProcess();
    const logger = createRecordingLogger();
    installAgentProcessShutdownGuard({
      logger,
      target,
      timeoutMs: 20,
      stop: () => new Promise(() => undefined),
    });

    target.emit("SIGINT");
    await settle(60);

    expect(target.exitCodes).toEqual([1]);
    expect(logger.lines.some((line) => line.level === "error")).toBe(true);
  });

  it("exits 1 and logs when stop rejects", async () => {
    const target = new FakeProcess();
    const logger = createRecordingLogger();
    installAgentProcessShutdownGuard({
      logger,
      target,
      stop: () => Promise.reject(new Error("stop failed")),
    });

    target.emit("SIGTERM");
    await settle();

    expect(target.exitCodes).toEqual([1]);
    expect(JSON.stringify(logger.lines)).toContain("stop failed");
  });

  it("exits immediately on a repeated signal instead of waiting again", async () => {
    const target = new FakeProcess();
    const logger = createRecordingLogger();
    installAgentProcessShutdownGuard({
      logger,
      target,
      timeoutMs: 5_000,
      stop: () => new Promise(() => undefined),
    });

    target.emit("SIGINT");
    target.emit("SIGINT");
    await settle();

    expect(target.exitCodes).toEqual([1]);
    expect(logger.lines.some((line) => line.level === "warn")).toBe(true);
  });
});
