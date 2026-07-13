import { useEffect } from "react";
import type { GlobalProvider } from "@ladle/react";
import "../src/index.css";
import { createAppearanceTokens, defaultAppearancePreference } from "../src/shared/theme/themeModel";

export const Provider: GlobalProvider = ({ children }) => {
  useEffect(() => {
    const tokens = createAppearanceTokens(defaultAppearancePreference, "light");

    Object.entries(tokens.dataset).forEach(([key, value]) => {
      document.documentElement.setAttribute(`data-${key.replace(/([A-Z])/g, "-$1").toLowerCase()}`, String(value));
    });

    Object.entries(tokens.cssVariables).forEach(([key, value]) => {
      document.documentElement.style.setProperty(key, value);
    });
  }, []);

  return <>{children}</>;
};
