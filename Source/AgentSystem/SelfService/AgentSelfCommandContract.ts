import { z } from "zod";
import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import { AgentSelfCommandRegistry, agentSelfCommandId } from "./AgentSelfCommandRegistry.js";
import { AgentSelfCommandSchema } from "./AgentSelfCommandSchema.js";

export const AgentSelfCommandContractVersion = 1 as const;

export interface AgentSelfCommandContractSnapshot {
  readonly version: typeof AgentSelfCommandContractVersion;
  readonly revision: string;
  readonly builtInCommands: readonly string[];
}

let cachedContract: AgentSelfCommandContractSnapshot | undefined;

/**
 * Projects the executable command contract without re-encoding the command
 * vocabulary. The JSON schema is derived from the Zod input schema, while
 * human-facing usage and governance metadata remain in the CLI registry.
 */
export function projectAgentSelfCommandContract(): AgentSelfCommandContractSnapshot {
  if (cachedContract) return cachedContract;
  const schema = z.toJSONSchema(AgentSelfCommandSchema, { target: "draft-7", io: "input" });
  const builtInCommands = collectCommandIds(schema);
  cachedContract = Object.freeze({
    version: AgentSelfCommandContractVersion,
    revision: sha256HexOfCanonicalJson({ schema, builtInCommands }),
    builtInCommands: Object.freeze(builtInCommands),
  });
  return cachedContract;
}

/**
 * Fails during contract generation when a built-in command is documented in
 * the registry but not executable by the model-facing schema, or vice versa.
 * Plugin commands are intentionally excluded: they are runtime-discovered and
 * use the separate plugin envelope.
 */
export function assertAgentSelfCommandContract(): void {
  const schema = z.toJSONSchema(AgentSelfCommandSchema, { target: "draft-7", io: "input" });
  const shapes = collectCommandShapes(schema);
  const actual = new Set(shapes.keys());
  const expected = new Set(AgentSelfCommandRegistry.map((spec) => agentSelfCommandId(spec.command, spec.action)));
  const missingFromSchema = [...expected].filter((id) => !actual.has(id));
  const missingFromRegistry = [...actual].filter((id) => !expected.has(id));
  const fieldDrift: string[] = [];
  for (const spec of AgentSelfCommandRegistry) {
    const id = agentSelfCommandId(spec.command, spec.action);
    const schemaFields = shapes.get(id);
    if (!schemaFields) continue;
    const registryFields = new Set(spec.args.map((argument) => argument.key));
    for (const field of schemaFields) {
      if (!registryFields.has(field)) fieldDrift.push(`${id}.${field} missing from CLI registry`);
    }
    for (const field of registryFields) {
      if (!schemaFields.has(field)) fieldDrift.push(`${id}.${field} missing from Zod schema`);
    }
  }
  if (missingFromSchema.length === 0 && missingFromRegistry.length === 0 && fieldDrift.length === 0) return;
  const details = [
    ...(missingFromSchema.length > 0 ? [`missing from Zod schema: ${missingFromSchema.join(", ")}`] : []),
    ...(missingFromRegistry.length > 0 ? [`missing from CLI registry: ${missingFromRegistry.join(", ")}`] : []),
    ...(fieldDrift.length > 0 ? [`field drift: ${fieldDrift.join(", ")}`] : []),
  ];
  throw new Error(`Senera self-service command contract drift: ${details.join("; ")}.`);
}

function collectCommandIds(schema: unknown): string[] {
  return [...collectCommandShapes(schema).keys()].sort(compareCodePoints);
}

function collectCommandShapes(schema: unknown): Map<string, Set<string>> {
  const shapes = new Map<string, Set<string>>();
  visitSchema(schema, shapes);
  return shapes;
}

function compareCodePoints(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function visitSchema(value: unknown, shapes: Map<string, Set<string>>): void {
  if (!isRecord(value)) return;
  const properties = isRecord(value.properties) ? value.properties : undefined;
  const command = readConst(properties?.command);
  if (command) {
    const action = readConst(properties?.action);
    const id = agentSelfCommandId(command, action);
    const fields = shapes.get(id) ?? new Set<string>();
    for (const field of properties ? Object.keys(properties) : []) {
      if (field !== "command" && field !== "action") fields.add(field);
    }
    shapes.set(id, fields);
  }
  for (const key of ["anyOf", "oneOf", "allOf"] as const) {
    const branches = Array.isArray(value[key]) ? value[key] : [];
    for (const branch of branches) visitSchema(branch, shapes);
  }
}

function readConst(value: unknown): string | undefined {
  return isRecord(value) && typeof value.const === "string" ? value.const : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
