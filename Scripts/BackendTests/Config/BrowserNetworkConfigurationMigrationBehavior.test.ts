import { describe, expect, test } from "vitest";
import { migrateAgentConfigPayload } from "../../../Source/AgentSystem/Config/AgentConfigMigration.js";
import { CurrentAgentConfigVersion } from "../../../Source/AgentSystem/Config/AgentConfigVersion.js";

describe("browser network configuration migration", () => {
  test("removes legacy network switches without widening a public-access configuration", () => {
    const migrated = migrateAgentConfigPayload({
      ConfigVersion: 30,
      ModelProviders: [],
      Extensions: {
        "agent-browser": {
          Configuration: {
            network: {
              accessMode: "public",
              allowedDomains: ["example.com"],
              allowPrivateNetworks: false,
              allowSyntheticProxyAddresses: true,
            },
          },
        },
      },
    });

    expect(migrated?.targetVersion).toBe(CurrentAgentConfigVersion);
    expect(migrated?.config).toMatchObject({
      Extensions: { "agent-browser": { Configuration: { network: {} } } },
    });
    expect(migrated?.removedPaths).toContain("Extensions.agent-browser.Configuration.network.accessMode");
    expect(migrated?.removedPaths).toContain("Extensions.agent-browser.Configuration.network.allowPrivateNetworks");
  });

  test("tightens a legacy allowlist to an explicit block-all entry instead of widening access", () => {
    const migrated = migrateAgentConfigPayload({
      ConfigVersion: 30,
      ModelProviders: [],
      Extensions: {
        "agent-browser": {
          Configuration: {
            network: {
              accessMode: "allowlist",
              allowedDomains: ["example.com"],
              allowPrivateNetworks: false,
            },
          },
        },
      },
    });

    expect(migrated?.config).toMatchObject({
      Extensions: { "agent-browser": { Configuration: { network: { blockedDomains: ["*"] } } } },
    });
    expect(migrated?.migratedPaths).toContain("Extensions.agent-browser.Configuration.network.blockedDomains");
  });
});
