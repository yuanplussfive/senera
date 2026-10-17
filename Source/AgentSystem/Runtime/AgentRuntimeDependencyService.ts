import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { errorMessage } from "../Core/AgentErrors.js";
import { resolveAgentBrowserController } from "../Browser/AgentBrowserControllerResolver.js";
import {
  AgentBrowserConfigurationSchema,
  DefaultAgentBrowserConfiguration,
  type AgentBrowserConfiguration,
} from "../Browser/AgentBrowserConfiguration.js";
import {
  assertAgentBrowserWindowModeSupported,
  resolveAgentBrowserExecutable,
} from "../Browser/AgentBrowserExecutableResolver.js";
import { AgentRuntimeDependencyCatalog, findAgentRuntimeDependency } from "./AgentRuntimeDependencyCatalog.js";
import type {
  AgentRuntimeDependencyProgress,
  AgentRuntimeDependencyHealthPolicy,
  AgentRuntimeDependencyService,
  AgentRuntimeDependencySnapshot,
  AgentRuntimeDependencyDescriptor,
} from "./AgentRuntimeDependencyTypes.js";

interface AgentRuntimeDependencyServiceOptions {
  readonly workspaceRoot: string;
  readonly resourcesPath?: string;
  readonly browserConfiguration?: AgentBrowserConfiguration | (() => AgentBrowserConfiguration);
  readonly healthCheckPolicy: AgentRuntimeDependencyHealthPolicy;
  readonly logger?: { warn(message: string, details?: Record<string, unknown>): void };
}

export interface AgentRuntimeDependencyLineBuffer {
  push(chunk: Buffer): readonly string[];
  flush(): readonly string[];
}

export function createAgentRuntimeDependencyLineBuffer(): AgentRuntimeDependencyLineBuffer {
  const decoder = new StringDecoder("utf8");
  let remainder = "";

  const readLines = (text: string, final: boolean): readonly string[] => {
    remainder += text;
    const parts = remainder.split(/\r?\n/u);
    remainder = final ? "" : (parts.pop() ?? "");
    return parts.map((line) => line.trim()).filter(Boolean);
  };

  return {
    push: (chunk) => readLines(decoder.write(chunk), false),
    flush: () => readLines(decoder.end(), true),
  };
}

export class AgentRuntimeDependencyManager implements AgentRuntimeDependencyService {
  private readonly workspaceRoot: string;
  private readonly resourcesPath?: string;
  private readonly browserConfiguration: AgentBrowserConfiguration | (() => AgentBrowserConfiguration);
  private readonly healthCheckPolicy: AgentRuntimeDependencyHealthPolicy;
  private readonly logger?: AgentRuntimeDependencyServiceOptions["logger"];
  private readonly children = new Set<ChildProcess>();
  private readonly installations = new Map<string, Promise<void>>();
  private readonly healthChecks = new Map<string, Promise<AgentRuntimeDependencySnapshot>>();
  private readonly healthCache = new Map<
    string,
    { readonly fingerprint: string; readonly snapshot: AgentRuntimeDependencySnapshot }
  >();
  private readonly operations = new Set<Promise<unknown>>();
  private listOperation?: Promise<readonly AgentRuntimeDependencySnapshot[]>;
  private listCache?: {
    readonly fingerprint: string;
    readonly snapshots: readonly AgentRuntimeDependencySnapshot[];
  };
  private dependencyStateRevision = 0;
  private observedFingerprint?: string;
  private closed = false;

  constructor(options: AgentRuntimeDependencyServiceOptions) {
    this.workspaceRoot = path.resolve(options.workspaceRoot);
    this.resourcesPath = options.resourcesPath;
    this.browserConfiguration =
      options.browserConfiguration ?? AgentBrowserConfigurationSchema.parse(DefaultAgentBrowserConfiguration);
    this.healthCheckPolicy = options.healthCheckPolicy;
    this.logger = options.logger;
  }

  async list(): Promise<readonly AgentRuntimeDependencySnapshot[]> {
    const fingerprint = this.configurationFingerprint();
    if (this.listCache?.fingerprint === fingerprint) return this.listCache.snapshots;
    if (this.listOperation) return this.listOperation;
    const revision = this.dependencyStateRevision;

    const operation = this.trackOperation(
      this.buildList(fingerprint, revision).finally(() => {
        this.listOperation = undefined;
      }),
    );
    this.listOperation = operation;
    return operation;
  }

  async check(dependencyId: string): Promise<AgentRuntimeDependencySnapshot> {
    const dependency = findAgentRuntimeDependency(dependencyId);
    if (!dependency) throw new Error(`Unknown runtime dependency: ${dependencyId}`);
    if (this.closed) throw new Error("Runtime dependency manager is closed.");

    const existing = this.healthChecks.get(dependencyId);
    if (existing) return existing;

    const installation = this.installations.get(dependencyId);
    if (installation) {
      await Promise.allSettled([installation]);
      const cached = this.healthCache.get(dependencyId);
      if (cached?.fingerprint === this.configurationFingerprint()) return cached.snapshot;
      return this.check(dependencyId);
    }

    const fingerprint = this.configurationFingerprint();
    const revision = this.invalidateDependencyCache(dependencyId);
    const operation = this.trackOperation(
      this.performHealthCheck(dependency)
        .then((snapshot) => {
          if (revision === this.dependencyStateRevision && this.configurationFingerprint() === fingerprint) {
            this.healthCache.set(dependencyId, { fingerprint, snapshot });
          }
          return snapshot;
        })
        .finally(() => {
          this.healthChecks.delete(dependencyId);
        }),
    );
    this.healthChecks.set(dependencyId, operation);
    return operation;
  }

  async install(dependencyId: string, onProgress: (progress: AgentRuntimeDependencyProgress) => void): Promise<void> {
    const dependency = findAgentRuntimeDependency(dependencyId);
    if (!dependency) throw new Error(`Unknown runtime dependency: ${dependencyId}`);
    if (!dependency.installable)
      throw new Error(`Runtime dependency ${dependencyId} is bundled and cannot be installed.`);
    const installCommand = requireRuntimeDependencyInstallCommand(dependency);
    if (this.closed) throw new Error("Runtime dependency manager is closed.");
    const existing = this.installations.get(dependencyId);
    if (existing) return existing;
    const activeHealthCheck = this.healthChecks.get(dependencyId);
    if (activeHealthCheck) await Promise.allSettled([activeHealthCheck]);
    const existingAfterHealthCheck = this.installations.get(dependencyId);
    if (existingAfterHealthCheck) return existingAfterHealthCheck;

    this.invalidateDependencyCache(dependencyId);
    const operation = this.trackOperation(
      this.installBrowser(dependency, installCommand, onProgress).finally(() => {
        this.installations.delete(dependencyId);
      }),
    );
    this.installations.set(dependencyId, operation);
    return operation;
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const child of this.children) child.kill();
    while (this.operations.size > 0) {
      await Promise.allSettled([...this.operations]);
      for (const child of this.children) child.kill();
    }
    this.healthChecks.clear();
    this.healthCache.clear();
    this.listCache = undefined;
    this.dependencyStateRevision += 1;
    this.listOperation = undefined;
    this.observedFingerprint = undefined;
  }

  private async buildList(fingerprint: string, revision: number): Promise<readonly AgentRuntimeDependencySnapshot[]> {
    const snapshots = await Promise.all(
      AgentRuntimeDependencyCatalog.map(async (dependency) => {
        if (this.installations.has(dependency.id)) {
          return {
            ...dependency,
            status: "installing",
            phase: "downloading",
            checkedAt: new Date().toISOString(),
          } satisfies AgentRuntimeDependencySnapshot;
        }
        if (this.healthChecks.has(dependency.id)) {
          return {
            ...dependency,
            status: "checking",
            checkedAt: new Date().toISOString(),
          } satisfies AgentRuntimeDependencySnapshot;
        }
        const cachedHealth = this.healthCache.get(dependency.id);
        if (cachedHealth?.fingerprint === fingerprint) return cachedHealth.snapshot;
        const checkedAt = new Date().toISOString();
        if (dependency.kind === "controller") return this.inspectController(dependency, checkedAt);
        return this.inspectBrowserInstallation(dependency, checkedAt);
      }),
    );
    if (revision === this.dependencyStateRevision) this.listCache = { fingerprint, snapshots };
    return snapshots;
  }

  private async performHealthCheck(
    descriptor: AgentRuntimeDependencyDescriptor,
  ): Promise<AgentRuntimeDependencySnapshot> {
    const checkedAt = new Date().toISOString();
    if (descriptor.kind === "controller") return this.inspectController(descriptor, checkedAt);
    return this.inspectBrowserHealth(descriptor, checkedAt);
  }

  private inspectController(
    descriptor: AgentRuntimeDependencyDescriptor,
    checkedAt: string,
  ): AgentRuntimeDependencySnapshot {
    try {
      const controller = resolveAgentBrowserController({
        configuredPath: this.currentBrowserConfiguration().runtime.controllerPath,
        workspaceRoot: this.workspaceRoot,
        resourcesPath: this.resourcesPath,
        environment: process.env,
      });
      const version = readAgentBrowserPackageVersion();
      return { ...descriptor, status: "ready", path: controller, checkedAt, ...(version ? { version } : {}) };
    } catch (error) {
      return { ...descriptor, status: "unavailable", message: errorMessage(error), checkedAt };
    }
  }

  private async inspectBrowserInstallation(
    descriptor: AgentRuntimeDependencyDescriptor,
    checkedAt: string,
  ): Promise<AgentRuntimeDependencySnapshot> {
    // Keep discovery delegated to agent-browser; offline/quick skips its live launch test.
    return this.inspectBrowserWithDoctor(descriptor, checkedAt, ["doctor", "--offline", "--quick"], "inspection");
  }

  private async inspectBrowserHealth(
    descriptor: AgentRuntimeDependencyDescriptor,
    checkedAt: string,
  ): Promise<AgentRuntimeDependencySnapshot> {
    return this.inspectBrowserWithDoctor(descriptor, checkedAt, ["doctor"], "health-check");
  }

  private async inspectBrowserWithDoctor(
    descriptor: AgentRuntimeDependencyDescriptor,
    checkedAt: string,
    command: readonly string[],
    mode: "inspection" | "health-check",
  ): Promise<AgentRuntimeDependencySnapshot> {
    let controller: string;
    try {
      const configuration = this.currentBrowserConfiguration();
      controller = resolveAgentBrowserController({
        configuredPath: configuration.runtime.controllerPath,
        workspaceRoot: this.workspaceRoot,
        resourcesPath: this.resourcesPath,
        environment: process.env,
      });
    } catch (error) {
      return { ...descriptor, status: "unavailable", message: errorMessage(error), checkedAt };
    }

    let report: AgentBrowserDoctorReport | undefined;
    try {
      await this.run(
        controller,
        this.browserCommand(command, { mode }),
        (line) => {
          report ??= parseDoctorReport(line);
        },
        this.healthTimeoutMs(),
      );
      if (!report) throw new Error("agent-browser returned no structured dependency report.");
      return projectDoctorSnapshot(descriptor, checkedAt, report, mode === "health-check");
    } catch (error) {
      return { ...descriptor, status: "unavailable", message: errorMessage(error), checkedAt };
    }
  }

  private async installBrowser(
    dependency: AgentRuntimeDependencyDescriptor,
    installCommand: readonly string[],
    onProgress: (progress: AgentRuntimeDependencyProgress) => void,
  ): Promise<void> {
    const configuration = this.currentBrowserConfiguration();
    const controller = resolveAgentBrowserController({
      configuredPath: configuration.runtime.controllerPath,
      workspaceRoot: this.workspaceRoot,
      resourcesPath: this.resourcesPath,
      environment: process.env,
    });
    const emit = (patch: Partial<AgentRuntimeDependencySnapshot>): void => {
      onProgress({
        dependencyId: dependency.id,
        snapshot: {
          ...dependency,
          status: patch.status ?? "installing",
          checkedAt: new Date().toISOString(),
          ...patch,
        },
      });
    };
    emit({ status: "installing", phase: "downloading" });
    try {
      await this.run(
        controller,
        [...installCommand],
        (line) => {
          const progress = parseProgress(line);
          emit({
            status: "installing",
            phase: progress?.phase ?? "downloading",
            ...(progress?.percent === undefined ? {} : { percent: progress.percent }),
            ...(progress?.transferredBytes === undefined ? {} : { transferredBytes: progress.transferredBytes }),
            ...(progress?.totalBytes === undefined ? {} : { totalBytes: progress.totalBytes }),
            message: line,
          });
        },
        configuration.runtime.maxOperationTimeoutMs,
      );
      emit({ status: "checking", phase: "health-check" });
      const fingerprint = this.configurationFingerprint();
      const snapshot = await this.performHealthCheck(dependency);
      this.healthCache.set(dependency.id, { fingerprint, snapshot });
      if (snapshot.status !== "ready")
        throw new Error(snapshot.message ?? "Runtime dependency installation did not pass its health check.");
      emit({ ...snapshot, status: "ready", percent: 100, phase: "ready" });
    } catch (error) {
      this.logger?.warn("runtime_dependency.install_failed", {
        dependencyId: dependency.id,
        error: errorMessage(error),
      });
      emit({ status: "failed", phase: "failed", message: errorMessage(error) });
      throw error;
    }
  }

  private browserCommand(
    command: readonly string[],
    options: { readonly mode: "inspection" | "health-check" },
  ): string[] {
    const configuration = this.currentBrowserConfiguration();
    const headed = options.mode === "health-check" ? this.healthCheckPolicy.headed : false;
    assertAgentBrowserWindowModeSupported({ headed, environment: process.env });
    const args = ["--json"];
    const configuredExecutable = configuration.runtime.executablePath?.trim();
    if (configuredExecutable) {
      args.push(
        "--executable-path",
        resolveAgentBrowserExecutable({ configuredPath: configuredExecutable, workspaceRoot: this.workspaceRoot }),
      );
    }
    if (headed) args.push("--headed");
    args.push(
      "--idle-timeout",
      String(configuration.runtime.idleTimeoutMs),
      "--max-output",
      String(configuration.runtime.outputMaxChars),
      "--pin-tab",
      ...containerBrowserArguments(),
      ...command,
    );
    return args;
  }

  private run(
    controller: string,
    args: readonly string[],
    onLine?: (line: string) => void,
    timeoutMs = this.currentBrowserConfiguration().runtime.maxOperationTimeoutMs,
    settleOnLine?: (line: string) => boolean,
  ): Promise<void> {
    const operation = new Promise<void>((resolve, reject) => {
      if (this.closed) return reject(new Error("Runtime dependency manager is closed."));
      const child = spawn(controller, args, {
        cwd: this.workspaceRoot,
        env: process.env,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      this.children.add(child);
      let stderr = "";
      let settled = false;
      const stdoutLines = createAgentRuntimeDependencyLineBuffer();
      const stderrLines = createAgentRuntimeDependencyLineBuffer();
      const stderrDecoder = new StringDecoder("utf8");
      const timeout = setTimeout(() => {
        child.kill();
        finish(new Error(`Runtime dependency command exceeded ${timeoutMs}ms.`));
      }, timeoutMs);
      timeout.unref?.();
      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.children.delete(child);
        if (error) reject(error);
        else resolve();
      };
      const consumeLines = (lines: readonly string[]): void => {
        for (const line of lines) {
          onLine?.(line);
          if (!settled && settleOnLine?.(line)) {
            finish();
            child.kill();
            return;
          }
        }
      };
      child.stdout.on("data", (chunk: Buffer) => {
        consumeLines(stdoutLines.push(chunk));
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += stderrDecoder.write(chunk);
        consumeLines(stderrLines.push(chunk));
      });
      child.once("error", (error) => {
        finish(error);
      });
      child.once("close", (code) => {
        stderr += stderrDecoder.end();
        consumeLines(stdoutLines.flush());
        consumeLines(stderrLines.flush());
        if (settled) return;
        if (code === 0) finish();
        else finish(new Error(stderr.trim() || `agent-browser exited with code ${code ?? "unknown"}.`));
      });
    });
    return this.trackOperation(operation);
  }

  private trackOperation<T>(operation: Promise<T>): Promise<T> {
    this.operations.add(operation);
    const remove = (): void => {
      this.operations.delete(operation);
    };
    void operation.then(remove, remove);
    return operation;
  }

  private healthTimeoutMs(): number {
    return this.currentBrowserConfiguration().runtime.requestTimeoutMs;
  }

  private configurationFingerprint(): string {
    const configuration = this.currentBrowserConfiguration();
    const fingerprint = JSON.stringify({
      controllerPath: configuration.runtime.controllerPath ?? null,
      executablePath: configuration.runtime.executablePath ?? null,
      resourcesPath: this.resourcesPath ?? null,
      controllerPackageVersion: readAgentBrowserPackageVersion() ?? null,
      healthCheckHeaded: this.healthCheckPolicy.headed,
      controllerEnvironmentPath: process.env.AGENT_BROWSER_CONTROLLER_PATH ?? null,
      executableEnvironmentPath: process.env.AGENT_BROWSER_EXECUTABLE_PATH ?? null,
      containerMode: process.env.SENERA_CONTAINER ?? null,
    });
    if (this.observedFingerprint !== undefined && this.observedFingerprint !== fingerprint) {
      this.healthCache.clear();
      this.listCache = undefined;
      this.dependencyStateRevision += 1;
    }
    this.observedFingerprint = fingerprint;
    return fingerprint;
  }

  private invalidateDependencyCache(dependencyId: string): number {
    this.healthCache.delete(dependencyId);
    this.listCache = undefined;
    this.dependencyStateRevision += 1;
    return this.dependencyStateRevision;
  }

  private currentBrowserConfiguration(): AgentBrowserConfiguration {
    return typeof this.browserConfiguration === "function" ? this.browserConfiguration() : this.browserConfiguration;
  }
}

function requireRuntimeDependencyInstallCommand(descriptor: AgentRuntimeDependencyDescriptor): readonly string[] {
  if (!descriptor.installCommand?.length) {
    throw new Error(`Runtime dependency ${descriptor.id} has no declared installation command.`);
  }
  return descriptor.installCommand;
}

interface AgentBrowserDoctorCheck {
  readonly id?: unknown;
  readonly message?: unknown;
  readonly status?: unknown;
}

interface AgentBrowserDoctorReport {
  readonly checks: readonly AgentBrowserDoctorCheck[];
  readonly success?: unknown;
}

function parseDoctorReport(line: string): AgentBrowserDoctorReport | undefined {
  try {
    const value: unknown = JSON.parse(line);
    if (!value || typeof value !== "object" || !Array.isArray((value as { checks?: unknown }).checks)) return undefined;
    return {
      checks: (value as { checks: AgentBrowserDoctorCheck[] }).checks,
      success: (value as { success?: unknown }).success,
    };
  } catch {
    return undefined;
  }
}

function projectDoctorSnapshot(
  descriptor: AgentRuntimeDependencyDescriptor,
  checkedAt: string,
  report: AgentBrowserDoctorReport,
  activeHealthCheck: boolean,
): AgentRuntimeDependencySnapshot {
  const installed = findDoctorCheck(report, "chrome.installed");
  const cache = findDoctorCheck(report, "chrome.cache_dir");
  const browserPath = readInstalledBrowserPath(installed?.message);
  const browserVersion = readInstalledBrowserVersion(installed?.message);
  const cachePath = readCachePath(cache?.message);
  const cacheStatus = cachePath ? (fs.existsSync(cachePath) ? "available" : "missing") : "unknown";
  const hasBrowser = installed?.status === "pass" && Boolean(browserPath);
  const reportHealthy = report.success === true;
  const ready = activeHealthCheck ? reportHealthy && hasBrowser : hasBrowser;
  const message = ready ? undefined : doctorFailureMessage(report, installed, cache);

  return {
    ...descriptor,
    status: ready ? "ready" : "unavailable",
    checkedAt,
    ...(browserVersion ? { version: browserVersion } : {}),
    ...(browserPath ? { path: browserPath, ...readFileSize(browserPath) } : {}),
    ...(cachePath ? { cachePath, cacheStatus } : { cacheStatus }),
    ...(message ? { message } : {}),
  };
}

function findDoctorCheck(report: AgentBrowserDoctorReport, id: string): AgentBrowserDoctorCheck | undefined {
  return report.checks.find((check) => check.id === id);
}

function readInstalledBrowserPath(message: unknown): string | undefined {
  if (typeof message !== "string") return undefined;
  return message.match(/\bat\s+(.+)$/u)?.[1]?.trim();
}

function readInstalledBrowserVersion(message: unknown): string | undefined {
  if (typeof message !== "string") return undefined;
  return message.match(/^(.+?)\s+at\s+/u)?.[1]?.trim();
}

function readCachePath(message: unknown): string | undefined {
  if (typeof message !== "string") return undefined;
  return message.match(/^Cache dir\s+(.+)$/u)?.[1]?.trim();
}

function doctorFailureMessage(
  report: AgentBrowserDoctorReport,
  installed: AgentBrowserDoctorCheck | undefined,
  cache: AgentBrowserDoctorCheck | undefined,
): string {
  const failed = report.checks.find((check) => check.status === "fail" || check.status === "error");
  if (typeof failed?.message === "string") return failed.message;
  if (typeof installed?.message === "string" && installed.status !== "pass") return installed.message;
  if (typeof cache?.message === "string" && cache.status === "fail") return cache.message;
  return "agent-browser did not report an installed Chromium runtime.";
}

function readFileSize(filePath: string): { readonly sizeBytes?: number } {
  try {
    const sizeBytes = fs.statSync(filePath).size;
    return Number.isFinite(sizeBytes) ? { sizeBytes } : {};
  } catch {
    return {};
  }
}

function readAgentBrowserPackageVersion(): string | undefined {
  try {
    const require = createRequire(import.meta.url);
    const packagePath = require.resolve("agent-browser/package.json");
    const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8")) as { readonly version?: unknown };
    return typeof packageJson.version === "string" ? packageJson.version : undefined;
  } catch {
    return undefined;
  }
}

function containerBrowserArguments(): string[] {
  return process.env.SENERA_CONTAINER === "1"
    ? ["--args", `--disable-dev-shm-usage${process.getuid?.() === 0 ? ",--no-sandbox" : ""}`]
    : [];
}

function parseProgress(line: string):
  | {
      readonly phase?: string;
      readonly percent?: number;
      readonly transferredBytes?: number;
      readonly totalBytes?: number;
    }
  | undefined {
  const percent = line.match(/(?:^|\s)(\d{1,3}(?:\.\d+)?)%/u);
  const bytes = line.match(/(\d+(?:\.\d+)?)\s*(KB|MB|GB)\s*\/\s*(\d+(?:\.\d+)?)\s*(KB|MB|GB)/iu);
  if (!percent && !bytes) return { phase: line.toLowerCase().includes("extract") ? "extracting" : undefined };
  const result: { phase?: string; percent?: number; transferredBytes?: number; totalBytes?: number } = {};
  if (percent) result.percent = Math.min(100, Math.max(0, Number(percent[1])));
  if (bytes) {
    result.transferredBytes = toBytes(Number(bytes[1]), bytes[2]);
    result.totalBytes = toBytes(Number(bytes[3]), bytes[4]);
  }
  result.phase = line.toLowerCase().includes("extract") ? "extracting" : "downloading";
  return result;
}

function toBytes(value: number, unit: string): number {
  const powers = { kb: 1, mb: 2, gb: 3 } as const;
  const power = powers[unit.toLowerCase() as keyof typeof powers];
  if (power === undefined) throw new Error(`Unsupported transfer unit: ${unit}`);
  return Math.round(value * 1024 ** power);
}
