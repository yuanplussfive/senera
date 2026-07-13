import type { Plugin } from "vite";
import {
  appearanceBootstrapScriptPlaceholder,
  createAppearanceBootstrapScript,
} from "../shared/theme/themeBootstrap";

export function appearanceBootstrapPlugin(): Plugin {
  return {
    name: "senera-appearance-bootstrap",
    transformIndexHtml(html) {
      return html.replace(
        appearanceBootstrapScriptPlaceholder,
        createAppearanceBootstrapScript(),
      );
    },
  };
}
