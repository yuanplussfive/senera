import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  checksumAgentConfigCommandDefinition,
  loadAgentConfigCommandDefinition,
  type AgentConfigCommandContractDefinition,
} from "../Source/AgentSystem/Config/AgentConfigCommandContract.js";
import { AgentConfigCommandSchemaCatalog } from "../Source/AgentSystem/Config/AgentConfigCommandSchemaCatalog.js";
import { createAgentJsonMergePatchSchema } from "../Source/AgentSystem/Core/AgentJsonMergePatch.js";

interface ContractManifest {
  formatVersion?: unknown;
  id?: unknown;
  versions?: unknown;
}

interface ContractVersion {
  version?: unknown;
  name?: unknown;
  definition?: unknown;
  definitionSha256?: unknown;
  snapshot?: unknown;
  snapshotSha256?: unknown;
}

const check = process.argv.includes("--check");
const contractDirectory = path.join(process.cwd(), "Source", "AgentSystem", "Config", "CommandContracts");
const manifestPath = path.join(contractDirectory, "contract.json");
const runtimePath = path.join(contractDirectory, "runtime.json");
const manifest = readManifest();
const versions = readVersions(manifest);

for (const [index, version] of versions.entries()) synchronizeVersion(version, index === versions.length - 1);

const latest = versions.at(-1)!;
const definition = readDefinition(resolveResource(latest.definition, "definition"));
const definitionChecksum = checksumAgentConfigCommandDefinition(definition);
const runtimeSource = `${JSON.stringify(
  {
    formatVersion: 1,
    id: readIdentifier(manifest.id, "contract id"),
    version: readPositiveInteger(latest.version, "version"),
    name: readIdentifier(latest.name, "version name"),
    definitionChecksum,
    definition,
  },
  null,
  2,
)}\n`;
synchronizeFile(runtimePath, runtimeSource);
synchronizeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Configuration command contracts ${check ? "verified" : "generated"}.`);

function synchronizeVersion(version: ContractVersion, latest: boolean): void {
  const number = readPositiveInteger(version.version, "version");
  const definitionPath = resolveResource(version.definition, `version ${number} definition`);
  const snapshotPath = resolveResource(version.snapshot, `version ${number} snapshot`);
  const definition = readDefinition(definitionPath);
  const definitionChecksum = checksumAgentConfigCommandDefinition(definition);
  synchronizeImmutableChecksum(version, "definitionSha256", definitionChecksum, `version ${number} definition`);

  if (latest && version.snapshotSha256 === undefined) {
    const snapshot = `${JSON.stringify(projectSnapshot(number, definition), null, 2)}\n`;
    synchronizeFile(snapshotPath, snapshot);
    version.snapshotSha256 = sha256(snapshot);
    return;
  }

  if (!fs.existsSync(snapshotPath)) throw new Error(`Missing version ${number} snapshot: ${relative(snapshotPath)}.`);
  const snapshotChecksum = sha256(fs.readFileSync(snapshotPath, "utf8"));
  synchronizeImmutableChecksum(version, "snapshotSha256", snapshotChecksum, `version ${number} snapshot`);
  if (latest) {
    const expected = `${JSON.stringify(projectSnapshot(number, definition), null, 2)}\n`;
    if (fs.readFileSync(snapshotPath, "utf8") !== expected) {
      throw new Error(`Version ${number} schema changed after publication. Append a new command contract version.`);
    }
  }
}

function projectSnapshot(version: number, definition: AgentConfigCommandContractDefinition): object {
  return {
    formatVersion: 1,
    version,
    operations: Object.fromEntries(
      Object.entries(definition.operations).map(([operation, contract]) => {
        const baseSchema = AgentConfigCommandSchemaCatalog[contract.schema];
        const schema = createAgentJsonMergePatchSchema(
          baseSchema,
          contract.identityFields as readonly (keyof z.output<typeof baseSchema> & string)[],
        );
        return [operation, z.toJSONSchema(schema, { target: "draft-7" })];
      }),
    ),
  };
}

function synchronizeImmutableChecksum(
  version: ContractVersion,
  field: "definitionSha256" | "snapshotSha256",
  actual: string,
  label: string,
): void {
  const expected = version[field];
  if (expected === undefined) {
    if (check) throw new Error(`${label} checksum is missing. Run npm run generate.config-command-contracts.`);
    version[field] = actual;
    return;
  }
  if (expected !== actual) throw new Error(`${label} is immutable. Append a new command contract version.`);
}

function readManifest(): ContractManifest {
  const value: unknown = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (!isRecord(value)) throw new Error("Configuration command contract manifest must be an object.");
  if (value.formatVersion !== 1) throw new Error("Configuration command contract formatVersion must be 1.");
  readIdentifier(value.id, "contract id");
  return value;
}

function readVersions(value: ContractManifest): ContractVersion[] {
  if (
    !Array.isArray(value.versions) ||
    value.versions.length === 0 ||
    value.versions.some((entry) => !isRecord(entry))
  ) {
    throw new Error("Configuration command contract versions must be a non-empty object array.");
  }
  const versions = value.versions as ContractVersion[];
  for (const [index, version] of versions.entries()) {
    if (version.version !== index + 1) throw new Error(`Contract versions must be contiguous from 1.`);
    readIdentifier(version.name, `version ${index + 1} name`);
  }
  return versions;
}

function readDefinition(filePath: string): AgentConfigCommandContractDefinition {
  return loadAgentConfigCommandDefinition(JSON.parse(fs.readFileSync(filePath, "utf8")));
}

function resolveResource(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) throw new Error(`${label} must be a relative path.`);
  const resolved = path.resolve(contractDirectory, value);
  const inside = path.relative(contractDirectory, resolved);
  if (!inside || inside.startsWith(`..${path.sep}`) || path.isAbsolute(inside)) {
    throw new Error(`${label} escapes the command contract directory.`);
  }
  return resolved;
}

function synchronizeFile(filePath: string, content: string): void {
  const actual = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : undefined;
  if (actual === content) return;
  if (check) throw new Error(`${relative(filePath)} is stale. Run npm run generate.config-command-contracts.`);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
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

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function relative(filePath: string): string {
  return path.relative(process.cwd(), filePath).split(path.sep).join("/");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
