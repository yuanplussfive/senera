import { describe, expect, test } from "vitest";
import { migrateAgentConfigPayload } from "../../../Source/AgentSystem/Config/AgentConfigMigration.js";
import { CurrentAgentConfigVersion } from "../../../Source/AgentSystem/Config/AgentConfigVersion.js";

describe("response rewrite retirement", () => {
  test("removes switches and the retired extension from root and defaults without mutating the input", () => {
    const settings = {
      Prompt: { PrefaceRewrite: true, FinalResponseRewrite: true, BamlToolAttribution: true },
      Extensions: {
        "resident-speech": { Enabled: true },
        "agent-channels": { Configuration: { enabled: true, finalResponseRewrite: true, qq: { enabled: true } } },
      },
    };
    const source = { ConfigVersion: 40, ...settings, Defaults: structuredClone(settings) };
    const expected = {
      Prompt: { BamlToolAttribution: true },
      Extensions: { "agent-channels": { Configuration: { enabled: true, qq: { enabled: true } } } },
    };
    const migration = migrateAgentConfigPayload(source)!;
    expect(migration.config).toEqual({ ConfigVersion: CurrentAgentConfigVersion, ...expected, Defaults: expected });
    expect(migration.removedPaths).toHaveLength(8);
    expect(source.Prompt.PrefaceRewrite).toBe(true);
    expect(migrateAgentConfigPayload(migration.config)).toBeUndefined();
  });
});
