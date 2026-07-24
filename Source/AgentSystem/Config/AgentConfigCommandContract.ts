import { createHash } from "node:crypto";
import { stringifyAgentCanonicalJson } from "../Core/AgentCanonicalJson.js";
import { AgentConfigCommandSchemaCatalog, type AgentConfigCommandSchemaId } from "./AgentConfigCommandSchemaCatalog.js";

export interface AgentConfigMergePatchContract {
  readonly schema: AgentConfigCommandSchemaId;
  readonly semantics: "json-merge-patch";
  readonly identityFields: readonly string[];
}

export interface AgentConfigCommandContractDefinition {
  readonly formatVersion: 1;
  readonly operations: Readonly<Record<string, AgentConfigMergePatchContract>>;
}

export interface AgentConfigCommandRuntimeContract {
  readonly formatVersion: 1;
  readonly id: string;
  readonly version: number;
  readonly name: string;
  readonly definitionChecksum: string;
  readonly definition: AgentConfigCommandContractDefinition;
}

export function loadAgentConfigCommandRuntimeContract(value: unknown): AgentConfigCommandRuntimeContract {
  if (!isRecord(value)) throw new TypeError("Configuration command runtime contract must be an object.");
  assertKnownKeys(value, ["formatVersion", "id", "version", "name", "definitionChecksum", "definition"]);
  if (value.formatVersion !== 1) throw new Error("Configuration command runtime contract formatVersion must be 1.");
  const id = readIdentifier(value.id, "contract id");
  const version = readPositiveInteger(value.version, "contract version");
  const name = readIdentifier(value.name, "contract version name");
  const definitionChecksum = readChecksum(value.definitionChecksum);
  const definition = loadAgentConfigCommandDefinition(value.definition);
  const actualChecksum = checksumAgentConfigCommandDefinition(definition);
  if (actualChecksum !== definitionChecksum) {
    throw new Error(`Configuration command contract ${id} v${version} definition checksum mismatch.`);
  }
  return Object.freeze({ formatVersion: 1, id, version, name, definitionChecksum, definition });
}

export function loadAgentConfigCommandDefinition(value: unknown): AgentConfigCommandContractDefinition {
  if (!isRecord(value)) throw new TypeError("Configuration command definition must be an object.");
  assertKnownKeys(value, ["formatVersion", "operations"]);
  if (value.formatVersion !== 1) throw new Error("Configuration command definition formatVersion must be 1.");
  if (!isRecord(value.operations) || Object.keys(value.operations).length === 0) {
    throw new Error("Configuration command definition operations must be a non-empty object.");
  }
  const operations = Object.fromEntries(
    Object.entries(value.operations).map(([operation, contract]) => [
      readIdentifier(operation, "operation id"),
      readMergePatchContract(contract, operation),
    ]),
  );
  return Object.freeze({ formatVersion: 1, operations: Object.freeze(operations) });
}

export function checksumAgentConfigCommandDefinition(definition: AgentConfigCommandContractDefinition): string {
  return createHash("sha256").update(stringifyAgentCanonicalJson(definition), "utf8").digest("hex");
}

function readMergePatchContract(value: unknown, operation: string): AgentConfigMergePatchContract {
  if (!isRecord(value)) throw new TypeError(`Configuration command ${operation} must be an object.`);
  assertKnownKeys(value, ["schema", "semantics", "identityFields"]);
  const schema = readIdentifier(value.schema, `${operation} schema`);
  if (!(schema in AgentConfigCommandSchemaCatalog)) {
    throw new Error(`Configuration command ${operation} references unknown schema: ${schema}.`);
  }
  if (value.semantics !== "json-merge-patch") {
    throw new Error(`Configuration command ${operation} semantics must be json-merge-patch.`);
  }
  if (
    !Array.isArray(value.identityFields) ||
    value.identityFields.length === 0 ||
    value.identityFields.some((field) => typeof field !== "string" || !field)
  ) {
    throw new Error(`Configuration command ${operation} identityFields must be a non-empty string array.`);
  }
  const identityFields = [...new Set(value.identityFields as string[])];
  const schemaFields = AgentConfigCommandSchemaCatalog[schema as AgentConfigCommandSchemaId].shape;
  for (const field of identityFields) {
    if (!(field in schemaFields)) {
      throw new Error(`Configuration command ${operation} identity field is absent from ${schema}: ${field}.`);
    }
  }
  return Object.freeze({
    schema: schema as AgentConfigCommandSchemaId,
    semantics: "json-merge-patch",
    identityFields: Object.freeze(identityFields),
  });
}

function readIdentifier(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value)) {
    throw new Error(`${label} must be a non-empty identifier.`);
  }
  return value;
}

function readPositiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new Error(`${label} must be a positive integer.`);
  return value as number;
}

function readChecksum(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error("Configuration command definitionChecksum must be a lowercase SHA-256 checksum.");
  }
  return value;
}

function assertKnownKeys(value: object, knownKeys: readonly string[]): void {
  const known = new Set(knownKeys);
  const unsupported = Object.keys(value).filter((key) => !known.has(key));
  if (unsupported.length > 0)
    throw new Error(`Unsupported configuration command contract keys: ${unsupported.join(", ")}.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
