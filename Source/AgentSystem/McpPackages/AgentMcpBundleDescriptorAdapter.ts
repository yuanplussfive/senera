import path from "node:path";
import {
  AgentExtensionInputDefinitionSchema,
  AgentExtensionInputTypes,
  type AgentExtensionInputDefinition,
} from "../Extensions/AgentExtensionInput.js";
import type { AgentExtensionValueExpression } from "../Extensions/AgentExtensionValueExpression.js";
import { AgentExtensionNameSchema } from "../Extensions/AgentExtensionIdentity.js";
import type { AgentMcpDescriptorAdapter, AgentMcpDescriptorContext } from "./AgentMcpDescriptorAdapter.js";
import {
  AgentMcpDescriptorError,
  optionalMcpString,
  requireMcpRecord,
  requireMcpString,
} from "./AgentMcpDescriptorAdapter.js";
import type { AgentMcpInputDefinition } from "./AgentMcpInputDefinition.js";
import {
  AgentMcpExecutionTargets,
  AgentMcpExecutionTargetSchema,
  type AgentMcpExecution,
} from "./AgentMcpPackageSchema.js";

const SeneraExecutionMetadataKey = "ai.senera/execution";

export const AgentMcpBundleDescriptorAdapter: AgentMcpDescriptorAdapter = {
  kind: "mcpb",
  fileName: "manifest.json",
  recognizes(document) {
    return isRecord(document) && document.manifest_version !== undefined && isRecord(document.server);
  },
  project(context, document) {
    const manifest = requireMcpRecord(document, "MCPB manifest");
    requireMcpString(manifest.version, "MCPB version", ["version"]);
    const declaredName = requireMcpString(manifest.name, "MCPB name", ["name"]);
    const serverId = AgentExtensionNameSchema.safeParse(declaredName).success ? declaredName : context.directoryName;
    const server = requireMcpRecord(manifest.server, "MCPB server", ["server"]);
    const userConfig = projectUserConfig(manifest.user_config);
    const definitions = new Map(userConfig.map((input) => [input.id, input]));
    const mcpConfig =
      server.mcp_config === undefined
        ? undefined
        : requireMcpRecord(server.mcp_config, "MCPB server.mcp_config", ["server", "mcp_config"]);
    const command = optionalMcpString(mcpConfig?.command, "MCPB command", ["server", "mcp_config", "command"]);
    const args = projectStringArray(mcpConfig?.args, ["server", "mcp_config", "args"]);
    const env = projectStringRecord(mcpConfig?.env, ["server", "mcp_config", "env"], definitions);
    const entryPoint = optionalMcpString(server.entry_point, "MCPB entry point", ["server", "entry_point"]);
    const fallback = command ? { command, args: [] } : deriveMcpBundleCommand(server.type, entryPoint, context);
    const commandExpression = projectMcpBundleExpression(fallback.command, definitions);
    const argExpressions = (command ? args : [...fallback.args, ...args]).map((value) =>
      projectMcpBundleExpression(value, definitions),
    );
    return {
      name: context.directoryName,
      descriptorKind: "mcpb",
      execution: projectExecution(manifest._meta, context),
      servers: [
        {
          name: serverId,
          inputs: userConfig,
          configuration: {
            type: "stdio",
            command: commandExpression,
            args: argExpressions,
            cwd: runtimeExpression("packageRoot"),
            env,
          },
        },
      ],
    };
  },
};

function projectUserConfig(value: unknown): AgentMcpInputDefinition[] {
  if (value === undefined) return [];
  const config = requireMcpRecord(value, "MCPB user_config", ["user_config"]);
  return Object.entries(config)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, raw]) => {
      const field = requireMcpRecord(raw, `MCPB user_config.${id}`, ["user_config", id]);
      const type = projectMcpBundleInputType(field.type, ["user_config", id, "type"]);
      const secret = field.sensitive === true;
      const definition = AgentExtensionInputDefinitionSchema.parse({
        id,
        title: optionalMcpString(field.title, `MCPB user_config.${id}.title`) ?? id,
        description: optionalMcpString(field.description, `MCPB user_config.${id}.description`),
        type,
        required: field.required === true,
        secret,
        multiple: field.multiple === true,
        defaultValue: field.default,
        choices: field.enum,
        placeholder: typeof field.placeholder === "string" ? field.placeholder : undefined,
        min: typeof field.min === "number" ? field.min : undefined,
        max: typeof field.max === "number" ? field.max : undefined,
      });
      return {
        ...definition,
        binding: { source: secret ? "secret" : "config", inputId: id },
        provenance: "mcpb",
      };
    });
}

function projectMcpBundleInputType(
  value: unknown,
  fieldPath: readonly PropertyKey[],
): AgentExtensionInputDefinition["type"] {
  switch (value) {
    case "string":
    case undefined:
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
      throw new AgentMcpDescriptorError(`Unsupported MCPB input type: ${String(value)}.`, fieldPath);
  }
}

function projectMcpBundleExpression(
  value: string,
  definitions: ReadonlyMap<string, AgentMcpInputDefinition>,
): AgentExtensionValueExpression {
  const segments: AgentExtensionValueExpression["segments"][number][] = [];
  const reference = /\$\{([^}]+)\}/gu;
  let cursor = 0;
  for (const match of value.matchAll(reference)) {
    const index = match.index;
    if (index > cursor) segments.push({ kind: "literal", value: value.slice(cursor, index) });
    const name = match[1]!;
    if (name === "__dirname") {
      segments.push({ kind: "binding", binding: { source: "runtime", key: "packageRoot" } });
    } else if (name.startsWith("user_config.")) {
      const inputId = name.slice("user_config.".length);
      const definition = definitions.get(inputId);
      if (!definition)
        throw new AgentMcpDescriptorError(`MCPB expression references undeclared user_config.${inputId}.`);
      segments.push({ kind: "binding", binding: definition.binding });
    } else {
      throw new AgentMcpDescriptorError(`Unsupported MCPB expression reference: ${name}.`);
    }
    cursor = index + match[0].length;
  }
  if (cursor < value.length) segments.push({ kind: "literal", value: value.slice(cursor) });
  return { segments };
}

function deriveMcpBundleCommand(
  type: unknown,
  entryPoint: string | undefined,
  context: AgentMcpDescriptorContext,
): { command: string; args: string[] } {
  if (!entryPoint)
    throw new AgentMcpDescriptorError("MCPB server requires mcp_config.command or entry_point.", ["server"]);
  assertRelativeBundlePath(entryPoint, context.packageRoot);
  const entry = `\${__dirname}/${entryPoint.replaceAll("\\", "/")}`;
  switch (type) {
    case "node":
      return { command: "node", args: [entry] };
    case "python":
      return { command: "python", args: [entry] };
    case "binary":
      return { command: entry, args: [] };
    default:
      throw new AgentMcpDescriptorError(`Unsupported MCPB server type: ${String(type)}.`, ["server", "type"]);
  }
}

function assertRelativeBundlePath(value: string, packageRoot: string): void {
  const resolved = path.resolve(packageRoot, value);
  const relative = path.relative(packageRoot, resolved);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new AgentMcpDescriptorError(`MCPB entry point must remain inside its package: ${value}.`);
  }
}

function projectStringArray(value: unknown, fieldPath: readonly PropertyKey[]): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new AgentMcpDescriptorError("Expected a string array.", fieldPath);
  }
  return value as string[];
}

function projectStringRecord(
  value: unknown,
  fieldPath: readonly PropertyKey[],
  definitions: ReadonlyMap<string, AgentMcpInputDefinition>,
): Record<string, AgentExtensionValueExpression> | undefined {
  if (value === undefined) return undefined;
  const record = requireMcpRecord(value, "MCPB environment", fieldPath);
  return Object.fromEntries(
    Object.entries(record).map(([name, raw]) => [
      name,
      projectMcpBundleExpression(requireMcpString(raw, `MCPB environment ${name}`, [...fieldPath, name]), definitions),
    ]),
  );
}

function projectExecution(meta: unknown, context: AgentMcpDescriptorContext): AgentMcpExecution {
  if (isRecord(meta) && meta[SeneraExecutionMetadataKey] !== undefined) {
    const execution = requireMcpRecord(meta[SeneraExecutionMetadataKey], SeneraExecutionMetadataKey, ["_meta"]);
    const targets = Array.isArray(execution.targets)
      ? execution.targets.map((target) => AgentMcpExecutionTargetSchema.parse(target))
      : [];
    const preferred = AgentMcpExecutionTargetSchema.parse(execution.preferred);
    if (targets.length === 0 || !targets.includes(preferred)) {
      throw new AgentMcpDescriptorError("MCPB execution metadata must declare targets including preferred.", ["_meta"]);
    }
    return { targets, preferred };
  }
  const target = context.source === "bundled" ? AgentMcpExecutionTargets.Local : AgentMcpExecutionTargets.Sandbox;
  return { targets: [target], preferred: target };
}

function runtimeExpression(key: "packageRoot" | "workspaceRoot"): AgentExtensionValueExpression {
  return { segments: [{ kind: "binding", binding: { source: "runtime", key } }] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
