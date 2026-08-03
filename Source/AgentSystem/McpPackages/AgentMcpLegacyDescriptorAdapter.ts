import { AgentExtensionInputDefinitionSchema } from "../Extensions/AgentExtensionInput.js";
import type { AgentExtensionValueExpression } from "../Extensions/AgentExtensionValueExpression.js";
import {
  listAgentMcpEnvironmentReferences,
  parseAgentMcpEnvironmentTemplate,
  type AgentMcpEnvironmentReference,
} from "./AgentMcpEnvironmentTemplate.js";
import type { AgentMcpDescriptorAdapter } from "./AgentMcpDescriptorAdapter.js";
import type { AgentMcpInputDefinition } from "./AgentMcpInputDefinition.js";
import {
  AgentMcpConfigurationDocumentSchema,
  type AgentMcpLegacyServerConfiguration,
} from "./AgentMcpPackageSchema.js";

export const AgentMcpLegacyDescriptorAdapter: AgentMcpDescriptorAdapter = {
  kind: "legacy",
  fileName: ".mcp.json",
  recognizes: () => true,
  project(context, document) {
    const configuration = AgentMcpConfigurationDocumentSchema.parse(document);
    return {
      name: context.directoryName,
      descriptorKind: "legacy",
      execution: configuration.execution,
      servers: Object.entries(configuration.mcpServers).map(([name, server]) => {
        const inputDefinitions = legacyInputDefinitions(server);
        return {
          name,
          inputs: inputDefinitions,
          configuration:
            server.type === "http"
              ? {
                  type: "http",
                  url: literal(server.url),
                  headers: projectRecord(server.headers),
                }
              : {
                  type: "stdio",
                  command: literal(server.command),
                  args: server.args.map(literal),
                  cwd: literal(server.cwd),
                  env: projectRecord(server.env),
                },
        };
      }),
    };
  },
};

function legacyInputDefinitions(server: AgentMcpLegacyServerConfiguration): AgentMcpInputDefinition[] {
  const records = server.type === "http" ? [server.headers] : [server.env];
  const references = records.flatMap((record) => listAgentMcpEnvironmentReferences(record));
  const grouped = new Map<string, AgentMcpEnvironmentReference[]>();
  for (const reference of references) {
    const values = grouped.get(reference.name) ?? [];
    values.push(reference);
    grouped.set(reference.name, values);
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, values]) => {
      const defaults = [...new Set(values.flatMap((value) => value.defaultValue ?? []))];
      const required = values.some((value) => value.defaultValue === undefined);
      if (!required && defaults.length > 1) {
        throw new Error(`Legacy MCP input ${id} declares conflicting default values.`);
      }
      const definition = AgentExtensionInputDefinitionSchema.parse({
        id,
        title: id,
        type: "string",
        required,
        secret: required,
        ...(defaults[0] === undefined ? {} : { defaultValue: defaults[0] }),
      });
      return {
        ...definition,
        binding: { source: "legacyEnvironment", name: id, inputId: id },
        provenance: "legacy",
      };
    });
}

function projectRecord(
  record: Readonly<Record<string, string>> | undefined,
): Record<string, AgentExtensionValueExpression> | undefined {
  return record
    ? Object.fromEntries(Object.entries(record).map(([name, value]) => [name, projectLegacyExpression(value)]))
    : undefined;
}

function projectLegacyExpression(value: string): AgentExtensionValueExpression {
  return {
    segments: parseAgentMcpEnvironmentTemplate(value).map((segment) =>
      segment.kind === "literal"
        ? segment
        : {
            kind: "binding" as const,
            binding: { source: "legacyEnvironment" as const, name: segment.name, inputId: segment.name },
            ...(segment.defaultValue === undefined ? {} : { defaultValue: segment.defaultValue }),
          },
    ),
  };
}

function literal(value: string): AgentExtensionValueExpression {
  return { segments: value ? [{ kind: "literal", value }] : [] };
}
