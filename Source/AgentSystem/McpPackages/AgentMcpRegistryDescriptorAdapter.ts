import {
  AgentExtensionInputDefinitionSchema,
  AgentExtensionInputTypes,
  type AgentExtensionInputDefinition,
  type AgentExtensionInputValue,
} from "../Extensions/AgentExtensionInput.js";
import type { AgentExtensionValueExpression } from "../Extensions/AgentExtensionValueExpression.js";
import type { AgentMcpDescriptorAdapter, AgentMcpDescriptorContext } from "./AgentMcpDescriptorAdapter.js";
import {
  AgentMcpDescriptorError,
  optionalMcpString,
  requireMcpRecord,
  requireMcpString,
} from "./AgentMcpDescriptorAdapter.js";
import type { AgentMcpInputDefinition } from "./AgentMcpInputDefinition.js";
import { AgentMcpExecutionTargets, type AgentMcpExecution } from "./AgentMcpPackageSchema.js";
import type { AgentMcpPackageServer } from "./AgentMcpPackageTypes.js";

export const AgentMcpRegistryDescriptorAdapter: AgentMcpDescriptorAdapter = {
  kind: "registry",
  fileName: "server.json",
  recognizes: () => true,
  project(context, document) {
    const descriptor = requireMcpRecord(document, "MCP Registry descriptor");
    requireMcpString(descriptor.name, "MCP Registry name", ["name"]);
    requireMcpString(descriptor.version, "MCP Registry version", ["version"]);
    const packages = optionalRecordArray(descriptor.packages, "packages");
    const remotes = optionalRecordArray(descriptor.remotes, "remotes");
    const routes = [
      ...packages.map((entry, index) => projectPackageRoute(context, entry, index)),
      ...remotes.map((entry, index) => projectRemoteRoute(context, entry, index)),
    ];
    if (routes.length === 0) {
      throw new AgentMcpDescriptorError("MCP Registry descriptor does not declare a runnable package or remote.");
    }
    if (routes.length > 1) {
      throw new AgentMcpDescriptorError(
        `MCP Registry descriptor declares ${routes.length} runnable routes; Senera requires one unambiguous route.`,
      );
    }
    const route = routes[0]!;
    return {
      name: context.directoryName,
      descriptorKind: "registry",
      execution: route.execution,
      servers: [route.server],
    };
  },
};

interface RegistryRouteProjection {
  readonly execution?: AgentMcpExecution;
  readonly server: AgentMcpPackageServer;
}

function projectPackageRoute(
  context: AgentMcpDescriptorContext,
  package_: Record<string, unknown>,
  index: number,
): RegistryRouteProjection {
  const basePath = ["packages", index] as const;
  const transport =
    package_.transport === undefined
      ? { type: "stdio" }
      : requireMcpRecord(package_.transport, "MCP Registry package transport", [...basePath, "transport"]);
  if (transport.type !== "stdio") {
    throw new AgentMcpDescriptorError(`Unsupported MCP Registry package transport: ${String(transport.type)}.`, [
      ...basePath,
      "transport",
      "type",
    ]);
  }
  const identifier = requireMcpString(package_.identifier, "MCP Registry package identifier", [
    ...basePath,
    "identifier",
  ]);
  const version = optionalMcpString(package_.version, "MCP Registry package version", [...basePath, "version"]);
  const runtime = projectRegistryRuntime(package_.runtimeHint, package_.registryType, [...basePath]);
  const inputs = projectRegistryInputs(package_.environmentVariables, [...basePath, "environmentVariables"]);
  const environment = Object.fromEntries(
    inputs.map((input) => [input.environmentName, boundExpression(input.definition)]),
  );
  const packageArguments = projectRegistryPackageArguments(package_.packageArguments, [
    ...basePath,
    "packageArguments",
  ]);
  const specifier = registryPackageSpecifier(identifier, version, runtime.command);
  return {
    execution: defaultExecution(context),
    server: {
      name: context.directoryName,
      inputs: inputs.map((input) => input.definition),
      configuration: {
        type: "stdio",
        command: literal(runtime.command),
        args: [...runtime.prefixArgs, specifier, ...packageArguments].map(literal),
        cwd: runtimeExpression("packageRoot"),
        env: environment,
      },
    },
  };
}

function projectRemoteRoute(
  context: AgentMcpDescriptorContext,
  remote: Record<string, unknown>,
  index: number,
): RegistryRouteProjection {
  const basePath = ["remotes", index] as const;
  if (remote.type !== "streamable-http" && remote.type !== "http") {
    throw new AgentMcpDescriptorError(`Unsupported MCP Registry remote transport: ${String(remote.type)}.`, [
      ...basePath,
      "type",
    ]);
  }
  const url = requireMcpString(remote.url, "MCP Registry remote URL", [...basePath, "url"]);
  const projected = projectRegistryHeaders(remote.headers, [...basePath, "headers"]);
  return {
    server: {
      name: context.directoryName,
      inputs: projected.inputs,
      configuration: {
        type: "http",
        url: literal(url),
        headers: projected.headers,
      },
    },
  };
}

function projectRegistryInputs(
  value: unknown,
  fieldPath: readonly PropertyKey[],
): Array<{ environmentName: string; definition: AgentMcpInputDefinition }> {
  const values = optionalRecordArray(value, fieldPath.join("."));
  return values.map((field, index) => {
    const name = requireMcpString(field.name, "MCP Registry environment variable name", [...fieldPath, index, "name"]);
    return {
      environmentName: name,
      definition: projectRegistryInputDefinition(name, field, [...fieldPath, index]),
    };
  });
}

function projectRegistryHeaders(
  value: unknown,
  fieldPath: readonly PropertyKey[],
): { inputs: AgentMcpInputDefinition[]; headers?: Record<string, AgentExtensionValueExpression> } {
  if (value === undefined) return { inputs: [] };
  if (Array.isArray(value)) {
    const inputs = value.map((raw, index) => {
      const field = requireMcpRecord(raw, "MCP Registry header", [...fieldPath, index]);
      const name = requireMcpString(field.name, "MCP Registry header name", [...fieldPath, index, "name"]);
      return { name, definition: projectRegistryInputDefinition(name, field, [...fieldPath, index]) };
    });
    return {
      inputs: inputs.map((entry) => entry.definition),
      headers: Object.fromEntries(inputs.map((entry) => [entry.name, boundExpression(entry.definition)])),
    };
  }
  const record = requireMcpRecord(value, "MCP Registry headers", fieldPath);
  const inputs: AgentMcpInputDefinition[] = [];
  const headers = Object.fromEntries(
    Object.entries(record).map(([name, raw]) => {
      if (typeof raw === "string") return [name, literal(raw)];
      const field = requireMcpRecord(raw, `MCP Registry header ${name}`, [...fieldPath, name]);
      const definition = projectRegistryInputDefinition(name, field, [...fieldPath, name]);
      inputs.push(definition);
      return [name, boundExpression(definition)];
    }),
  );
  return { inputs, headers };
}

function projectRegistryInputDefinition(
  id: string,
  field: Record<string, unknown>,
  fieldPath: readonly PropertyKey[],
): AgentMcpInputDefinition {
  const secret = field.isSecret === true || field.sensitive === true;
  const type = projectRegistryInputType(field.format ?? field.type, [...fieldPath, "format"]);
  const defaultValue = (field.default ?? field.defaultValue) as AgentExtensionInputValue | undefined;
  const definition = AgentExtensionInputDefinitionSchema.parse({
    id,
    title: optionalMcpString(field.title, `MCP Registry input ${id} title`) ?? id,
    description: optionalMcpString(field.description, `MCP Registry input ${id} description`),
    type,
    required: field.isRequired === true || field.required === true,
    secret,
    defaultValue,
    choices: field.enum,
    placeholder: typeof field.valueHint === "string" ? field.valueHint : undefined,
  });
  return {
    ...definition,
    binding: { source: secret ? "secret" : "config", inputId: id },
    provenance: "registry",
  };
}

function projectRegistryInputType(
  value: unknown,
  fieldPath: readonly PropertyKey[],
): AgentExtensionInputDefinition["type"] {
  switch (value) {
    case undefined:
    case "string":
      return AgentExtensionInputTypes.String;
    case "number":
      return AgentExtensionInputTypes.Number;
    case "boolean":
      return AgentExtensionInputTypes.Boolean;
    case "file":
    case "filepath":
      return AgentExtensionInputTypes.FilePath;
    case "directory":
      return AgentExtensionInputTypes.Directory;
    default:
      throw new AgentMcpDescriptorError(`Unsupported MCP Registry input format: ${String(value)}.`, fieldPath);
  }
}

function projectRegistryRuntime(
  runtimeHint: unknown,
  registryType: unknown,
  fieldPath: readonly PropertyKey[],
): { command: string; prefixArgs: readonly string[] } {
  const runtime = runtimeHint ?? registryType;
  switch (runtime) {
    case "npx":
    case "npm":
      return { command: "npx", prefixArgs: ["-y"] };
    case "uvx":
    case "pypi":
      return { command: "uvx", prefixArgs: [] };
    case "docker":
    case "oci":
      return { command: "docker", prefixArgs: ["run", "-i", "--rm"] };
    default:
      throw new AgentMcpDescriptorError(`Unsupported MCP Registry runtime: ${String(runtime)}.`, [
        ...fieldPath,
        "registryType",
      ]);
  }
}

function registryPackageSpecifier(identifier: string, version: string | undefined, command: string): string {
  if (!version) return identifier;
  if (command === "uvx") return `${identifier}==${version}`;
  if (command === "docker") return `${identifier}:${version}`;
  return `${identifier}@${version}`;
}

function projectRegistryPackageArguments(value: unknown, fieldPath: readonly PropertyKey[]): string[] {
  const values = optionalRecordArray(value, fieldPath.join("."));
  return values.flatMap((argument, index) => {
    const type = argument.type ?? "positional";
    const value = requireMcpString(argument.value, "MCP Registry package argument value", [
      ...fieldPath,
      index,
      "value",
    ]);
    if (type === "positional") return [value];
    if (type === "named") {
      const name = requireMcpString(argument.name, "MCP Registry named argument", [...fieldPath, index, "name"]);
      return [name, value];
    }
    throw new AgentMcpDescriptorError(`Unsupported MCP Registry package argument type: ${String(type)}.`, [
      ...fieldPath,
      index,
      "type",
    ]);
  });
}

function optionalRecordArray(value: unknown, label: string): Record<string, unknown>[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new AgentMcpDescriptorError(`${label} must be an array.`);
  return value.map((entry, index) => requireMcpRecord(entry, `${label}[${index}]`, [label, index]));
}

function defaultExecution(context: AgentMcpDescriptorContext): AgentMcpExecution {
  const target = context.source === "bundled" ? AgentMcpExecutionTargets.Local : AgentMcpExecutionTargets.Sandbox;
  return { targets: [target], preferred: target };
}

function boundExpression(definition: AgentMcpInputDefinition): AgentExtensionValueExpression {
  return { segments: [{ kind: "binding", binding: definition.binding }] };
}

function literal(value: string): AgentExtensionValueExpression {
  return { segments: value ? [{ kind: "literal", value }] : [] };
}

function runtimeExpression(key: "packageRoot" | "workspaceRoot"): AgentExtensionValueExpression {
  return { segments: [{ kind: "binding", binding: { source: "runtime", key } }] };
}
