import fs from "node:fs/promises";
import path from "node:path";
import { brotliCompress, constants, gzip } from "node:zlib";
import type { Plugin, ResolvedConfig } from "vite";
import {
  AgentStaticAssetEncodingVariants,
  readAgentStaticAssetSidecarSuffix,
  shouldPrecompressAgentStaticAsset,
  type AgentStaticAssetContentEncoding,
} from "../../../Source/AgentSystem/WebSocket/AgentStaticAssetEncoding";

const compressionOptions = {
  br: {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: 9,
    },
  },
  gzip: { level: 9 },
} as const;

export function staticAssetCompressionPlugin(): Plugin {
  let resolvedConfig: ResolvedConfig | undefined;
  return {
    name: "senera-static-asset-compression",
    apply: "build",
    configResolved(config) {
      resolvedConfig = config;
    },
    async closeBundle() {
      if (!resolvedConfig) return;
      const outputDirectory = path.resolve(resolvedConfig.root, resolvedConfig.build.outDir);
      const files = await walkFiles(outputDirectory);
      let emittedAssets = 0;
      let emittedBytes = 0;
      for (const filePath of files) {
        const source = await fs.readFile(filePath);
        if (!shouldPrecompressAgentStaticAsset(filePath, source.byteLength)) continue;
        for (const { contentEncoding } of AgentStaticAssetEncodingVariants) {
          const compressed = await compressStaticAsset(source, contentEncoding);
          const targetPath = `${filePath}${readAgentStaticAssetSidecarSuffix(contentEncoding)}`;
          if (compressed.byteLength >= source.byteLength) {
            await fs.rm(targetPath, { force: true });
            continue;
          }
          await fs.writeFile(targetPath, compressed);
          emittedAssets += 1;
          emittedBytes += compressed.byteLength;
        }
      }
      resolvedConfig.logger.info(
        `[senera] generated ${emittedAssets} precompressed frontend assets (${formatByteLength(emittedBytes)})`,
      );
    },
  };
}

async function walkFiles(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const entryPath = path.join(directory, entry.name);
      return entry.isDirectory() ? walkFiles(entryPath) : Promise.resolve([entryPath]);
    }),
  );
  return nested.flat().sort((left, right) => left.localeCompare(right));
}

function compressStaticAsset(source: Buffer, contentEncoding: AgentStaticAssetContentEncoding): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const callback = (error: Error | null, result: Buffer): void => (error ? reject(error) : resolve(result));
    if (contentEncoding === "br") {
      brotliCompress(source, compressionOptions.br, callback);
      return;
    }
    gzip(source, compressionOptions.gzip, callback);
  });
}

function formatByteLength(byteLength: number): string {
  return `${(byteLength / 1024).toFixed(1)} KiB`;
}
