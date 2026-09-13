import { describe, expect, test } from "vitest";
import { executeAgentSelfCommand } from "../../../Source/AgentSystem/SelfService/AgentSelfCommand.js";
import type {
  AgentSelfApprovalChannel,
  AgentSelfApprovalRequest,
  AgentSelfApprovalVerdict,
} from "../../../Source/AgentSystem/SelfService/AgentSelfApprovalTypes.js";
import type { AgentSelfServicePort } from "../../../Source/AgentSystem/SelfService/AgentSelfServiceTypes.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";
import { resolveToolApprovalDisposition } from "../../../Source/AgentSystem/SystemTools/SeneraSelfSystemTool.js";
import { AgentExecutionApprovalModes } from "../../../Source/AgentSystem/Safety/AgentExecutionApprovalMode.js";
import { createAgentSelfTestConfigPort, type AgentSelfTestConfigRevision } from "./AgentSelfTestHarness.js";

function baseConfig(overrides?: Partial<AgentSystemConfig>): AgentSystemConfig {
  return {
    DefaultModelProviderId: "main",
    ModelProviderEndpoints: [
      { Id: "main", Enabled: true, Kind: "OpenAICompatible" as const, BaseUrl: "https://models.example.test/v1" },
    ],
    ModelProviders: [
      { Id: "gpt-5.6", ProviderId: "main", Endpoint: "ChatCompletions" as const, Model: "gpt-5.6-2026" },
    ],
    ...overrides,
  } as unknown as AgentSystemConfig;
}

function createConfigPort(
  initial: AgentSystemConfig,
  history?: readonly AgentSelfTestConfigRevision[],
): ReturnType<typeof createAgentSelfTestConfigPort> {
  return createAgentSelfTestConfigPort(initial, history);
}

function createApprovalChannel(verdict: AgentSelfApprovalVerdict): {
  channel: AgentSelfApprovalChannel;
  requests: AgentSelfApprovalRequest[];
} {
  const requests: AgentSelfApprovalRequest[] = [];
  return {
    requests,
    channel: {
      async request(input) {
        requests.push(input);
        return verdict;
      },
    },
  };
}

describe("senera self-service config update approval", () => {
  test("human-level path requires the approval channel and commits after approval", async () => {
    const { port, replaceCalls } = createConfigPort(baseConfig());
    const { channel, requests } = createApprovalChannel({ status: "approved" });
    const output = await executeAgentSelfCommand(
      { command: "config", action: "update", path: "DefaultModelProviderId", value: "gpt-5.6" },
      port() as AgentSelfServicePort,
      { approvals: channel },
    );
    expect(output.ok).toBe(true);
    expect(output.data).toMatchObject({ path: "DefaultModelProviderId", revision: 8 });
    expect(replaceCalls).toHaveLength(1);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      path: "DefaultModelProviderId",
      value: "gpt-5.6",
      rule: { pattern: "DefaultModelProviderId", level: "human" },
    });
  });

  test("human-level path denied by the channel is rejected without a replace", async () => {
    const { port, replaceCalls } = createConfigPort(baseConfig());
    const { channel } = createApprovalChannel({ status: "denied", message: "拒绝" });
    const output = await executeAgentSelfCommand(
      { command: "config", action: "update", path: "ModelProviderEndpoints.0.BaseUrl", value: "https://evil.test" },
      port() as AgentSelfServicePort,
      { approvals: channel },
    );
    expect(output.ok).toBe(false);
    expect(output.error).toBe("approval_denied");
    expect(replaceCalls).toHaveLength(0);
  });

  test("human-level path defers when the channel has no human on the CLI path", async () => {
    const { port, replaceCalls } = createConfigPort(baseConfig());
    const { channel } = createApprovalChannel({
      status: "deferred",
      approvalId: "a-1",
      deadlineAt: "2026-09-09T00:00:00.000Z",
    });
    const output = await executeAgentSelfCommand(
      { command: "config", action: "update", path: "Server.AccessControl.Mode", value: "disabled" },
      port() as AgentSelfServicePort,
      { approvals: channel },
    );
    expect(output.ok).toBe(false);
    expect(output.error).toBe("approval_required");
    expect(output.approvalRequired).toMatchObject({
      approvalId: "a-1",
      reason: expect.any(String),
      command: { command: "config", action: "update", path: "Server.AccessControl.Mode", value: "disabled" },
    });
    expect(replaceCalls).toHaveLength(0);
  });

  test("human-level path without any approval channel is rejected deterministically", async () => {
    const { port, replaceCalls } = createConfigPort(baseConfig());
    const output = await executeAgentSelfCommand(
      { command: "config", action: "update", path: "DefaultModelProviderId", value: "gpt-5.6" },
      port() as AgentSelfServicePort,
    );
    expect(output.ok).toBe(false);
    expect(output.error).toBe("approval_denied");
    expect(replaceCalls).toHaveLength(0);
  });

  test("guard-level path passes without a channel when the value is valid", async () => {
    const { port, replaceCalls } = createConfigPort(baseConfig());
    const output = await executeAgentSelfCommand(
      { command: "config", action: "update", path: "ModelProviders.0.Temperature", value: 0.7 },
      port() as AgentSelfServicePort,
    );
    expect(output.ok).toBe(true);
    expect(replaceCalls).toHaveLength(1);
  });

  test("guard-level path rejects an out-of-range value without a replace", async () => {
    const { port, replaceCalls } = createConfigPort(baseConfig());
    const output = await executeAgentSelfCommand(
      { command: "config", action: "update", path: "ModelProviders.0.Temperature", value: 9 },
      port() as AgentSelfServicePort,
    );
    expect(output.ok).toBe(false);
    expect(output.error).toBe("approval_denied");
    expect(output.text).toMatch(/安全范围/);
    expect(replaceCalls).toHaveLength(0);
  });

  test("approval resolve denies without executing", async () => {
    const { port, replaceCalls } = createConfigPort(baseConfig());
    const { channel } = createApprovalChannel({ status: "denied", message: "n/a" });
    const withResolve: AgentSelfApprovalChannel = {
      ...channel,
      resolve: async () => ({ status: "resolved", decision: "deny" }),
    };
    const output = await executeAgentSelfCommand(
      { command: "approval", action: "resolve", approvalId: "a-1", decision: "deny" },
      port() as AgentSelfServicePort,
      { approvals: withResolve },
    );
    expect(output.ok).toBe(true);
    expect(output.data).toMatchObject({ decision: "denied" });
    expect(replaceCalls).toHaveLength(0);
  });

  test("approval resolve replays the original command after approval", async () => {
    const { port, replaceCalls } = createConfigPort(baseConfig());
    const { channel } = createApprovalChannel({ status: "denied", message: "n/a" });
    const withResolve: AgentSelfApprovalChannel = {
      ...channel,
      resolve: async () => ({
        status: "resolved",
        decision: "approve",
        command: { command: "config", action: "update", path: "DefaultModelProviderId", value: "gpt-5.6" },
      }),
    };
    const output = await executeAgentSelfCommand(
      { command: "approval", action: "resolve", approvalId: "a-1", decision: "approve" },
      port() as AgentSelfServicePort,
      { approvals: withResolve },
    );
    expect(output.ok).toBe(true);
    expect(output.data).toMatchObject({ decision: "approved", path: "DefaultModelProviderId", revision: 8 });
    expect(replaceCalls).toHaveLength(1);
  });

  test("approval resolve fails deterministically for unknown approvals", async () => {
    const { port, replaceCalls } = createConfigPort(baseConfig());
    const { channel } = createApprovalChannel({ status: "denied", message: "n/a" });
    const withResolve: AgentSelfApprovalChannel = {
      ...channel,
      resolve: async () => ({ status: "unknown" }),
    };
    const output = await executeAgentSelfCommand(
      { command: "approval", action: "resolve", approvalId: "nope", decision: "approve" },
      port() as AgentSelfServicePort,
      { approvals: withResolve },
    );
    expect(output.ok).toBe(false);
    expect(output.error).toBe("approval_unknown");
    expect(replaceCalls).toHaveLength(0);
  });

  test("execution approval modes project to the tool channel disposition", () => {
    expect(resolveToolApprovalDisposition(AgentExecutionApprovalModes.FullAccess)).toEqual({ status: "approved" });
    expect(resolveToolApprovalDisposition(AgentExecutionApprovalModes.Agent)).toEqual({ status: "approved" });
    expect(resolveToolApprovalDisposition(AgentExecutionApprovalModes.AlwaysAsk)).toBeUndefined();
    expect(resolveToolApprovalDisposition(undefined)).toBeUndefined();
  });
});

describe("senera self-service config history and rollback", () => {
  function configWithTemperature(temperature: number): AgentSystemConfig {
    return {
      ...baseConfig(),
      ModelProviders: [
        {
          Id: "gpt-5.6",
          ProviderId: "main",
          Endpoint: "ChatCompletions" as const,
          Model: "gpt-5.6-2026",
          Temperature: temperature,
        },
      ],
    } as unknown as AgentSystemConfig;
  }

  test("history reports unavailable host state honestly", async () => {
    const { port } = createConfigPort(baseConfig());
    const output = await executeAgentSelfCommand(
      { command: "config", action: "history" },
      port() as AgentSelfServicePort,
    );
    expect(output.ok).toBe(true);
    expect(output.text).toContain("配置历史不可用");
    const data = output.data as { currentRevision: number; entries: unknown[] };
    expect(data.currentRevision).toBe(7);
    expect(data.entries).toHaveLength(0);
  });

  test("history lists retained revisions newest first in text", async () => {
    const { port } = createConfigPort(baseConfig(), [
      { revision: 3, config: baseConfig(), source: "seed", createdAt: "2026-09-01T00:00:00.000Z" },
      { revision: 4, config: baseConfig(), source: "api_update", createdAt: "2026-09-02T00:00:00.000Z" },
    ]);
    const output = await executeAgentSelfCommand(
      { command: "config", action: "history" },
      port() as AgentSelfServicePort,
    );
    expect(output.ok).toBe(true);
    expect(output.text.indexOf("revision 4")).toBeLessThan(output.text.indexOf("revision 3"));
    const data = output.data as { currentRevision: number; entries: { revision: number }[] };
    expect(data.currentRevision).toBe(4);
    expect(data.entries).toHaveLength(2);
  });

  test("rollback commits the target revision as a new revision when nothing sensitive changes", async () => {
    const { port, replaceCalls } = createConfigPort(configWithTemperature(0.8), [
      { revision: 3, config: configWithTemperature(0.4), source: "seed", createdAt: "2026-09-01T00:00:00.000Z" },
    ]);
    const output = await executeAgentSelfCommand(
      { command: "config", action: "rollback", revision: 3 },
      port() as AgentSelfServicePort,
    );
    expect(output.ok).toBe(true);
    expect(output.data).toMatchObject({ restoredFrom: 3, revision: 4 });
    expect(replaceCalls).toHaveLength(1);
    expect((replaceCalls[0]!.config as AgentSystemConfig).ModelProviders[0]).toMatchObject({ Temperature: 0.4 });
  });

  test("rollback touching a human-level path requires approval and defers on the CLI channel", async () => {
    const older = baseConfig({ DefaultModelProviderId: "legacy" });
    const { port, replaceCalls } = createConfigPort(baseConfig(), [
      { revision: 3, config: older, source: "seed", createdAt: "2026-09-01T00:00:00.000Z" },
    ]);
    const { channel } = createApprovalChannel({
      status: "deferred",
      approvalId: "rb-1",
      deadlineAt: "2026-09-09T00:00:00.000Z",
    });
    const output = await executeAgentSelfCommand(
      { command: "config", action: "rollback", revision: 3 },
      port() as AgentSelfServicePort,
      { approvals: channel },
    );
    expect(output.ok).toBe(false);
    expect(output.error).toBe("approval_required");
    expect(output.approvalRequired).toMatchObject({
      approvalId: "rb-1",
      command: { command: "config", action: "rollback", revision: 3 },
    });
    expect(replaceCalls).toHaveLength(0);
  });

  test("rollback approved through the channel commits the restored revision", async () => {
    const older = baseConfig({ DefaultModelProviderId: "legacy" });
    const { port, replaceCalls } = createConfigPort(baseConfig(), [
      { revision: 3, config: older, source: "seed", createdAt: "2026-09-01T00:00:00.000Z" },
    ]);
    const { channel, requests } = createApprovalChannel({ status: "approved" });
    const output = await executeAgentSelfCommand(
      { command: "config", action: "rollback", revision: 3 },
      port() as AgentSelfServicePort,
      { approvals: channel },
    );
    expect(output.ok).toBe(true);
    expect(replaceCalls).toHaveLength(1);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      path: "DefaultModelProviderId",
      value: "legacy",
      rule: { pattern: "DefaultModelProviderId", level: "human" },
    });
  });

  test("rollback is denied when the restored revision violates a guard rule", async () => {
    const { port, replaceCalls } = createConfigPort(configWithTemperature(0.5), [
      { revision: 3, config: configWithTemperature(9), source: "seed", createdAt: "2026-09-01T00:00:00.000Z" },
    ]);
    const output = await executeAgentSelfCommand(
      { command: "config", action: "rollback", revision: 3 },
      port() as AgentSelfServicePort,
    );
    expect(output.ok).toBe(false);
    expect(output.error).toBe("approval_denied");
    expect(output.text).toMatch(/安全范围/);
    expect(replaceCalls).toHaveLength(0);
  });

  test("rollback fails deterministically when history is unavailable", async () => {
    const { port, replaceCalls } = createConfigPort(baseConfig());
    const unavailable = port() as AgentSelfServicePort;
    unavailable.config.readRevision = () => ({ status: "unavailable" }) as const;
    const output = await executeAgentSelfCommand({ command: "config", action: "rollback", revision: 1 }, unavailable);
    expect(output.ok).toBe(false);
    expect(output.error).toBe("history_unavailable");
    expect(replaceCalls).toHaveLength(0);
  });

  test("rollback fails deterministically for pruned or nonexistent revisions", async () => {
    const { port, replaceCalls } = createConfigPort(baseConfig());
    const output = await executeAgentSelfCommand(
      { command: "config", action: "rollback", revision: 99 },
      port() as AgentSelfServicePort,
    );
    expect(output.ok).toBe(false);
    expect(output.error).toBe("revision_not_found");
    expect(replaceCalls).toHaveLength(0);
  });

  test("approval resolve replays a rollback command after approval", async () => {
    const older = baseConfig({ DefaultModelProviderId: "legacy" });
    const { port, replaceCalls } = createConfigPort(baseConfig(), [
      { revision: 3, config: older, source: "seed", createdAt: "2026-09-01T00:00:00.000Z" },
    ]);
    const { channel } = createApprovalChannel({ status: "denied", message: "n/a" });
    const withResolve: AgentSelfApprovalChannel = {
      ...channel,
      resolve: async () => ({
        status: "resolved",
        decision: "approve",
        command: { command: "config", action: "rollback", revision: 3 },
      }),
    };
    const output = await executeAgentSelfCommand(
      { command: "approval", action: "resolve", approvalId: "rb-1", decision: "approve" },
      port() as AgentSelfServicePort,
      { approvals: withResolve },
    );
    expect(output.ok).toBe(true);
    expect(output.data).toMatchObject({ decision: "approved", restoredFrom: 3 });
    expect(replaceCalls).toHaveLength(1);
    expect((replaceCalls[0]!.config as AgentSystemConfig).DefaultModelProviderId).toBe("legacy");
  });
});
