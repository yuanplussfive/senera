import { describe, expect, test } from "vitest";
import {
  AgentConfigMigrationError,
  migrateAgentConfigPayload,
} from "../../../Source/AgentSystem/Config/AgentConfigMigration.js";
import { CurrentAgentConfigVersion } from "../../../Source/AgentSystem/Config/AgentConfigVersion.js";

describe("sandbox provisioning config migration", () => {
  test("moves v4 OCI image declarations into the v5 provisioning contract", () => {
    expect(
      migrateAgentConfigPayload({
        ConfigVersion: 4,
        SandboxRuntime: { Images: ["registry.example/node@sha256:digest"] },
        Defaults: { SandboxRuntime: { Images: [] } },
      }),
    ).toEqual({
      sourceVersion: 4,
      targetVersion: CurrentAgentConfigVersion,
      migratedPaths: ["SandboxRuntime.Provisioning", "ConfigVersion"],
      removedPaths: ["SandboxRuntime.Images", "Defaults.SandboxRuntime.Images"],
      config: {
        ConfigVersion: CurrentAgentConfigVersion,
        SandboxRuntime: {
          Provisioning: {
            Kind: "Oci",
            Images: ["registry.example/node@sha256:digest"],
          },
        },
        Defaults: { SandboxRuntime: {} },
      },
    });
  });

  test("rejects an ambiguous legacy and current provisioning declaration", () => {
    expect(() =>
      migrateAgentConfigPayload({
        ConfigVersion: 4,
        SandboxRuntime: {
          Images: ["legacy"],
          Provisioning: { Kind: "ReleaseBundle" },
        },
      }),
    ).toThrow(AgentConfigMigrationError);
  });
});
