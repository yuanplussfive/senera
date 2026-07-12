import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AgentPluginRegistry } from "../../../Source/AgentSystem/Plugin/AgentPluginRegistry.js";
import { AgentSeneraOpaPolicyClient } from "../../../Source/AgentSystem/Safety/AgentSeneraOpaPolicyClient.js";
import { createAgentOpaWasmPolicyClient } from "../../../Source/AgentSystem/Safety/AgentOpaWasmPolicyClient.js";
import {
  AgentToolApprovalPolicyArtifactContract,
  readAgentToolApprovalPolicyArtifact,
  resolveAgentToolApprovalPolicyArtifactDirectory,
} from "../../../Source/AgentSystem/Safety/AgentToolApprovalPolicyArtifact.js";

const policyDirectory = resolveAgentToolApprovalPolicyArtifactDirectory(path.join(process.cwd(), "Source"));

describe("OPA tool approval policy", () => {
  it.each(policyCases())("applies $name with deterministic precedence", async ({ input, expected }) => {
    const artifact = readAgentToolApprovalPolicyArtifact(policyDirectory);
    const client = await createAgentOpaWasmPolicyClient({
      wasm: artifact.wasm,
      data: {
        senera: {
          tool_approval: artifact.data,
        },
      },
    });

    await expect(
      client.evaluate(AgentToolApprovalPolicyArtifactContract.entrypoints.toolDecision, input),
    ).resolves.toMatchObject(expected);
  });

  it.each(fallbackPolicyCases())("applies fallback rule: $name", async ({ input, expected }) => {
    const artifact = readAgentToolApprovalPolicyArtifact(policyDirectory);
    const client = await createAgentOpaWasmPolicyClient({
      wasm: artifact.wasm,
      data: {
        senera: {
          tool_approval: artifact.data,
        },
      },
    });

    await expect(
      client.evaluate(AgentToolApprovalPolicyArtifactContract.entrypoints.executionFallback, input),
    ).resolves.toMatchObject(expected);
  });

  it("fails closed when the verified WASM artifact cannot be loaded", async () => {
    const client = new AgentSeneraOpaPolicyClient({
      registry: new AgentPluginRegistry(),
      artifactLoader: async () => {
        throw new Error("corrupt policy artifact");
      },
    });

    await expect(
      client.evaluate(AgentToolApprovalPolicyArtifactContract.entrypoints.toolDecision, {
        tool: {
          name: "UnknownTool",
          approval: { Mode: "allow" },
        },
      }),
    ).resolves.toMatchObject({
      decision: "requires-approval",
      rule: "policy.artifact.unavailable",
    });

    await expect(
      client.evaluate(AgentToolApprovalPolicyArtifactContract.entrypoints.toolDecision, {
        tool: {
          name: "UnknownTool",
          approval: { Mode: "deny", Reason: "Explicitly blocked." },
        },
      }),
    ).resolves.toMatchObject({
      decision: "deny",
      reason: "Explicitly blocked.",
      rule: "tool.manifest.deny",
    });

    await expect(client.evaluate("senera/tool/unknown", { tool: { name: "UnknownTool" } })).resolves.toMatchObject({
      decision: "deny",
      rule: "policy.entrypoint.mismatch",
    });

    await expect(
      client.evaluate(AgentToolApprovalPolicyArtifactContract.entrypoints.executionFallback, {
        tool: { name: "UnknownTool" },
      }),
    ).resolves.toMatchObject({
      decision: "deny",
      rule: "execution.fallback.policy_unavailable",
    });
  });

  it("rejects a runtime policy artifact whose content no longer matches its manifest", () => {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "senera-opa-artifact-"));
    try {
      const files = [
        ...AgentToolApprovalPolicyArtifactContract.files.policies,
        AgentToolApprovalPolicyArtifactContract.files.data,
        AgentToolApprovalPolicyArtifactContract.files.wasm,
        AgentToolApprovalPolicyArtifactContract.files.manifest,
      ];
      for (const file of files) {
        fs.copyFileSync(path.join(policyDirectory, file), path.join(temporaryDirectory, file));
      }
      fs.appendFileSync(
        path.join(temporaryDirectory, AgentToolApprovalPolicyArtifactContract.files.wasm),
        Buffer.from([0]),
      );

      expect(() => readAgentToolApprovalPolicyArtifact(temporaryDirectory)).toThrow(/wasm hash mismatch/u);
    } finally {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });
});

function policyCases() {
  const base = {
    tool: {
      name: "PolicyTool",
      registered: true,
      permissions: [] as string[],
      capabilities: {
        risks: [] as Array<{ Permission?: string; SideEffect?: string }>,
        effects: [] as string[],
      },
      security: {
        RequiresApproval: false,
        TrustLevel: "System",
      },
    },
  };
  const withTool = (tool: Record<string, unknown>) => ({
    tool: {
      ...base.tool,
      ...tool,
    },
  });

  return [
    {
      name: "manifest deny before every approval rule",
      input: withTool({
        approval: { Mode: "deny" },
        permissions: ["filesystem:write:workspace"],
      }),
      expected: { decision: "deny", rule: "tool.manifest.deny" },
    },
    {
      name: "missing tool before a caller supplied allow",
      input: withTool({ registered: false, approval: { Mode: "allow" } }),
      expected: { decision: "requires-approval", rule: "tool.registry.missing" },
    },
    {
      name: "plugin approval requirement before manifest allow",
      input: withTool({
        approval: { Mode: "allow" },
        security: { RequiresApproval: true, TrustLevel: "System" },
      }),
      expected: { decision: "requires-approval", rule: "plugin.security.requires_approval" },
    },
    {
      name: "untrusted plugin before manifest allow",
      input: withTool({
        approval: { Mode: "allow" },
        security: { RequiresApproval: false, TrustLevel: "Untrusted" },
      }),
      expected: { decision: "requires-approval", rule: "plugin.security.untrusted" },
    },
    {
      name: "high impact risk permission before manifest allow",
      input: withTool({
        approval: { Mode: "allow" },
        capabilities: { risks: [{ Permission: "write" }], effects: [] },
      }),
      expected: { decision: "requires-approval", rule: "risk.permission.high_impact" },
    },
    {
      name: "high impact side effect",
      input: withTool({
        capabilities: { risks: [], effects: ["process"] },
      }),
      expected: {
        decision: "requires-approval",
        rule: "risk.side_effect.persistent_or_process",
      },
    },
    {
      name: "high impact permission term",
      input: withTool({ permissions: ["filesystem:write:workspace"] }),
      expected: { decision: "requires-approval", rule: "tool.permission.high_impact" },
    },
    {
      name: "manifest ask with its specific reason before generic risk rules",
      input: withTool({
        approval: { Mode: "ask", Reason: "Confirm this write." },
        permissions: ["filesystem:write:workspace"],
      }),
      expected: { decision: "requires-approval", rule: "tool.manifest.ask" },
    },
    {
      name: "manifest allow after safety checks",
      input: withTool({ approval: { Mode: "allow" } }),
      expected: { decision: "allow", rule: "tool.manifest.allow" },
    },
    {
      name: "registered low risk default",
      input: base,
      expected: { decision: "allow", rule: "risk.default.allow" },
    },
  ];
}

function fallbackPolicyCases() {
  const fallbackInput = ({
    boundary = "SandboxPreferred",
    localFallback = "Allow",
    registered = true,
    rootKind = "System",
    trustLevel = "External",
  }: {
    boundary?: string;
    localFallback?: string;
    registered?: boolean;
    rootKind?: string;
    trustLevel?: string;
  }) => ({
    tool: {
      name: "FallbackTool",
      registered,
      plugin: { rootKind, trustLevel },
    },
    execution: {
      boundary,
      localFallback,
      network: "Allow",
      workspace: "ReadOnly",
      from: "microsandbox",
      to: "node",
    },
  });

  return [
    {
      name: "strict sandbox always denies",
      input: fallbackInput({ boundary: "Sandbox", trustLevel: "System" }),
      expected: { decision: "deny", rule: "execution.fallback.strict_sandbox" },
    },
    {
      name: "missing registry identity denies",
      input: fallbackInput({ registered: false }),
      expected: { decision: "deny", rule: "execution.fallback.identity_unverified" },
    },
    {
      name: "untrusted plugin denies",
      input: fallbackInput({ trustLevel: "Untrusted" }),
      expected: { decision: "deny", rule: "execution.fallback.untrusted" },
    },
    {
      name: "external plugin requires approval",
      input: fallbackInput({ trustLevel: "External" }),
      expected: { decision: "requires-approval", rule: "execution.fallback.external_approval" },
    },
    {
      name: "user-root plugin requires approval regardless of system trust declaration",
      input: fallbackInput({ rootKind: "User", trustLevel: "System" }),
      expected: { decision: "requires-approval", rule: "execution.fallback.external_approval" },
    },
    {
      name: "registered system plugin can use policy-approved fallback",
      input: fallbackInput({ trustLevel: "System" }),
      expected: { decision: "allow", rule: "execution.fallback.system_allow" },
    },
  ];
}
