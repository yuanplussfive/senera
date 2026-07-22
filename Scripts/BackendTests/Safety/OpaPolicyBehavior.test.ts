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

  it.each(resourcePolicyCases())("applies resource rule: $name", async ({ input, expected }) => {
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
      client.evaluate(AgentToolApprovalPolicyArtifactContract.entrypoints.resourceAccess, input),
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
      client.evaluate(AgentToolApprovalPolicyArtifactContract.entrypoints.resourceAccess, {
        resource: safeResource(),
      }),
    ).resolves.toMatchObject({
      decision: "deny",
      rule: "resource.policy_unavailable",
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
      name: "a selected local target requires approval when sandbox is also available",
      input: {
        ...withTool({ approval: { Mode: "allow" } }),
        execution: { target: "Local", availableTargets: ["Sandbox", "Local"] },
      },
      expected: { decision: "requires-approval", rule: "execution.target.local" },
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

function resourcePolicyCases() {
  const withResource = (resource: Record<string, unknown>) => ({
    resource: {
      ...safeResource(),
      ...resource,
    },
  });

  return [
    {
      name: "safe workspace read",
      input: withResource({}),
      expected: { decision: "allow", rule: "resource.allowed" },
    },
    {
      name: "outside canonical target",
      input: withResource({ containment: "outside" }),
      expected: { decision: "deny", rule: "resource.containment.denied" },
    },
    {
      name: "external directory link",
      input: withResource({ linkTraversal: "external" }),
      expected: { decision: "deny", rule: "resource.link_escape" },
    },
    {
      name: "protected workspace mutation",
      input: withResource({ intent: "replace", relativePath: ".git/config" }),
      expected: { decision: "deny", rule: "resource.protected.mutation" },
    },
    {
      name: "final link mutation",
      input: withResource({ intent: "remove", finalEntry: "link" }),
      expected: { decision: "deny", rule: "resource.final_link.mutation" },
    },
  ];
}

function safeResource() {
  return {
    scope: "workspace",
    intent: "read",
    relativePath: "notes/readme.txt",
    containment: "inside",
    linkTraversal: "none",
    finalEntry: "file",
  };
}
