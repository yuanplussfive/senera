import { describe, expect, test } from "vitest";
import { validateAgentToolResourceManifests } from "../../../Source/AgentSystem/ToolRuntime/AgentToolResourceManifestValidation.js";

describe("tool resource manifest validation", () => {
  test("accepts complete static and selector-based workspace intent declarations", () => {
    expect(() =>
      validateAgentToolResourceManifests([
        {
          Capability: "senera.workspace.path",
          Pointer: "/operations",
          Parameters: {
            Intent: "replace",
            PathPointers: ["/*/path"],
          },
        },
        {
          Capability: "senera.workspace.path",
          Pointer: "/request/path",
          Parameters: {
            Intent: {
              Selector: "/dryRun",
              Cases: [{ Equals: true, Intent: "read" }],
              Default: "replace",
            },
          },
        },
      ]),
    ).not.toThrow();
  });

  test("rejects incomplete selectors before a tool can be registered", () => {
    expect(() =>
      validateAgentToolResourceManifests([
        {
          Capability: "senera.workspace.path",
          Pointer: "/operations",
          Parameters: { Intent: { Default: "replace" } },
        },
      ]),
    ).toThrow(/Invalid tool resource declaration at resources\[0\]/u);
  });

  test("rejects unowned capability declarations instead of leaving runtime-only failure paths", () => {
    expect(() =>
      validateAgentToolResourceManifests([
        {
          Capability: "senera.unknown.resource",
          Pointer: "/value",
        },
      ]),
    ).toThrow(/no manifest validator/u);
  });
});
