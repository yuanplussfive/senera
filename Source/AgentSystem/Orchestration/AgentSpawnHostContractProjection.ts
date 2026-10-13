import { deepFreeze } from "../Core/AgentDeepFreeze.js";
import { readAgentUnknownRecord } from "../Core/AgentUnknownValue.js";
import type { AgentHostToolContractProjection } from "../ToolRuntime/AgentToolHostCapabilityRegistry.js";
import type { AgentSubagentRoleCatalogSnapshot } from "./AgentSubagentRoleCatalog.js";

const RoleCatalogRevisionKeyword = "x-senera-agent-role-catalog-revision";

export class AgentSpawnHostContractProjection {
  private invocationSchemaCache = new WeakMap<object, { revision: string; schema: Record<string, unknown> }>();

  constructor(
    private readonly snapshot: () => AgentSubagentRoleCatalogSnapshot,
    private readonly resourceCapabilityIds: () => readonly string[],
  ) {}

  createProjection(): AgentHostToolContractProjection {
    return {
      projectInvocationSchema: (_tool, schema) => this.projectInvocationSchema(schema),
      projectDescription: (_tool, description) => this.projectDescription(description),
    };
  }

  private projectInvocationSchema(schema: Readonly<Record<string, unknown>>): Record<string, unknown> {
    const snapshot = this.snapshot();
    const resourceCapabilityIds = [...this.resourceCapabilityIds()].sort();
    const revision = `${snapshot.revision}:${JSON.stringify(resourceCapabilityIds)}`;
    const cached = this.invocationSchemaCache.get(schema);
    if (cached?.revision === revision) return cached.schema;
    const properties = requireSchemaRecord(schema.properties, "AgentSpawn input schema properties");
    const agent = requireSchemaRecord(properties.agent, "AgentSpawn agent property schema");
    const { resources: _resources, ...propertiesWithoutResources } = properties;
    const resources = requireSchemaRecord(_resources, "AgentSpawn resource schema");
    const resourceItems = requireSchemaRecord(resources.items, "AgentSpawn resource item schema");
    const resourceProperties = requireSchemaRecord(resourceItems.properties, "AgentSpawn resource item properties");
    const capability = requireSchemaRecord(resourceProperties.capability, "AgentSpawn resource capability schema");
    const projectedResources =
      resourceCapabilityIds.length > 0
        ? {
            ...resources,
            items: {
              ...resourceItems,
              properties: {
                ...resourceProperties,
                capability: {
                  ...capability,
                  enum: resourceCapabilityIds,
                  description: [
                    typeof capability.description === "string" ? capability.description : undefined,
                    "Use a registered resource capability ID, not a tool permission or authorization scope.",
                  ]
                    .filter((section): section is string => Boolean(section))
                    .join(" "),
                },
              },
            },
          }
        : undefined;
    const projected = deepFreeze({
      ...schema,
      [RoleCatalogRevisionKeyword]: revision,
      properties: {
        ...propertiesWithoutResources,
        agent: {
          ...agent,
          enum: snapshot.roles.map((role) => role.id),
          default: snapshot.defaultRoleId,
          description: [
            typeof agent.description === "string" ? agent.description : undefined,
            `The host-declared default role is '${snapshot.defaultRoleId}'.`,
          ]
            .filter((section): section is string => Boolean(section))
            .join(" "),
        },
        ...(projectedResources ? { resources: projectedResources } : {}),
      },
    });
    this.invocationSchemaCache.set(schema, { revision, schema: projected });
    return projected;
  }

  private projectDescription(description: string): string {
    const snapshot = this.snapshot();
    const roles = snapshot.roles
      .map(
        (role) =>
          `- ${role.id}${role.id === snapshot.defaultRoleId ? " (default)" : ""} [${role.workspaceAccess}]: ${role.description}`,
      )
      .join("\n");
    return [description, roles ? `Available host-managed roles:\n${roles}` : undefined]
      .filter((section): section is string => Boolean(section))
      .join("\n\n");
  }
}

function requireSchemaRecord(value: unknown, label: string): Record<string, unknown> {
  const record = readAgentUnknownRecord(value);
  if (!record) throw new TypeError(`${label} must be an object.`);
  return record;
}
