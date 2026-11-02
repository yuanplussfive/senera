import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { zipSync } from "fflate";
import { AgentQqClientBuild } from "../../../Source/AgentSystem/Channels/Client/AgentQqClientBuildContract.js";
import { AgentClientExtensionStore } from "../../../Source/AgentSystem/Channels/Client/AgentClientExtensionStore.js";
import { resolveAgentApplicationPaths } from "../../../Source/AgentSystem/Core/AgentApplicationPaths.js";
import {
  AgentClientExtensionManifestFile,
  AgentClientExtensionManifestSchema,
} from "../../../Source/AgentSystem/Channels/Client/AgentClientExtensionContract.js";

export function qqClientArchive(
  contents: Record<string, string> = {
    "qq/index.html":
      '<!doctype html><html><head></head><body>QQ client<script type="module" src="../assets/client.js"></script></body></html>',
    "assets/client.js": "window.clientLoaded = true;",
  },
) {
  const files = Object.entries(contents)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([file, text]) => ({ path: file, bytes: Buffer.byteLength(text), sha256: hash(text) }));
  const manifest = AgentClientExtensionManifestSchema.parse({
    protocol: 1,
    id: AgentQqClientBuild.id,
    name: AgentQqClientBuild.name,
    version: "1.0.0",
    revision: hash(JSON.stringify(files)),
    entry: AgentQqClientBuild.entryDocument,
    source: { url: "https://example.com/client-source.tar.gz", sha256: hash("source"), bytes: 6 },
    files,
  });
  const archive = Buffer.from(
    zipSync({
      [AgentClientExtensionManifestFile]: Buffer.from(JSON.stringify(manifest)),
      ...Object.fromEntries(Object.entries(contents).map(([file, text]) => [file, Buffer.from(text)])),
    }),
  );
  return { archive, manifest };
}

export async function prepareQqClientBuild(root: string): Promise<AgentClientExtensionStore> {
  const store = new AgentClientExtensionStore(resolveAgentApplicationPaths(root).clientExtensionsRoot);
  await store.install(AgentQqClientBuild.id, qqClientArchive().archive);
  // Development source-export fixtures still need corresponding source files.
  const source = path.join(root, "Frontend/qq/client");
  await fs.mkdir(source, { recursive: true });
  await fs.writeFile(path.join(source, "LICENSE"), "AGPL-3.0-only");
  await fs.writeFile(path.join(source, "NOTICE.md"), "Test source attribution");
  return store;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
