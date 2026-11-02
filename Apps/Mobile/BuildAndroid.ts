import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { assertAndroidReleaseSigning, resolveAndroidApkArtifact } from "./AndroidBuildContract.js";

const androidRoot = fileURLToPath(new URL("./android/", import.meta.url));
const root = path.resolve(androidRoot, "../../..");
const { values } = parseArgs({ options: { release: { type: "boolean" }, abi: { type: "string" } } });
const release = values.release;
const abis = values.abi?.split(",");
const supportedAbis = new Set(["arm64-v8a", "armeabi-v7a", "x86", "x86_64"]);
if (abis?.some((abi) => !supportedAbis.has(abi)))
  throw new Error("Unsupported Android ABI. Use arm64-v8a, armeabi-v7a, x86 or x86_64.");
if (release) assertAndroidReleaseSigning(process.env, "file");
const wrapper = path.join(androidRoot, process.platform === "win32" ? "gradlew.bat" : "gradlew");
const task = release ? "assembleRelease" : "assembleDebug";
const checks = release ? ":app:lintRelease" : ":app:lintDebug";
const arguments_ = [checks, task, "--console=plain", ...(abis ? [`-PseneraAbis=${abis.join(",")}`] : [])];
const child =
  process.platform === "win32"
    ? spawn("cmd.exe", ["/d", "/s", "/c", `""${wrapper}" ${arguments_.join(" ")}"`], {
        cwd: androidRoot,
        stdio: "inherit",
        windowsVerbatimArguments: true,
      })
    : spawn(wrapper, arguments_, { cwd: androidRoot, stdio: "inherit" });
child.once("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.once("exit", (code) => {
  if (code !== 0) {
    process.exitCode = code ?? 1;
    return;
  }
  const variant = release ? "release" : "debug";
  const source = path.join(
    androidRoot,
    "app/build/outputs/apk",
    variant,
    release ? "app-release.apk" : "app-debug.apk",
  );
  if (!fs.existsSync(source)) {
    throw new Error(
      "Android build did not produce a signed APK. Configure the release signing environment before building a release.",
    );
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as { version: string };
  const artifact = resolveAndroidApkArtifact(pkg.version, variant, abis);
  const target = path.resolve(root, artifact.path);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  console.log(`Android APK: ${target}`);
});
