import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { InMemoryToolSearchMemoryStore } from "../Source/AgentSystem/ToolSearch/AgentToolSearchMemoryStore.js";
import { verificationConfigPath } from "./VerificationConfig.js";

export interface IsolatedVerificationRuntimeConfig {
  readonly configPath: string;
  createToolSearchMemoryStore(): InMemoryToolSearchMemoryStore;
  dispose(): Promise<void>;
}

/**
 * Keeps verification tools pointed at the source workspace while moving their
 * derived runtime state out of any developer-owned `.senera` directory.
 */
export async function createIsolatedVerificationRuntimeConfig(
  sourceRoot: string = process.cwd(),
): Promise<IsolatedVerificationRuntimeConfig> {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "senera-runtime-verification-"));
  const sourceConfigPath = verificationConfigPath(sourceRoot);
  const config = JSON.parse(await readFile(sourceConfigPath, "utf8")) as unknown;
  const configPath = path.join(tempRoot, path.basename(sourceConfigPath));
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return {
    configPath,
    createToolSearchMemoryStore: () => new InMemoryToolSearchMemoryStore(),
    dispose: () => rm(tempRoot, { recursive: true, force: true }),
  };
}
