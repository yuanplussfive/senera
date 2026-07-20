import { describe, expect, test, vi } from "vitest";
import type { PolicyClient } from "@ai-sdk/policy-opa";
import { AgentApprovalRuntime } from "../../../Source/AgentSystem/Approvals/AgentApprovalRuntime.js";
import { AgentApprovalDecisions } from "../../../Source/AgentSystem/Approvals/AgentApprovalTypes.js";
import { AgentPluginRegistry } from "../../../Source/AgentSystem/Plugin/AgentPluginRegistry.js";
import type { AgentDomainEvent, AgentEventSink } from "../../../Source/AgentSystem/Events/AgentEvent.js";
import { AgentExecutionFallbackAuthorizer } from "../../../Source/AgentSystem/Safety/AgentExecutionFallbackAuthorizer.js";
import { createSeneraAuthorizedPersistentProcessSpawner } from "../../../Source/AgentSystem/Execution/SeneraPersistentProcessSpawner.js";
import { SeneraRoutingProcessBackend } from "../../../Source/AgentSystem/Execution/SeneraRoutingProcessBackend.js";
import type {
  SeneraProcessFallbackAuthorizationRequest,
  SeneraProcessFallbackContext,
} from "../../../Source/AgentSystem/Execution/SeneraProcessFallbackAuthorization.js";
import type {
  SeneraProcessExecutionBackend,
  SeneraProcessExecutionRequest,
} from "../../../Source/AgentSystem/Execution/SeneraProcessExecutionBackend.js";
import type { SeneraPersistentProcessChild } from "../../../Source/AgentSystem/Execution/SeneraPersistentProcessTypes.js";
import {
  SeneraExecutionError,
  SeneraExecutionErrorCodes,
  type SeneraShellExecutionResult,
} from "../../../Source/AgentSystem/Execution/SeneraExecutionTypes.js";

const successfulResult: SeneraShellExecutionResult = {
  stdout: "ok",
  stderr: "",
  exitCode: 0,
  signal: null,
};

describe("execution backend fallback routing", () => {
  test("routes local execution directly without consulting sandbox or policy", async () => {
    const local = new StubBackend("local", successfulResult);
    const sandbox = new StubBackend("sandbox", sandboxUnavailable());
    const authorize = vi.fn();
    const router = new SeneraRoutingProcessBackend({
      local,
      sandbox,
      fallbackAuthorizer: { authorize },
    });

    await expect(router.executeProcess(createRequest("local", "deny"))).resolves.toEqual(successfulResult);
    expect(local.requests).toHaveLength(1);
    expect(sandbox.requests).toHaveLength(0);
    expect(authorize).not.toHaveBeenCalled();
  });

  test("keeps strict sandbox failures inside the sandbox boundary", async () => {
    const local = new StubBackend("local", successfulResult);
    const failure = sandboxUnavailable();
    const sandbox = new StubBackend("sandbox", failure);
    const authorize = vi.fn();
    const router = new SeneraRoutingProcessBackend({
      local,
      sandbox,
      fallbackAuthorizer: { authorize },
    });

    await expect(router.executeProcess(createRequest("sandbox", "deny"))).rejects.toBe(failure);
    expect(local.requests).toHaveLength(0);
    expect(authorize).not.toHaveBeenCalled();
  });

  test("authorizes and audits an eligible sandbox failure before local execution", async () => {
    const events: AgentDomainEvent[] = [];
    const context = createFallbackContext((event) => {
      events.push(event);
    });
    const local = new StubBackend("local", successfulResult);
    const sandbox = new StubBackend("sandbox", sandboxUnavailable());
    const authorize = vi.fn(async () => ({
      rule: "execution.fallback.external_approval",
      reason: "approved",
      approvalId: "approval-1",
      scope: "once" as const,
    }));
    const router = new SeneraRoutingProcessBackend({
      local,
      sandbox,
      fallbackAuthorizer: { authorize },
    });

    await expect(router.executeProcess(createRequest("sandbox", "allow", context))).resolves.toEqual(successfulResult);
    expect(authorize).toHaveBeenCalledOnce();
    expect(local.requests).toHaveLength(1);
    expect(events).toContainEqual(
      expect.objectContaining({
        kind: "execution.fallback.started",
        data: expect.objectContaining({ approvalId: "approval-1", scope: "once" }),
      }),
    );
  });

  test("does not authorize non-availability sandbox failures or requests without trusted context", async () => {
    const authorize = vi.fn();
    const runtimeFailure = new SeneraExecutionError(SeneraExecutionErrorCodes.SpawnFailed, "bad command");
    const noContextRouter = new SeneraRoutingProcessBackend({
      local: new StubBackend("local", successfulResult),
      sandbox: new StubBackend("sandbox", sandboxUnavailable()),
      fallbackAuthorizer: { authorize },
    });
    const runtimeFailureRouter = new SeneraRoutingProcessBackend({
      local: new StubBackend("local", successfulResult),
      sandbox: new StubBackend("sandbox", runtimeFailure),
      fallbackAuthorizer: { authorize },
    });

    await expect(noContextRouter.executeProcess(createRequest("sandbox", "allow"))).rejects.toMatchObject({
      code: SeneraExecutionErrorCodes.SandboxUnavailable,
    });
    await expect(
      runtimeFailureRouter.executeProcess(createRequest("sandbox", "allow", createFallbackContext())),
    ).rejects.toBe(runtimeFailure);
    expect(authorize).not.toHaveBeenCalled();
  });
});

describe("persistent process fallback routing", () => {
  test("requires authorization and emits audit before starting a preferred local fallback", async () => {
    const calls: string[] = [];
    const events: AgentDomainEvent[] = [];
    const child = {} as SeneraPersistentProcessChild;
    const local = vi.fn(async () => {
      calls.push("spawn");
      return child;
    });
    const authorize = vi.fn(async () => {
      calls.push("authorize");
      return { rule: "fallback.test", reason: "approved", scope: "session" as const };
    });
    const spawnPersistent = createSeneraAuthorizedPersistentProcessSpawner({
      local,
      fallbackAuthorizer: { authorize },
    });

    await expect(
      spawnPersistent("mcp", [], {
        cwd: process.cwd(),
        windowsHide: true,
        profile: {
          name: "external-mcp",
          kind: "mcp-server",
          backend: "sandbox",
          localFallback: "allow",
          fallbackContext: createFallbackContext((event) => {
            calls.push("audit");
            events.push(event);
          }),
        },
      }),
    ).resolves.toBe(child);

    expect(calls).toEqual(["authorize", "audit", "spawn"]);
    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "persistent_sandbox_unsupported",
      }),
    );
    expect(events[0]).toMatchObject({ kind: "execution.fallback.started" });
  });

  test.each([
    { backend: "sandbox" as const, localFallback: "deny" as const },
    { backend: "sandbox" as const, localFallback: "allow" as const },
  ])("fails closed for $backend/$localFallback without a complete fallback contract", async (profile) => {
    const local = vi.fn(async () => ({}) as SeneraPersistentProcessChild);
    const authorize = vi.fn();
    const spawnPersistent = createSeneraAuthorizedPersistentProcessSpawner({
      local,
      fallbackAuthorizer: { authorize },
    });

    await expect(
      spawnPersistent("mcp", [], {
        cwd: process.cwd(),
        windowsHide: true,
        profile: {
          name: "strict-mcp",
          kind: "mcp-server",
          ...profile,
        },
      }),
    ).rejects.toMatchObject({ code: SeneraExecutionErrorCodes.SandboxUnavailable });
    expect(local).not.toHaveBeenCalled();
    expect(authorize).not.toHaveBeenCalled();
  });
});

describe("execution fallback approval", () => {
  test("supports a fingerprinted session grant without repeating approval", async () => {
    const approvalRuntime = new AgentApprovalRuntime();
    const events: AgentDomainEvent[] = [];
    const policyClient = new StaticPolicyClient({
      decision: "requires-approval",
      rule: "execution.fallback.external_approval",
      reason: "External plugin requires approval.",
      riskSignals: ["execution.to:node"],
    });
    const authorizer = new AgentExecutionFallbackAuthorizer({
      registry: new AgentPluginRegistry(),
      approvalRuntime,
      policyClient,
    });
    const request = createAuthorizationRequest((event) => {
      events.push(event);
    });

    const first = authorizer.authorize(request);
    await vi.waitFor(() => expect(events).toHaveLength(1));
    const approvalId = String(readRecord(events[0]?.data).approvalId);
    await approvalRuntime.resolve({ approvalId, decision: AgentApprovalDecisions.ApproveSession });

    await expect(first).resolves.toMatchObject({ approvalId, scope: "session" });
    await expect(authorizer.authorize(request)).resolves.toMatchObject({
      scope: "session",
      rule: "execution.fallback.external_approval.session_grant",
    });
    expect(events.filter((event) => event.kind === "approval.requested")).toHaveLength(1);
  });

  test("does not reuse a session grant across conversations", async () => {
    const approvalRuntime = new AgentApprovalRuntime();
    const events: AgentDomainEvent[] = [];
    const authorizer = new AgentExecutionFallbackAuthorizer({
      registry: new AgentPluginRegistry(),
      approvalRuntime,
      policyClient: new StaticPolicyClient({
        decision: "requires-approval",
        rule: "execution.fallback.external_approval",
        reason: "External plugin requires approval.",
      }),
    });
    const firstRequest = createAuthorizationRequest((event) => {
      events.push(event);
    }, "session-a");
    const first = authorizer.authorize(firstRequest);
    await vi.waitFor(() => expect(events).toHaveLength(1));
    await approvalRuntime.resolve({
      approvalId: String(readRecord(events[0]?.data).approvalId),
      decision: AgentApprovalDecisions.ApproveSession,
    });
    await first;

    const second = authorizer.authorize(
      createAuthorizationRequest((event) => {
        events.push(event);
      }, "session-b"),
    );
    await vi.waitFor(() => expect(events.filter((event) => event.kind === "approval.requested")).toHaveLength(2));
    const secondApproval = events.filter((event) => event.kind === "approval.requested").at(-1);
    await approvalRuntime.resolve({
      approvalId: String(readRecord(secondApproval?.data).approvalId),
      decision: AgentApprovalDecisions.Deny,
    });
    await expect(second).rejects.toMatchObject({ code: SeneraExecutionErrorCodes.SandboxUnavailable });
  });

  test("preserves denial and cancellation without creating a local grant", async () => {
    const approvalRuntime = new AgentApprovalRuntime();
    const events: AgentDomainEvent[] = [];
    const authorizer = new AgentExecutionFallbackAuthorizer({
      registry: new AgentPluginRegistry(),
      approvalRuntime,
      policyClient: new StaticPolicyClient({
        decision: "requires-approval",
        rule: "execution.fallback.external_approval",
        reason: "Approval required.",
      }),
    });
    const request = createAuthorizationRequest((event) => {
      events.push(event);
    });
    const pending = authorizer.authorize(request);
    await vi.waitFor(() => expect(events).toHaveLength(1));
    await approvalRuntime.resolve({
      approvalId: String(readRecord(events[0]?.data).approvalId),
      decision: AgentApprovalDecisions.Deny,
      message: "Denied by user.",
    });

    await expect(pending).rejects.toMatchObject({
      code: SeneraExecutionErrorCodes.SandboxUnavailable,
      message: "Denied by user.",
    });
  });
});

class StubBackend implements SeneraProcessExecutionBackend {
  readonly requests: SeneraProcessExecutionRequest[] = [];

  constructor(
    readonly kind: string,
    private readonly outcome: SeneraShellExecutionResult | Error,
  ) {}

  async executeProcess(request: SeneraProcessExecutionRequest): Promise<SeneraShellExecutionResult> {
    this.requests.push(request);
    if (this.outcome instanceof Error) throw this.outcome;
    return this.outcome;
  }
}

class StaticPolicyClient implements PolicyClient {
  constructor(private readonly result: unknown) {}

  async evaluate<TInput = unknown, TResult = unknown>(_pathName: string, _input: TInput): Promise<TResult> {
    return this.result as TResult;
  }
}

function createRequest(
  backend: "local" | "sandbox",
  localFallback: "allow" | "deny",
  fallbackContext?: SeneraProcessFallbackContext,
): SeneraProcessExecutionRequest {
  return {
    command: "test-command",
    args: [],
    cwd: process.cwd(),
    timeoutMs: 1_000,
    limits: { timeoutMs: 1_000, maxStdoutBytes: 1_024, maxStderrBytes: 1_024 },
    profile: {
      name: "test-profile",
      kind: "mcp-server",
      backend,
      localFallback,
      fallbackContext,
    },
  };
}

function createFallbackContext(onEvent?: AgentEventSink, sessionId = "session-1"): SeneraProcessFallbackContext {
  return {
    sessionId,
    requestId: "request-1",
    step: 1,
    toolCallId: "call-1",
    onEvent,
    subject: {
      pluginName: "ExternalPlugin",
      pluginTitle: "External Plugin",
      pluginVersion: "1.0.0",
      manifestDigest: "a".repeat(64),
      rootKind: "User",
      trustLevel: "External",
      toolName: "ExternalTool",
      boundary: "SandboxPreferred",
      network: "Allow",
      workspace: "ReadOnly",
      permissions: ["network:http"],
    },
  };
}

function createAuthorizationRequest(
  onEvent: AgentEventSink,
  sessionId?: string,
): SeneraProcessFallbackAuthorizationRequest {
  return {
    fromBackend: "microsandbox",
    toBackend: "node",
    reason: "sandbox_unavailable",
    error: sandboxUnavailable(),
    context: createFallbackContext(onEvent, sessionId),
  };
}

function sandboxUnavailable(): SeneraExecutionError {
  return new SeneraExecutionError(SeneraExecutionErrorCodes.SandboxUnavailable, "sandbox unavailable");
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
