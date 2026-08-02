import { sync as spawnSync } from "cross-spawn";
import process from "node:process";
import { DesktopNativeModuleMaintenance } from "../../Build/DesktopNativeModuleMaintenance.js";

interface CommandInvocation {
  command: string;
  arguments: string[];
}

const setupSteps = [
  command("npm", ["run", "build"]),
  command("npm", ["--workspace", "senera-frontend", "run", "build"]),
];
const launchStep = command("electron", ["Dist/Apps/Desktop/Main.js"]);

void runDesktop().then(
  (exitCode) => {
    process.exitCode = exitCode;
  },
  (error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  },
);

async function runDesktop(): Promise<number> {
  const nativeMaintenance = new DesktopNativeModuleMaintenance(process.cwd());
  let exitCode = 0;
  let nativeDependenciesRequireRestore = false;
  await nativeMaintenance.ensureNodeCompatibility();
  try {
    for (const step of setupSteps) {
      const result = run(step);
      if (result !== 0) {
        exitCode = result;
        break;
      }
    }
    if (exitCode === 0) {
      await nativeMaintenance.rebuildForElectronCompatibility();
      nativeDependenciesRequireRestore = true;
      exitCode = run(launchStep);
    }
  } finally {
    if (nativeDependenciesRequireRestore) {
      await nativeMaintenance.restoreNodeCompatibility();
    }
  }
  return exitCode;
}

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
