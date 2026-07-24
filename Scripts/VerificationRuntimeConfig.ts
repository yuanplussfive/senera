import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { verificationConfigPath } from "./VerificationConfig.js";

interface VerificationConfigDocument {
  Defaults: {
    ToolSearch: {
      Memory: {
        DatabasePath: string;
      };
    };
  };
}

export interface IsolatedVerificationRuntimeConfig {
  readonly configPath: string;
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
  const config = JSON.parse(await readFile(sourceConfigPath, "utf8")) as VerificationConfigDocument;
  config.Defaults.ToolSearch.Memory.DatabasePath = path.join(tempRoot, "ToolSearchLearning.sqlite");
  const configPath = path.join(tempRoot, path.basename(sourceConfigPath));
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return {
    configPath,
    dispose: () => rm(tempRoot, { recursive: true, force: true }),
  };
}
