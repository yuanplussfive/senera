import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PolicyClient } from "@ai-sdk/policy-opa";
import { AgentApprovalRuntime } from "../Source/AgentSystem/Approvals/AgentApprovalRuntime.js";
import { AgentApprovalDecisions } from "../Source/AgentSystem/Approvals/AgentApprovalTypes.js";
import {
  ToolRiskAuditDecision,
  ToolRiskLevel,
  type ToolRiskAudit,
} from "../Source/AgentSystem/BamlClient/baml_client/index.js";
import type { AgentDomainEvent } from "../Source/AgentSystem/Events/AgentEvent.js";
import { AgentPiToolPermissionHook } from "../Source/AgentSystem/Pi/AgentPiToolPermissionHook.js";
import { AgentPluginRegistry } from "../Source/AgentSystem/Plugin/AgentPluginRegistry.js";
import { AgentBamlToolRiskAuditor } from "../Source/AgentSystem/Safety/AgentBamlToolRiskAuditor.js";
import { AgentCompositeToolApprovalPolicy } from "../Source/AgentSystem/Safety/AgentToolApprovalPolicy.js";
import { createAgentToolApprovalPolicy } from "../Source/AgentSystem/Safety/AgentToolApprovalPolicyFactory.js";
import { AgentToolPermissionGate } from "../Source/AgentSystem/Safety/AgentToolPermissionGate.js";
import type { ToolApprovalManifest, ToolExecutionManifest } from "../Source/AgentSystem/Types/PluginManifestTypes.js";
import type { LoadedPlugin, RegisteredTool } from "../Source/AgentSystem/Types/PluginRuntimeTypes.js";
import { writeToolContractFixture } from "./Support/ToolContractFixture.js";

const DefaultExecution = {
  Boundary: "Local",
  Network: "Deny",
  Workspace: "ReadOnly",
  LocalFallback: "Allow",
} satisfies ToolExecutionManifest;
const pluginFixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "senera-safety-plugin-"));
process.on("exit", () => fs.rmSync(pluginFixtureRoot, { recursive: true, force: true }));

await verifyManifestApprovalFlow();
await verifyAutomaticRiskApprovalFlow();
await verifyAiSdkGuardrailsPathTraversalApproval();
await verifyAiSdkGuardrailsSqlInjectionApproval();
await verifyBamlToolRiskAskApproval();
await verifyBamlToolRiskDenyRequiresApproval();
await verifyBamlToolRiskAllowFallsThroughToOpa();
await verifyBamlToolRiskFailureFallsThroughToManifest();
await verifyManifestDenyBlocksExecution();
await verifyUnknownToolRequiresApproval();
await verifyOpaDecisionTakesPrecedence();
await verifyPiBamlRuntimeContextReachesApprovalPolicy();
await verifyApprovalEmitFailureCleansPending();
await verifyCancelByRequestIdCleansPending();

console.log("Agent safety approval verification passed.");

async function verifyManifestApprovalFlow(): Promise<void> {
  const runtime = new AgentApprovalRuntime();
  const events: AgentDomainEvent[] = [];
  const hook = createHook({
    approvalRuntime: runtime,
    registry: createRegistry([
      createToolFixture("SeneraWriteTool", {
        approval: {
          Mode: "ask",
          Reason: "Manifest 要求写入前确认。",
        },
        permissions: ["filesystem:write:workspace"],
      }),
      createToolFixture("SeneraReadTool", {
        permissions: ["filesystem:read:workspace"],
      }),
    ]),
  });

  const pending = hook.authorize(createHookContext(events, "verify-manifest-ask"), {
    toolCallId: "call_write",
    toolName: "SeneraWriteTool",
    input: {
      path: "README.md",
    },
  });

  await waitForApproval(events);
  const approval = readApprovalEvent(events);
  assert.equal(approval.rule, "opa.tool.manifest.ask");
  assert.equal(approval.reason, "Manifest 要求写入前确认。");
  await runtime.tryResolve({
    approvalId: String(approval.approvalId),
    decision: AgentApprovalDecisions.ApproveOnce,
    message: "验证批准",
  });

  assert.equal(await pending, undefined);

  assert.equal(
    await hook.authorize(createHookContext(events, "verify-manifest-allow"), {
      toolCallId: "call_read",
      toolName: "SeneraReadTool",
      input: {
        path: "README.md",
      },
    }),
    undefined,
  );
  assert.equal(events.filter((event) => event.kind === "approval.requested").length, 1);
}

async function verifyAutomaticRiskApprovalFlow(): Promise<void> {
  const runtime = new AgentApprovalRuntime();
  const events: AgentDomainEvent[] = [];
  const hook = createHook({
    approvalRuntime: runtime,
    registry: createRegistry([
      createToolFixture("AutoRiskWriteTool", {
        permissions: ["filesystem:write:workspace"],
        risks: [
          {
            SideEffect: "write-workspace",
            Permission: "write",
          },
        ],
        effects: ["write-workspace"],
      }),
    ]),
  });

  const pending = hook.authorize(createHookContext(events, "verify-auto-risk-ask"), {
    toolCallId: "call_auto_risk_write",
    toolName: "AutoRiskWriteTool",
    input: {
      path: "README.md",
    },
  });

  await waitForApproval(events);
  const approval = readApprovalEvent(events);
  assert.equal(approval.rule, "opa.risk.permission.high_impact");
  assert.match(String(approval.reason), /高影响权限/);
  assert.ok(readArray(approval.riskSignals).includes("risk.permission:write"));
  assert.ok(readArray(approval.riskSignals).includes("risk.sideEffect:write-workspace"));
  await runtime.tryResolve({
    approvalId: String(approval.approvalId),
    decision: AgentApprovalDecisions.ApproveOnce,
  });

  assert.equal(await pending, undefined);
}

async function verifyAiSdkGuardrailsPathTraversalApproval(): Promise<void> {
  const runtime = new AgentApprovalRuntime();
  const events: AgentDomainEvent[] = [];
  const hook = createHook({
    approvalRuntime: runtime,
    registry: createRegistry([
      createToolFixture("ReadPathTool", {
        permissions: ["filesystem:read:workspace"],
      }),
    ]),
  });

  const pending = hook.authorize(createHookContext(events, "verify-guardrail-path"), {
    toolCallId: "call_guardrail_path",
    toolName: "ReadPathTool",
    input: {
      path: "../secrets.txt",
    },
  });

  await waitForApproval(events);
  const approval = readApprovalEvent(events);
  assert.equal(approval.rule, "ai-sdk-guardrails.path-traversal-prevention");
  assert.match(String(approval.reason), /Path traversal/);
  assert.ok(readArray(approval.riskSignals).includes("guardrail.status:user-approval"));
  assert.ok(readArray(approval.riskSignals).includes("guardrail.name:path-traversal-prevention"));
  await runtime.tryResolve({
    approvalId: String(approval.approvalId),
    decision: AgentApprovalDecisions.ApproveOnce,
  });

  assert.equal(await pending, undefined);
}

async function verifyAiSdkGuardrailsSqlInjectionApproval(): Promise<void> {
  const runtime = new AgentApprovalRuntime();
  const events: AgentDomainEvent[] = [];
  const hook = createHook({
    approvalRuntime: runtime,
    registry: createRegistry([
      createToolFixture("QueryTool", {
        permissions: ["database:read"],
      }),
    ]),
  });

  const pending = hook.authorize(createHookContext(events, "verify-guardrail-sql"), {
    toolCallId: "call_guardrail_sql",
    toolName: "QueryTool",
    input: {
      query: "DROP TABLE users",
    },
  });

  await waitForApproval(events);
  const approval = readApprovalEvent(events);
  assert.equal(approval.rule, "ai-sdk-guardrails.sql-injection-prevention");
  assert.match(String(approval.reason), /SQL injection/);
  assert.ok(readArray(approval.riskSignals).includes("guardrail.name:sql-injection-prevention"));
  await runtime.tryResolve({
    approvalId: String(approval.approvalId),
    decision: AgentApprovalDecisions.ApproveOnce,
  });

  assert.equal(await pending, undefined);
}

async function verifyBamlToolRiskAskApproval(): Promise<void> {
  const runtime = new AgentApprovalRuntime();
  const events: AgentDomainEvent[] = [];
  const hook = createHook({
    approvalRuntime: runtime,
    registry: createRegistry([createToolFixture("SemanticRiskTool")]),
    policy: createBamlRiskPolicy(
      createToolRiskAudit({
        decision: ToolRiskAuditDecision.Ask,
        riskLevel: ToolRiskLevel.High,
        reason: "语义审计要求用户确认高影响工具调用。",
        matchedConcerns: ["destructive-effect"],
      }),
    ),
  });

  const pending = hook.authorize(createHookContext(events, "verify-baml-risk-ask"), {
    toolCallId: "call_baml_ask",
    toolName: "SemanticRiskTool",
    input: {
      target: "workspace",
    },
  });

  await waitForApproval(events);
  const approval = readApprovalEvent(events);
  assert.equal(approval.rule, "baml-tool-risk.ask");
  assert.equal(approval.reason, "语义审计要求用户确认高影响工具调用。");
  assert.ok(readArray(approval.riskSignals).includes("baml.concern:destructive-effect"));
  await runtime.tryResolve({
    approvalId: String(approval.approvalId),
    decision: AgentApprovalDecisions.ApproveOnce,
  });

  assert.equal(await pending, undefined);
}

async function verifyBamlToolRiskDenyRequiresApproval(): Promise<void> {
  const runtime = new AgentApprovalRuntime();
  const events: AgentDomainEvent[] = [];
  const hook = createHook({
    approvalRuntime: runtime,
    registry: createRegistry([createToolFixture("SemanticDeniedTool")]),
    policy: createBamlRiskPolicy(
      createToolRiskAudit({
        decision: ToolRiskAuditDecision.Deny,
        riskLevel: ToolRiskLevel.Critical,
        reason: "语义审计拒绝越界工具调用。",
        matchedConcerns: ["workspace-boundary"],
      }),
    ),
  });

  const pending = hook.authorize(createHookContext(events, "verify-baml-risk-deny"), {
    toolCallId: "call_baml_deny",
    toolName: "SemanticDeniedTool",
    input: {},
  });

  await waitForApproval(events);
  const approval = readApprovalEvent(events);
  assert.equal(approval.rule, "baml-tool-risk.deny.requires-approval");
  assert.ok(readArray(approval.riskSignals).includes("baml.decision:Deny"));
  await runtime.tryResolve({
    approvalId: String(approval.approvalId),
    decision: AgentApprovalDecisions.ApproveOnce,
  });

  assert.equal(await pending, undefined);
}

async function verifyBamlToolRiskAllowFallsThroughToOpa(): Promise<void> {
  const runtime = new AgentApprovalRuntime();
  const events: AgentDomainEvent[] = [];
  const hook = createHook({
    approvalRuntime: runtime,
    registry: createRegistry([createToolFixture("OpaAfterBamlTool")]),
    policy: createBamlRiskPolicy(
      createToolRiskAudit({
        decision: ToolRiskAuditDecision.Allow,
        riskLevel: ToolRiskLevel.Low,
        tripwire: false,
      }),
      createPolicyClient({
        decision: "requires-approval",
        reason: "OPA 仍然要求确认。",
      }),
    ),
  });

  const pending = hook.authorize(createHookContext(events, "verify-baml-allow-opa"), {
    toolCallId: "call_baml_allow_opa",
    toolName: "OpaAfterBamlTool",
    input: {},
  });

  await waitForApproval(events);
  assert.equal(readApprovalEvent(events).rule, "opa.user-approval");
  await runtime.tryResolve({
    approvalId: String(readApprovalEvent(events).approvalId),
    decision: AgentApprovalDecisions.ApproveOnce,
  });

  assert.equal(await pending, undefined);
}

async function verifyBamlToolRiskFailureFallsThroughToManifest(): Promise<void> {
  const hook = createHook({
    registry: createRegistry([
      createToolFixture("ManifestAfterBamlFailureTool", {
        approval: {
          Mode: "allow",
          Reason: "Manifest 允许。",
        },
      }),
    ]),
    policy: createBamlRiskPolicy(new Error("synthetic baml failure")),
  });

  assert.deepEqual(
    await hook.authorize(createHookContext([], "verify-baml-failure-manifest"), {
      toolCallId: "call_baml_failure_manifest",
      toolName: "ManifestAfterBamlFailureTool",
      input: {},
    }),
    undefined,
  );
}

async function verifyManifestDenyBlocksExecution(): Promise<void> {
  const hook = createHook({
    registry: createRegistry([
      createToolFixture("DeniedTool", {
        approval: {
          Mode: "deny",
          Reason: "Manifest 禁止调用。",
        },
      }),
    ]),
  });

  assert.deepEqual(
    await hook.authorize(createHookContext([], "verify-manifest-deny"), {
      toolCallId: "call_denied",
      toolName: "DeniedTool",
      input: {},
    }),
    {
      block: true,
      reason: "Manifest 禁止调用。",
    },
  );
}

async function verifyUnknownToolRequiresApproval(): Promise<void> {
  const runtime = new AgentApprovalRuntime();
  const events: AgentDomainEvent[] = [];
  const hook = createHook({
    approvalRuntime: runtime,
    registry: createRegistry([]),
  });

  const pending = hook.authorize(createHookContext(events, "verify-unknown-tool"), {
    toolCallId: "call_unknown",
    toolName: "UnknownTool",
    input: {},
  });

  await waitForApproval(events);
  const approval = readApprovalEvent(events);
  assert.equal(approval.rule, "opa.tool.registry.missing");
  assert.match(String(approval.reason), /未在插件注册表中声明/);
  await runtime.tryResolve({
    approvalId: String(approval.approvalId),
    decision: AgentApprovalDecisions.Deny,
    message: "验证拒绝未知工具",
  });

  assert.deepEqual(await pending, {
    block: true,
    reason: "验证拒绝未知工具",
  });
}

async function verifyOpaDecisionTakesPrecedence(): Promise<void> {
  const runtime = new AgentApprovalRuntime();
  const events: AgentDomainEvent[] = [];
  const policyClient = createPolicyClient({
    decision: "requires-approval",
    reason: "OPA 要求确认。",
  });
  const hook = createHook({
    approvalRuntime: runtime,
    registry: createRegistry([
      createToolFixture("PolicyControlledTool", {
        approval: {
          Mode: "allow",
          Reason: "Manifest 默认允许。",
        },
      }),
    ]),
    policy: new AgentCompositeToolApprovalPolicy({
      opa: {
        client: policyClient,
        path: "senera/tool/decision",
      },
    }),
  });

  const pending = hook.authorize(createHookContext(events, "verify-opa-precedence"), {
    toolCallId: "call_policy",
    toolName: "PolicyControlledTool",
    input: {
      value: 1,
    },
  });

  await waitForApproval(events);
  const approval = readApprovalEvent(events);
  assert.equal(approval.rule, "opa.user-approval");
  assert.equal(approval.reason, "OPA 要求确认。");
  await runtime.tryResolve({
    approvalId: String(approval.approvalId),
    decision: AgentApprovalDecisions.ApproveOnce,
  });

  assert.equal(await pending, undefined);
}

async function verifyPiBamlRuntimeContextReachesApprovalPolicy(): Promise<void> {
  const runtime = new AgentApprovalRuntime();
  const events: AgentDomainEvent[] = [];
  let capturedRuntimeContext: Record<string, unknown> | undefined;
  const policyClient = createPolicyClient(
    {
      decision: "requires-approval",
      reason: "运行上下文已进入 policy-opa 输入。",
    },
    (input) => {
      capturedRuntimeContext = readRecord(readRecord(input).runtimeContext);
    },
  );
  const registry = createRegistry([createToolFixture("ContextAwareTool")]);
  const hook = createHook({
    approvalRuntime: runtime,
    registry,
    policy: new AgentCompositeToolApprovalPolicy({
      opa: {
        client: policyClient,
        path: "senera/tool/decision",
      },
    }),
  });

  const pending = hook.authorize(
    {
      ...createHookContext(events, "verify-runtime-context"),
      rootCommand: {
        authority: "senera_runtime_root",
        action: "use_tools",
        outputMode: "open",
        toolAccess: "restricted",
        objective: "验证运行上下文",
        instruction: "让策略看到 root command。",
        allowedTools: [],
        forbiddenOutputs: [],
        insufficiencyPolicy: "验证缺口。",
        preferredTools: ["ContextAwareTool"],
        toolSearchQueries: [],
        needs: [],
        includeToolCatalog: true,
        visibleOutput: {
          audience: "user",
          start: "answer",
          format: "markdown",
          rules: [],
          repair: {
            instruction: "repair",
            rules: [],
          },
        },
      },
      activeSkills: [],
    },
    {
      toolCallId: "call_context",
      toolName: "ContextAwareTool",
      input: {},
    },
  );

  await waitForApproval(events);
  assert.equal(readRecord(capturedRuntimeContext?.rootCommand).objective, "验证运行上下文");
  await runtime.tryResolve({
    approvalId: String(readApprovalEvent(events).approvalId),
    decision: AgentApprovalDecisions.ApproveOnce,
  });
  assert.equal(await pending, undefined);
}

async function verifyApprovalEmitFailureCleansPending(): Promise<void> {
  const runtime = new AgentApprovalRuntime();
  await assert.rejects(
    runtime.requestApproval({
      onEvent: async () => {
        throw new Error("emit failed");
      },
      approval: {
        kind: "tool_call",
        sessionId: "verify-approval-emit-failed-session",
        requestId: "verify-approval-emit-failed",
        step: 1,
        title: "验证发送失败清理",
        reason: "验证事件发送失败不会留下 pending。",
        availableDecisions: [AgentApprovalDecisions.ApproveOnce, AgentApprovalDecisions.Deny],
        subject: {
          kind: "tool_call",
          toolName: "SeneraWriteTool",
          arguments: {},
        },
      },
    }),
    /emit failed/,
  );
}

async function verifyCancelByRequestIdCleansPending(): Promise<void> {
  const runtime = new AgentApprovalRuntime();
  const pending = runtime.requestApproval({
    onEvent: async () => undefined,
    approval: {
      kind: "tool_call",
      sessionId: "verify-approval-cancel-session",
      requestId: "verify-approval-cancel",
      step: 1,
      title: "验证取消",
      reason: "验证运行取消时审批被清理。",
      availableDecisions: [AgentApprovalDecisions.ApproveOnce, AgentApprovalDecisions.Deny],
      subject: {
        kind: "tool_call",
        toolName: "SeneraWriteTool",
        arguments: {},
      },
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(await runtime.cancelByRequestId("verify-approval-cancel"), 1);
  assert.equal((await pending).status, "cancelled");
}

function createHook(options: {
  registry: AgentPluginRegistry;
  approvalRuntime?: AgentApprovalRuntime;
  policy?: AgentCompositeToolApprovalPolicy;
}): AgentPiToolPermissionHook {
  return new AgentPiToolPermissionHook({
    registry: options.registry,
    permissionGate: new AgentToolPermissionGate({
      approvalRuntime: options.approvalRuntime,
      policy:
        options.policy ??
        createAgentToolApprovalPolicy({
          registry: options.registry,
        }),
    }),
  });
}

function createHookContext(events: AgentDomainEvent[], requestId: string) {
  return {
    sessionId: `${requestId}-session`,
    requestId,
    step: 1,
    visibleToolNames: "all" as const,
    onEvent: async (event: AgentDomainEvent) => {
      events.push(event);
    },
  };
}

function createPolicyClient(decision: Record<string, unknown>, onEvaluate?: (input: unknown) => void): PolicyClient {
  return {
    async evaluate(_path, input) {
      assert.equal(readRecord(input).tool && typeof readRecord(input).tool === "object", true);
      onEvaluate?.(input);
      return decision as never;
    },
  };
}

function createBamlRiskPolicy(audit: ToolRiskAudit | Error, opa?: PolicyClient): AgentCompositeToolApprovalPolicy {
  return new AgentCompositeToolApprovalPolicy({
    auditors: [
      new AgentBamlToolRiskAuditor({
        client: {
          async auditToolRisk() {
            if (audit instanceof Error) {
              throw audit;
            }
            return audit;
          },
        },
      }),
    ],
    ...(opa
      ? {
          opa: {
            client: opa,
            path: "senera/tool/decision",
          },
        }
      : {}),
  });
}

function createToolRiskAudit(patch: Partial<ToolRiskAudit>): ToolRiskAudit {
  return {
    decision: ToolRiskAuditDecision.Allow,
    riskLevel: ToolRiskLevel.Low,
    confidence: 0.95,
    tripwire: patch.decision ? patch.decision !== ToolRiskAuditDecision.Allow : false,
    reason: "语义审计未发现需要中断的风险。",
    matchedConcerns: [],
    ...patch,
  };
}

function createRegistry(tools: RegisteredTool[]): AgentPluginRegistry {
  const registry = new AgentPluginRegistry();
  if (tools.length > 0) {
    registry.registerPlugin(createPluginFixture(tools));
  }
  return registry;
}

function createPluginFixture(tools: RegisteredTool[]): LoadedPlugin {
  const plugin = tools[0]?.plugin;
  if (!plugin) {
    throw new Error("Missing plugin fixture.");
  }

  const rootPath = path.join(pluginFixtureRoot, crypto.randomUUID());
  fs.mkdirSync(rootPath, { recursive: true });
  writeToolContractFixture(
    rootPath,
    plugin.manifest.Plugin.Name,
    tools.map((tool) => tool.name),
  );

  return {
    ...plugin,
    rootPath,
    manifestPath: path.join(rootPath, "PluginManifest.json"),
    manifest: {
      ...plugin.manifest,
      Contracts: { File: "./ToolContracts.json" },
      Tools: tools.map((tool) => ({
        Name: tool.name,
        Permissions: [...tool.permissions],
        Approval: tool.approval,
        Execution: tool.execution,
        Runtime: tool.runtime,
        Handler: {
          Kind: "HostCapability" as const,
          Capability: tool.handler.kind === "HostCapability" ? tool.handler.capability : "verify",
        },
        Search: tool.search,
      })),
    },
  };
}

function createToolFixture(
  name: string,
  options: {
    approval?: ToolApprovalManifest;
    permissions?: string[];
    risks?: Array<{
      SideEffect?: string;
      Permission?: string;
    }>;
    effects?: string[];
  } = {},
): RegisteredTool {
  const plugin: LoadedPlugin = {
    rootPath: "System/Plugins/Verify",
    rootKind: "System",
    manifestPath: "System/Plugins/Verify/PluginManifest.json",
    config: {
      fileName: "PluginConfig.toml",
      path: "System/Plugins/Verify/PluginConfig.toml",
      exists: false,
      source: "default",
      templateExists: false,
      needsUserConfig: false,
      toml: "",
      sections: [],
      runtime: {
        enabled: true,
        tools: {},
      },
      diagnostics: [],
    },
    manifest: {
      ManifestVersion: 2,
      Plugin: {
        Name: "VerifyPlugin",
        Title: "Verify Plugin",
        Version: "1.0.0",
        Kind: "Tool",
        Description: "Verification fixture.",
      },
      Security: {
        TrustLevel: "System",
        RequiresApproval: false,
      },
    },
  };

  return {
    name,
    loading: "Dynamic",
    descriptionFile: undefined,
    permissions: options.permissions ?? [],
    handler: {
      kind: "HostCapability",
      capability: "verify",
    },
    runtime: { Lifecycle: "Immediate", ProtocolVersion: 2, Capabilities: { Cancellation: true } },
    search: {
      Capabilities: [
        {
          Id: `${name}.capability`,
          Risk: options.risks?.[0],
          Facets: {
            Effects: options.effects ?? [],
          },
        },
      ],
    },
    evidenceCapabilities: [],
    approval: options.approval,
    execution: DefaultExecution,
    plugin,
  };
}

function readApprovalEvent(events: readonly AgentDomainEvent[]): Record<string, unknown> {
  return readRecord(events.find((event) => event.kind === "approval.requested")?.data);
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

async function waitForApproval(events: readonly AgentDomainEvent[]): Promise<void> {
  const started = Date.now();
  while (!events.some((event) => event.kind === "approval.requested")) {
    if (Date.now() - started > 5_000) {
      throw new Error("等待审批事件超时。");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
