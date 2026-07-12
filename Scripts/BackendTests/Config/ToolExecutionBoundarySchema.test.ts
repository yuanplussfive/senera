import { describe, expect, test } from "vitest";
import { ToolSchema } from "../../../Source/AgentSystem/Schemas/PluginToolManifestSchema.js";

describe("tool execution boundary schema", () => {
  test.each([
    ["Local", "Deny"],
    ["Sandbox", "Deny"],
    ["SandboxPreferred", "Allow"],
  ] as const)("accepts %s with LocalFallback=%s", (boundary, localFallback) => {
    expect(ToolSchema.safeParse(tool(boundary, localFallback)).success).toBe(true);
  });

  test.each([
    ["Local", "Allow"],
    ["Sandbox", "Allow"],
    ["SandboxPreferred", "Deny"],
  ] as const)("rejects %s with LocalFallback=%s", (boundary, localFallback) => {
    const result = ToolSchema.safeParse(tool(boundary, localFallback));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({
          path: ["Execution", "LocalFallback"],
        }),
      );
    }
  });
});

function tool(Boundary: "Local" | "Sandbox" | "SandboxPreferred", LocalFallback: "Allow" | "Deny") {
  return {
    Name: "BoundaryTool",
    Handler: { Kind: "HostCapability", Capability: "test" },
    Execution: {
      Boundary,
      Network: "Deny",
      Workspace: "ReadOnly",
      LocalFallback,
    },
  };
}
