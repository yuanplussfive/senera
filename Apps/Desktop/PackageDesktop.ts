import crossSpawn from "cross-spawn";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { readDesktopPackageVersionOverride } from "../../Build/DesktopReleaseInfo.js";
import { isMainModule } from "../../Source/AgentSystem/Core/AgentPath.js";

const { sync: spawnSync } = crossSpawn;

interface CommandInvocation {
  command: string;
  arguments: string[];
}

const steps = [
  command("npm", ["run", "build"]),
  command("npm", ["--workspace", "senera-frontend", "run", "build"]),
  command("electron-builder", electronBuilderArguments()),
];

const nativeModules = [
  "better-sqlite3",
];

if (isMainModule(import.meta.url)) {
  process.exitCode = packageDesktop();
}

export function packageDesktop(): number {
  let exitCode = 0;

  try {
    clearNativeRebuildMetadata();
    for (const step of steps) {
      const result = run(step);
      if (result !== 0) {
        exitCode = result;
        break;
      }
    }
  } finally {
    const restoreCode = run(command("npm", ["rebuild", "better-sqlite3"]));
    clearNativeRebuildMetadata();
    if (exitCode === 0 && restoreCode !== 0) {
      exitCode = restoreCode;
    }
  }

  return exitCode;
}

function run(invocation: CommandInvocation): number {
  process.stdout.write(`\n> ${[invocation.command, ...invocation.arguments].join(" ")}\n`);

  const result = spawnSync(invocation.command, invocation.arguments, {
    cwd: process.cwd(),
    stdio: "inherit",
    windowsHide: true,
  });

  if (result.error) {
    process.stderr.write(`${result.error.stack ?? result.error.message}\n`);
    return 1;
  }

  return result.status ?? 1;
}

function command(name: string, args: readonly string[] = []): CommandInvocation {
  return {
    command: name,
    arguments: [...args],
  };
}

function electronBuilderArguments(): string[] {
  const version = readDesktopPackageVersionOverride();
  return version ? [`-c.extraMetadata.version=${version}`] : [];
}

function clearNativeRebuildMetadata(): void {
  for (const moduleName of nativeModules) {
    const metadataPath = path.join(
      process.cwd(),
      "node_modules",
      moduleName,
      "build",
      "Release",
      ".forge-meta",
    );
    if (fs.existsSync(metadataPath)) {
      fs.rmSync(metadataPath, { force: true });
    }
  }
}
