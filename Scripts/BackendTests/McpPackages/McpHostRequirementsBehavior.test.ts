import { describe, expect, test } from "vitest";
import { AgentMcpPackageDiscovery } from "../../../Source/AgentSystem/McpPackages/AgentMcpPackageDiscovery.js";
import type { SeneraExecutionEnv } from "../../../Source/AgentSystem/Execution/SeneraExecutionTypes.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";
import type { AgentMcpPackage } from "../../../Source/AgentSystem/McpPackages/AgentMcpPackageTypes.js";
import {
  AgentMcpHostCapabilityNames,
  AgentMcpHostRequirementsSchema,
  detectAgentMcpHostCapabilities,
  missingAgentMcpHostCapabilities,
} from "../../../Source/AgentSystem/McpPackages/AgentMcpHostRequirements.js";

describe("MCP host requirements", () => {
  test("detects Linux desktop access from the active display session", () => {
    expect(
      detectAgentMcpHostCapabilities({
        platform: "linux",
        environment: {},
      }).available.has(AgentMcpHostCapabilityNames.InteractiveDesktop),
    ).toBe(false);
    expect(
      detectAgentMcpHostCapabilities({
        platform: "linux",
        environment: { DISPLAY: ":0" },
      }).available.has(AgentMcpHostCapabilityNames.InteractiveDesktop),
    ).toBe(true);
    expect(
      detectAgentMcpHostCapabilities({
        platform: "linux",
        environment: { WAYLAND_DISPLAY: "wayland-0", XDG_RUNTIME_DIR: "/run/user/1000" },
      }).available.has(AgentMcpHostCapabilityNames.InteractiveDesktop),
    ).toBe(true);
  });

  test("allows an embedding host to provide an explicit capability result", () => {
    expect(
      detectAgentMcpHostCapabilities({ platform: "linux", environment: {}, interactiveDesktop: true }).available,
    ).toContain(AgentMcpHostCapabilityNames.InteractiveDesktop);
    expect(detectAgentMcpHostCapabilities({ platform: "win32", interactiveDesktop: false }).available).not.toContain(
      AgentMcpHostCapabilityNames.InteractiveDesktop,
    );
  });

  test("reports only requirements missing from the host snapshot", () => {
    const requirements = AgentMcpHostRequirementsSchema.parse({
      hostCapabilities: [AgentMcpHostCapabilityNames.InteractiveDesktop, "future-capability"],
    });
    const capabilities = detectAgentMcpHostCapabilities({ platform: "linux", environment: { DISPLAY: ":0" } });
    expect(missingAgentMcpHostCapabilities(requirements, capabilities)).toEqual(["future-capability"]);
  });

  test("rejects duplicate declared capabilities", () => {
    expect(() =>
      AgentMcpHostRequirementsSchema.parse({
        hostCapabilities: [
          AgentMcpHostCapabilityNames.InteractiveDesktop,
          AgentMcpHostCapabilityNames.InteractiveDesktop,
        ],
      }),
    ).toThrow(/must be unique/u);
  });

  test("skips an unavailable package before starting its MCP process", async () => {
    const package_ = {
      rootPath: "/tmp/desktop-mcp",
      configurationPath: "/tmp/desktop-mcp/manifest.json",
      revision: "revision",
      name: "desktop-mcp",
      source: "bundled",
      descriptorKind: "mcpb",
      execution: { targets: ["local"], preferred: "local" },
      requirements: { hostCapabilities: [AgentMcpHostCapabilityNames.InteractiveDesktop] },
      servers: [
        {
          name: "desktop-mcp",
          inputs: [],
          configuration: {
            type: "stdio",
            command: { segments: [{ kind: "literal", value: "never-start" }] },
            args: [],
            cwd: { segments: [{ kind: "literal", value: "." }] },
          },
        },
      ],
    } satisfies AgentMcpPackage;
    const result = await new AgentMcpPackageDiscovery({} as AgentSystemConfig, {} as SeneraExecutionEnv, {
      hostCapabilities: detectAgentMcpHostCapabilities({ platform: "linux", environment: {} }),
    }).discover([package_]);

    expect(result.servers).toEqual([]);
    expect(result.failures).toEqual([]);
    expect(result.unavailableServers).toEqual([
      {
        packageName: "desktop-mcp",
        serverName: "desktop-mcp",
        reason: "missing_host_capability",
        missingCapabilities: [AgentMcpHostCapabilityNames.InteractiveDesktop],
      },
    ]);
  });
});
