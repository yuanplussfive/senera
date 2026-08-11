import { useEffect } from "react";
import type { GlobalProvider, GlobalState } from "@ladle/react";
import "../src/index.css";
import {
  createAppearanceTokens,
  defaultAppearancePreference,
  readSystemTheme,
  type ResolvedTheme,
} from "../src/shared/theme/themeModel";

export const Provider: GlobalProvider = ({ children, globalState }) => {
  const resolvedTheme = resolveLadleTheme(globalState.theme);

  useEffect(() => {
    const tokens = createAppearanceTokens(defaultAppearancePreference, resolvedTheme);

    Object.entries(tokens.dataset).forEach(([key, value]) => {
      document.documentElement.setAttribute(`data-${key.replace(/([A-Z])/g, "-$1").toLowerCase()}`, String(value));
    });

    Object.entries(tokens.cssVariables).forEach(([key, value]) => {
      document.documentElement.style.setProperty(key, value);
    });
  }, [resolvedTheme]);

  return <>{children}</>;
};

function resolveLadleTheme(theme: GlobalState["theme"]): ResolvedTheme {
  if (theme === "dark") return "dark";
  if (theme === "auto") return readSystemTheme(window.matchMedia?.bind(window));
  return "light";
}
