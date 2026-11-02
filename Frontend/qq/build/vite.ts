import path from "node:path";
import { fileURLToPath } from "node:url";
import vue from "@vitejs/plugin-vue";
import yaml from "@modyfi/vite-plugin-yaml";
import { viteStaticCopy } from "vite-plugin-static-copy";
import type { PluginOption } from "vite";
import qfaceInfo from "../client/src/renderer/src/assets/img/qq-face/public/assets/qq_emoji/_index.json" with { type: "json" };
import { qqSourceFingerprint } from "./sources.js";
import { AgentQqClientBuild } from "../../../Source/AgentSystem/Channels/Client/AgentQqClientBuildContract.js";

export const qqClientRoot = fileURLToPath(new URL("../client/", import.meta.url));
const workspaceRoot = path.resolve(qqClientRoot, "../../..");

/** QQ development and optional releases reuse the application's build tooling. */
export function qqClientPlugins(assetDirectory: string): PluginOption[] {
  const renderer = path.join(qqClientRoot, "src/renderer");
  const targets = [{ src: `${renderer.replaceAll("\\", "/")}/public/*`, dest: assetDirectory }];
  for (const face of qfaceInfo) {
    for (const asset of face.assets) {
      if (asset.type === 2 || asset.type === 3) {
        targets.push({
          src: path.join(renderer, "src/assets/img/qq-face/public", asset.path).replaceAll("\\", "/"),
          dest: path.posix.join(assetDirectory, "img/qface"),
        });
      }
    }
  }
  let sourceFingerprint: string;
  return [
    vue(),
    yaml(),
    viteStaticCopy({ targets }),
    {
      name: "senera-qq-vue-runtime",
      config() {
        return {
          resolve: { dedupe: ["vue"] },
          optimizeDeps: { include: ["fake-qq-ui"] },
        };
      },
    },
    {
      name: "senera-qq-source-integrity",
      apply: "build",
      async buildStart() {
        sourceFingerprint = await qqSourceFingerprint(workspaceRoot);
      },
      async generateBundle() {
        if (sourceFingerprint !== (await qqSourceFingerprint(workspaceRoot))) {
          throw new Error("QQ client source changed during the build. Run the build again.");
        }
        this.emitFile({
          type: "asset",
          fileName: AgentQqClientBuild.integrityFile,
          source: JSON.stringify({ sourceFingerprint }),
        });
      },
    },
  ];
}

export const qqClientAliases = {
  "@renderer": path.join(qqClientRoot, "src/renderer/src"),
  "@senera-product": fileURLToPath(new URL("../product.ts", import.meta.url)),
};
