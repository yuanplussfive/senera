import path from "node:path";

const AndroidReleaseSigningVariables = {
  keystore: "SENERA_ANDROID_KEYSTORE",
  storePassword: "SENERA_ANDROID_STORE_PASSWORD",
  keyAlias: "SENERA_ANDROID_KEY_ALIAS",
  keyPassword: "SENERA_ANDROID_KEY_PASSWORD",
} as const;

export function assertAndroidReleaseSigning(env: NodeJS.ProcessEnv, keystoreSource: "file" | "base64"): void {
  const variables = {
    ...AndroidReleaseSigningVariables,
    keystore:
      keystoreSource === "base64"
        ? `${AndroidReleaseSigningVariables.keystore}_BASE64`
        : AndroidReleaseSigningVariables.keystore,
  };
  const missing = Object.values(variables).filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new Error(`Android release signing is missing required configuration: ${missing.join(", ")}.`);
  }
}

export function resolveAndroidApkArtifact(
  version: string,
  variant: "debug" | "release",
  abis: readonly string[] = [],
): { name: string; path: string } {
  const architecture = abis.length > 0 ? abis.join("_") : "universal";
  const name = `Senera-${version}-android-${architecture}-${variant}.apk`;
  return { name, path: path.posix.join("Release", name) };
}
