import { describe, expect, test } from "vitest";
import {
  assertAgentExplicitActivationsCurrent,
  createAgentActivationCatalog,
} from "../../../Source/AgentSystem/Activation/AgentActivationCatalog.js";
import type { AgentPluginListEntry } from "../../../Source/AgentSystem/Plugins/AgentPluginTypes.js";
import type { AgentSkillCatalogItem } from "../../../Source/AgentSystem/Skills/AgentSkillCatalogProjector.js";
import type { AgentMcpActivationCatalogEntry } from "../../../Source/AgentSystem/McpPackages/AgentMcpPackageTypes.js";

describe("@ activation catalog", () => {
  test("projects live Skills and Plugins without exposing plugin Skills twice", () => {
    const catalog = createAgentActivationCatalog(
      [skill("workspace-search", "skill-r1"), pluginSkill("weather")],
      [plugin("weather")],
      [],
      [],
    );

    expect(catalog.entries.map((entry) => `${entry.kind}:${entry.id}`)).toEqual([
      "plugin:weather",
      "skill:workspace-search",
    ]);
  });

  test("rejects stale, disabled, and revision-mismatched selections", () => {
    const catalog = createAgentActivationCatalog(
      [skill("workspace-search", "skill-r1")],
      [plugin("weather")],
      [],
      [],
    );
    const valid = {
      catalogRevision: catalog.revision,
      explicit: [{ kind: "skill" as const, id: "workspace-search", revision: "skill-r1" }],
    };
    expect(() => assertAgentExplicitActivationsCurrent(valid, catalog)).not.toThrow();
    expect(() => assertAgentExplicitActivationsCurrent({ ...valid, catalogRevision: "stale" }, catalog)).toThrow(
      /catalog changed/u,
    );
    expect(() =>
      assertAgentExplicitActivationsCurrent(
        { ...valid, explicit: [{ ...valid.explicit[0], revision: "skill-r0" }] },
        catalog,
      ),
    ).toThrow(/revision changed/u);

    const disabledCatalog = createAgentActivationCatalog(
      [skill("workspace-search", "skill-r1")],
      [plugin("weather", false)],
      [],
      [],
    );
    expect(() =>
      assertAgentExplicitActivationsCurrent(
        {
          catalogRevision: disabledCatalog.revision,
          explicit: [{ kind: "plugin", id: "weather", revision: "plugin-r1" }],
        },
        disabledCatalog,
      ),
    ).toThrow(/not enabled/u);
  });

  test("keeps MCP servers distinct from Skills and Plugins", () => {
    const mcp: AgentMcpActivationCatalogEntry = {
      id: "weather",
      revision: "mcp-r1",
      title: "Weather",
      description: "Weather data.",
      enabled: true,
      selectable: true,
      source: "bundled:weather",
    };
    const catalog = createAgentActivationCatalog(
      [skill("weather", "skill-r1")],
      [plugin("weather")],
      [mcp],
      [],
    );

    expect(catalog.entries.map((entry) => `${entry.kind}:${entry.id}`)).toEqual([
      "mcp:weather",
      "plugin:weather",
      "skill:weather",
    ]);
  });

  test("rejects duplicate entries within one activation kind", () => {
    expect(() =>
      createAgentActivationCatalog(
        [skill("workspace-search", "skill-r1")],
        [plugin("workspace-search")],
        [],
        [
          {
            id: "workspace-search",
            revision: "system-r1",
            title: "Workspace search",
            description: "Duplicate system entry.",
            enabled: true,
            selectable: true,
          },
          {
            id: "workspace-search",
            revision: "system-r2",
            title: "Workspace search v2",
            description: "Duplicate system entry.",
            enabled: true,
            selectable: true,
          },
        ],
      ),
    ).toThrow(/duplicate entry: system:workspace-search/u);
  });

  test("requires a catalog revision for structured activations", () => {
    const catalog = createAgentActivationCatalog([], [], [], []);
    expect(() =>
      assertAgentExplicitActivationsCurrent(
        { catalogRevision: " ", explicit: [] },
        catalog,
      ),
    ).toThrow(/catalog revision/u);
  });
});

function skill(name: string, revision: string): AgentSkillCatalogItem {
  return {
    name,
    revision,
    source: { kind: "system", id: name, displayName: "Senera" },
    title: name,
    summary: `Use ${name}.`,
    capabilities: [],
    tags: [],
    useCases: [],
    examples: [],
    avoid: [],
    recommendedTools: [],
  };
}

function pluginSkill(id: string): AgentSkillCatalogItem {
  return {
    ...skill(`${id}-skill`, "plugin-r1"),
    source: { kind: "standalone", id: `plugin:${id}`, displayName: id },
  };
}

function plugin(id: string, enabled = true): AgentPluginListEntry {
  return {
    id,
    name: id,
    version: "plugin-r1",
    revision: "plugin-r1",
    kind: "general",
    source: "bundled",
    builtin: true,
    enabled,
    loaded: enabled,
    capabilityCount: enabled ? 1 : 0,
    directory: `System/Plugins/${id}`,
    requires: [],
  };
}
