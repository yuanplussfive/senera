import { describe, expect, test } from "vitest";
import { migrateAgentConfigPayload } from "../../../Source/AgentSystem/Config/AgentConfigMigration.js";
import { CurrentAgentConfigVersion } from "../../../Source/AgentSystem/Config/AgentConfigVersion.js";

describe("OneBot identity configuration retirement", () => {
  test("retires legacy contact and transport settings without changing the source payload", () => {
    const extension = {
      Enabled: true,
      Configuration: { onebot11: { enabled: true, port: 5761, displayName: "Old contact" } },
    };
    const source = {
      ConfigVersion: 39,
      Extensions: { "agent-channels": extension },
      Defaults: { Extensions: { "agent-channels": structuredClone(extension) } },
    };
    const migration = migrateAgentConfigPayload(source)!;
    expect(migration.targetVersion).toBe(CurrentAgentConfigVersion);
    expect(migration.removedPaths).toEqual([
      "Extensions.agent-channels.Configuration.onebot11.displayName",
      "Defaults.Extensions.agent-channels.Configuration.onebot11.displayName",
      "Extensions.agent-channels.Configuration.onebot11.port",
      "Defaults.Extensions.agent-channels.Configuration.onebot11.port",
    ]);
    const migratedExtension = { Enabled: true, Configuration: { onebot11: { enabled: true } } };
    expect(migration.config).toEqual({
      ConfigVersion: CurrentAgentConfigVersion,
      Extensions: { "agent-channels": migratedExtension },
      Defaults: { Extensions: { "agent-channels": migratedExtension } },
    });
    expect(source.Extensions["agent-channels"].Configuration.onebot11.displayName).toBe("Old contact");
    expect(migrateAgentConfigPayload(migration.config)).toBeUndefined();
  });

  test("removes retired controls from workspace configuration and defaults while preserving other channels", () => {
    const configuration = {
      onebot11: {
        enabled: true,
        port: 5700,
        accessToken: "retired",
        selfId: 123,
        operatorId: 456,
        heartbeatIntervalMs: 15000,
      },
      qq: { appId: "app", appSecret: "official-credential" },
    };
    const extension = { Enabled: true, Configuration: configuration };
    const source = {
      ConfigVersion: 41,
      Extensions: { "agent-channels": extension },
      Defaults: { Extensions: { "agent-channels": structuredClone(extension) } },
    };
    const result = migrateAgentConfigPayload(source)!;
    expect(result.removedPaths).toHaveLength(10);
    const current = { Enabled: true, Configuration: { onebot11: { enabled: true }, qq: configuration.qq } };
    expect(result.config).toEqual({
      ConfigVersion: CurrentAgentConfigVersion,
      Extensions: { "agent-channels": current },
      Defaults: { Extensions: { "agent-channels": current } },
    });
    expect(source.Extensions["agent-channels"].Configuration.onebot11.accessToken).toBe("retired");
    expect(migrateAgentConfigPayload(result.config)).toBeUndefined();
  });
});
