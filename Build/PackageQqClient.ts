import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { zipSync, type Zippable } from "fflate";
import { create as createTar } from "tar";
import { collectQqSourceFiles, qqSourceFingerprint } from "../Frontend/qq/build/sources.js";
import {
  AgentClientExtensionManifestFile,
  AgentClientExtensionManifestSchema,
  AgentClientExtensionProtocol,
} from "../Source/AgentSystem/Channels/Client/AgentClientExtensionContract.js";
import { AgentQqClientBuild } from "../Source/AgentSystem/Channels/Client/AgentQqClientBuildContract.js";

import { readAgentProductMetadata } from "../Source/AgentSystem/Core/AgentProductMetadata.js";

const root = process.cwd();
const product = readAgentProductMetadata(root);
if (!product.updateOrigin)
  throw new Error("Configure the product update origin before packaging a distributable client.");
const directory = path.join(root, AgentQqClientBuild.outputDirectory);
const destination = path.join(root, "Release");
fs.mkdirSync(destination, { recursive: true });
const files: string[] = [];
function collect(current: string): void {
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name.endsWith(".map")) continue;
    const full = path.join(current, entry.name);
    if (entry.isDirectory()) collect(full);
    else if (entry.isFile()) files.push(path.relative(directory, full).split(path.sep).join("/"));
  }
}
collect(directory);
const assets = files.sort().map((file) => {
  const content = fs.readFileSync(path.join(directory, file));
  return { path: file, bytes: content.length, sha256: digest(content) };
});
const revision = digest(Buffer.from(JSON.stringify(assets)));
const sourceName = `${AgentQqClientBuild.artifactPrefix}-${product.version}-${revision.slice(0, 12)}-source.tar.gz`;
const sourcePath = path.join(destination, sourceName);
const fingerprint = await qqSourceFingerprint(root);
const buildIntegrity = JSON.parse(fs.readFileSync(path.join(directory, AgentQqClientBuild.integrityFile), "utf8")) as {
  sourceFingerprint?: string;
};
if (buildIntegrity.sourceFingerprint !== fingerprint)
  throw new Error("QQ source no longer matches the build. Run npm run client.qq.pack again.");
await createTar({ cwd: root, file: sourcePath, gzip: true, portable: true }, await collectQqSourceFiles(root));
if (fingerprint !== (await qqSourceFingerprint(root)))
  throw new Error("Source changed while building its client archive.");
const source = fs.readFileSync(sourcePath);
const manifest = AgentClientExtensionManifestSchema.parse({
  protocol: AgentClientExtensionProtocol,
  id: AgentQqClientBuild.id,
  name: AgentQqClientBuild.name,
  version: product.version,
  revision,
  entry: AgentQqClientBuild.entryDocument,
  source: {
    url: product.updateOrigin.releaseAssetUrl(`v${product.version}`, sourceName),
    sha256: digest(source),
    bytes: source.length,
  },
  files: assets,
});
const contents: Zippable = {
  [AgentClientExtensionManifestFile]: Buffer.from(JSON.stringify(manifest)),
};
for (const asset of assets) contents[asset.path] = fs.readFileSync(path.join(directory, asset.path));
const archive = zipSync(contents, { level: 6 });
const archiveName = `${AgentQqClientBuild.artifactPrefix}-${product.version}.zip`;
fs.writeFileSync(path.join(destination, archiveName), archive);
fs.writeFileSync(
  path.join(destination, `${AgentQqClientBuild.artifactPrefix}-${product.version}.json`),
  JSON.stringify(
    {
      ...manifest,
      archive: { name: archiveName, bytes: archive.length, sha256: digest(archive) },
    },
    null,
    2,
  ),
);
console.log(`Client extension: Release/${archiveName} (${(archive.length / 1048576).toFixed(2)} MiB)`);
console.log(`Corresponding source: Release/${sourceName}`);

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
