import { deepFreeze } from "../Core/AgentDeepFreeze.js";
import { readAgentUnknownRecord } from "../Core/AgentUnknownValue.js";
import type { AgentExtensionRegistry } from "../Extensions/AgentExtensionRegistry.js";
import type { AgentHostToolContractProjection } from "../ToolRuntime/AgentToolHostCapabilityRegistry.js";

export class AgentToolSearchContractProjector {
  private invocationSchemaCache = new WeakMap<object, { catalogIdentity: string; schema: Record<string, unknown> }>();

  constructor(private readonly registry: Pick<AgentExtensionRegistry, "listDiscoverySources">) {}

  createProjection(): AgentHostToolContractProjection {
    return {
      projectInvocationSchema: (_tool, schema) => this.projectInvocationSchema(schema),
      projectDescription: (_tool, description) => this.projectDescription(description),
    };
  }

  refresh(): void {
    this.invocationSchemaCache = new WeakMap();
  }

  private projectInvocationSchema(schema: Readonly<Record<string, unknown>>): Record<string, unknown> {
    const catalog = this.registry.listDiscoverySources();
    const catalogIdentity = JSON.stringify(catalog);
    const cached = this.invocationSchemaCache.get(schema);
    if (cached?.catalogIdentity === catalogIdentity) return cached.schema;

    const properties = requireSchemaRecord(schema.properties, "ToolSearchTool input schema properties");
    const preferredSources = requireSchemaRecord(
      properties.preferredSources,
      "ToolSearchTool preferredSources property schema",
    );
    const items = requireSchemaRecord(preferredSources.items, "ToolSearchTool preferredSources item schema");
    const projected = deepFreeze({
      ...schema,
      properties: {
        ...properties,
        preferredSources: {
          ...preferredSources,
          description: "优先检索的能力来源；这是排序偏好，不会排除其他来源。省略时在全部来源中搜索。",
          uniqueItems: true,
          items: {
            ...items,
            enum: catalog.map((source) => source.id),
          },
        },
      },
    });
    this.invocationSchemaCache.set(schema, { catalogIdentity, schema: projected });
    return projected;
  }

  private projectDescription(description: string): string {
    const sources = this.registry.listDiscoverySources();
    if (sources.length === 0) return description;
    const sourceCatalog = sources.map((source) => `- ${source.id}: ${source.title} — ${source.description}`).join("\n");
    return `${description}\n\n可选能力来源（preferredSources 仅影响排序）：\n${sourceCatalog}`;
  }
}

function requireSchemaRecord(value: unknown, label: string): Record<string, unknown> {
  const record = readAgentUnknownRecord(value);
  if (!record) throw new TypeError(`${label} must be an object.`);
  return record;
}
