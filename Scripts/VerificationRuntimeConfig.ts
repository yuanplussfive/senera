import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { VerificationScenarioSource } from "./VerificationScenarioSource.js";
import type { AgentSystemConfig } from "../Source/AgentSystem/Types/AgentConfigTypes.js";
import { verificationConfigPath } from "./VerificationConfig.js";

export interface IsolatedVerificationRuntimeConfig {
  readonly configPath: string;
  createToolSearchScenarioSource(): VerificationScenarioSource;
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
  const sourceConfig = JSON.parse(await readFile(sourceConfigPath, "utf8")) as AgentSystemConfig;
  const config: AgentSystemConfig = {
    ...sourceConfig,
    Defaults: {
      ...sourceConfig.Defaults,
      SandboxRuntime: {
        ...sourceConfig.Defaults?.SandboxRuntime,
        Enabled: false,
      },
    },
  };
  const configPath = path.join(tempRoot, path.basename(sourceConfigPath));
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return {
    configPath,
    createToolSearchScenarioSource: () => new VerificationScenarioSource(),
    dispose: () => rm(tempRoot, { recursive: true, force: true }),
  };
}
