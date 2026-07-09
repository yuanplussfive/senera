import { createRequire } from "node:module";
import path from "node:path";

const nodeRequire = createRequire(import.meta.url);

interface NodePackageJson {
  bin?: string | Record<string, string>;
}

export function resolveNodePackageBin(packageName: string, binName?: string): string {
  const packageJsonPath = nodeRequire.resolve(`${packageName}/package.json`);
  const packageRoot = path.dirname(packageJsonPath);
  const packageJson = nodeRequire(packageJsonPath) as NodePackageJson;
  const binEntry = readPackageBinEntry(packageJson, binName);
  if (!binEntry) {
    throw new Error(`${packageName} 缺少可执行 bin 入口。`);
  }

  return path.resolve(packageRoot, binEntry);
}

function readPackageBinEntry(packageJson: NodePackageJson, binName: string | undefined): string | undefined {
  if (typeof packageJson.bin === "string") {
    return packageJson.bin;
  }

  const bins = packageJson.bin ?? {};
  return binName ? bins[binName] : Object.values(bins)[0];
}
