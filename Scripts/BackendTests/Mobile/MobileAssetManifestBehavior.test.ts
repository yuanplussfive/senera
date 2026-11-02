import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { build } from "vite";
import { expect, it } from "vitest";
import {
  MobileAssetManifestFile,
  mobileAssetManifestPlugins,
} from "../../../Frontend/src/build/mobileAssetManifestPlugin.js";

it.each(["/", "./"])(
  "packages console and QQ lazy dependencies with base %s without unrelated entries",
  async (base) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "senera-mobile-assets-"));
    try {
      await mkdir(path.join(root, "src"));
      await Promise.all([
        writeFile(path.join(root, "src/console.js"), 'void import("./appearance.css"); void import("./feature.js");'),
        writeFile(path.join(root, "src/mobile.js"), 'void import("./console.js");'),
        writeFile(path.join(root, "src/qq.js"), 'void import("./qq-feature.js");'),
        writeFile(path.join(root, "src/qq-feature.js"), 'import "./qq.css"; console.log("qq ready");'),
        writeFile(path.join(root, "src/qq.css"), ".qq{color:blue}"),
        writeFile(
          path.join(root, "src/feature.js"),
          'import Worker from "./document.worker.js?worker"; void import("./feature.css"); new Worker();',
        ),
        writeFile(path.join(root, "src/document.worker.js"), 'self.onmessage = () => self.postMessage("ready");'),
        writeFile(path.join(root, "src/appearance.css"), '@font-face{font-family:Test;src:url("./font.woff2")}'),
        writeFile(path.join(root, "src/feature.css"), '.feature{background-image:url("./image.png")}'),
        writeFile(path.join(root, "src/font.woff2"), new Uint8Array([1, 2, 3, 4])),
        writeFile(path.join(root, "src/image.png"), new Uint8Array([5, 6, 7, 8])),
        writeFile(path.join(root, "src/unrelated.js"), 'import "./unrelated.css"; console.log("unrelated");'),
        writeFile(path.join(root, "src/unrelated.css"), ".unrelated{color:red}"),
      ]);
      await build({
        root,
        base,
        configFile: false,
        logLevel: "silent",
        plugins: mobileAssetManifestPlugins(["console-entry", "mobile-entry", "qq-entry"]),
        build: {
          assetsInlineLimit: 0,
          rollupOptions: {
            input: {
              "console-entry": path.join(root, "src/console.js"),
              "mobile-entry": path.join(root, "src/mobile.js"),
              "qq-entry": path.join(root, "src/qq.js"),
              unrelated: path.join(root, "src/unrelated.js"),
            },
          },
        },
      });
      const files = JSON.parse(await readFile(path.join(root, "dist", MobileAssetManifestFile), "utf8")) as string[];
      expect(files).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/appearance-.*\.css$/u),
          expect.stringMatching(/feature-.*\.css$/u),
          expect.stringMatching(/font-.*\.woff2$/u),
          expect.stringMatching(/image-.*\.png$/u),
          expect.stringMatching(/document.worker-.*\.js$/u),
          expect.stringMatching(/qq-.*\.css$/u),
          expect.stringMatching(/qq-feature-.*\.js$/u),
        ]),
      );
      expect(files.some((file) => file.includes("unrelated"))).toBe(false);
      for (const file of files) await expect(readFile(path.join(root, "dist", file))).resolves.toBeInstanceOf(Buffer);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
