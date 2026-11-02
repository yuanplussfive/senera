import crossSpawn from "cross-spawn";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { assertAndroidReleaseSigning } from "./AndroidBuildContract.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const { values } = parseArgs({
  options: { "from-build": { type: "boolean" }, release: { type: "boolean" }, abi: { type: "string" } },
});
if (values.release) assertAndroidReleaseSigning(process.env, "file");
const steps: [string, string[]][] = [
  ...(!values["from-build"] ? [["npm", ["--workspace", "senera-frontend", "run", "build"]] as [string, string[]]] : []),
  ["npm", ["--workspace", "senera-frontend", "run", "android:sync"]],
  [
    "tsx",
    [
      path.join(root, "Apps/Mobile/BuildAndroid.ts"),
      ...(values.release ? ["--release"] : []),
      ...(values.abi ? [`--abi=${values.abi}`] : []),
    ],
  ],
];
for (const [command, args] of steps) {
  const result = crossSpawn.sync(command, args, { cwd: root, stdio: "inherit", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
    break;
  }
}
