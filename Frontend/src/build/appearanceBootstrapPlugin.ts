import type { Plugin } from "vite";
import { transformSync } from "esbuild";
import { appearanceBootstrapScriptPlaceholder, createAppearanceBootstrapScript } from "../shared/theme/themeBootstrap";

export function appearanceBootstrapPlugin(): Plugin {
  return {
    name: "senera-appearance-bootstrap",
    transformIndexHtml(html) {
      const bootstrapScript = transformSync(createAppearanceBootstrapScript(), {
        minify: true,
        target: "es2020",
      }).code;
      return html.replace(appearanceBootstrapScriptPlaceholder, bootstrapScript);
    },
  };
}
