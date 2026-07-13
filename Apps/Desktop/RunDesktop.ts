import { sync as spawnSync } from "cross-spawn";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

interface CommandInvocation {
  command: string;
  arguments: string[];
}

const nativeModules = [
  "better-sqlite3",
];

const steps = [
  command("npm", ["run", "build"]),
  command("npm", ["--workspace", "senera-frontend", "run", "build"]),
  command("electron-builder", ["install-app-deps", "--platform=win32", "--arch=x64"]),
  command("electron", ["Dist/Apps/Desktop/Main.js"]),
];

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

process.exitCode = exitCode;

function run(invocation: CommandInvocation): number {
  console.log(`\n> ${[invocation.command, ...invocation.arguments].join(" ")}`);

  const result = spawnSync(invocation.command, invocation.arguments, {
    cwd: process.cwd(),
    stdio: "inherit",
    windowsHide: true,
  });

  if (result.error) {
    console.error(result.error);
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
