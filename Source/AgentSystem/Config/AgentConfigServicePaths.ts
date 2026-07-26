import fs from "node:fs";
import path from "node:path";
import { resolveConfigStoreConfig } from "../AgentDefaults.js";
import { AgentSystemConfigSchema } from "../Schemas/AgentSystemConfigSchema.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import { AgentConfigSecretCodec } from "./AgentConfigSecretProtection.js";

export function resolveConfigStoreDatabasePath(workspaceRoot: string, config: AgentSystemConfig): string {
  const store = resolveConfigStoreConfig(config);
  return resolveConfigPath(workspaceRoot, store.DatabasePath);
}

export function resolveConfigPath(workspaceRoot: string, value: string): string {
  return path.isAbsolute(value) ? path.normalize(value) : path.resolve(workspaceRoot, value);
}

export function writeAgentConfigJsonMirror(
  config: AgentSystemConfig,
  configPath: string,
  secretCodec = new AgentConfigSecretCodec({ workspaceRoot: path.dirname(path.resolve(configPath)) }),
): void {
  const normalized = AgentSystemConfigSchema.parse(config);
  writeProtectedJsonFile(secretCodec.protectConfig(normalized), configPath);
}

export function persistMigratedAgentConfigJson(
  config: AgentSystemConfig,
  configPath: string,
  sourceVersion: number,
  secretCodec = new AgentConfigSecretCodec({ workspaceRoot: path.dirname(path.resolve(configPath)) }),
): { backupPath?: string } {
  const backupPath = `${configPath}.v${sourceVersion}.bak`;
  let createdBackupPath: string | undefined;
  try {
    const sourcePayload = JSON.parse(fs.readFileSync(configPath, "utf8")) as unknown;
    writeProtectedJsonFile(secretCodec.protectPayload(sourcePayload), backupPath, true);
    createdBackupPath = backupPath;
  } catch (error) {
    if (!isAlreadyExistsError(error)) {
      throw error;
    }
    rewriteExistingBackupSecrets(backupPath, secretCodec);
  }

  writeAgentConfigJsonMirror(config, configPath, secretCodec);
  return { backupPath: createdBackupPath };
}

function rewriteExistingBackupSecrets(backupPath: string, secretCodec: AgentConfigSecretCodec): void {
  const payload = JSON.parse(fs.readFileSync(backupPath, "utf8")) as unknown;
  const revealed = secretCodec.revealPayload(payload);
  if (revealed.plaintextSecretsFound) {
    writeProtectedJsonFile(secretCodec.protectPayload(revealed.value), backupPath);
  }
}

function writeProtectedJsonFile(payload: unknown, filePath: string, exclusive = false): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  if (exclusive) {
    fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    restrictFilePermissions(filePath);
    return;
  }

  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    fs.renameSync(tempPath, filePath);
    restrictFilePermissions(filePath);
  } finally {
    fs.rmSync(tempPath, { force: true });
  }
}

function restrictFilePermissions(filePath: string): void {
  if (process.platform !== "win32") {
    fs.chmodSync(filePath, 0o600);
  }
}

function isAlreadyExistsError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}
