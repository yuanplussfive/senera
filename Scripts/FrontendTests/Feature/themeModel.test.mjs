import { describe, expect, it } from "vitest";
import {
  accentColors,
  createAppearanceSnapshot,
  defaultAppearancePreference,
  normalizeAppearancePreference,
  readResolvedAppearance,
  resolveThemeMode,
} from "../../../Frontend/src/shared/theme/themeModel.ts";

const expectedAccentTokens = {
  terra: {
    light: {
      "--color-accent-50": "252 244 239",
      "--color-accent-500": "180 93 64",
      "--color-accent-700": "132 64 43",
      "--color-accent-contrast": "255 255 255",
    },
    dark: {
      "--color-accent-50": "71 51 39",
      "--color-accent-500": "222 142 108",
      "--color-accent-700": "240 180 151",
      "--color-accent-contrast": "24 25 28",
    },
  },
  violet: {
    light: {
      "--color-accent-50": "245 241 255",
      "--color-accent-500": "107 83 177",
      "--color-accent-700": "62 48 112",
      "--color-accent-contrast": "255 255 255",
    },
    dark: {
      "--color-accent-50": "48 41 73",
      "--color-accent-500": "188 165 250",
      "--color-accent-700": "226 216 255",
      "--color-accent-contrast": "24 25 28",
    },
  },
  moss: {
    light: {
      "--color-accent-50": "240 243 235",
      "--color-accent-500": "90 125 76",
      "--color-accent-700": "51 74 43",
      "--color-accent-contrast": "255 255 255",
    },
    dark: {
      "--color-accent-50": "31 48 38",
      "--color-accent-500": "154 189 133",
      "--color-accent-700": "210 232 189",
      "--color-accent-contrast": "24 25 28",
    },
  },
  sky: {
    light: {
      "--color-accent-50": "239 246 255",
      "--color-accent-500": "59 130 246",
      "--color-accent-700": "29 78 216",
      "--color-accent-contrast": "24 25 28",
    },
    dark: {
      "--color-accent-50": "30 58 138",
      "--color-accent-500": "96 165 250",
      "--color-accent-700": "191 219 254",
      "--color-accent-contrast": "24 25 28",
    },
  },
};

describe("themeModel", () => {
  it("normalizes partial stored appearance preferences", () => {
    expect(
      normalizeAppearancePreference({
        themeMode: "dark",
        colorScheme: "nordic",
        accentColor: "sky",
        fontFamily: "system",
        fontScale: "large",
      }),
    ).toEqual({
      themeMode: "dark",
      colorScheme: "nordic",
      accentColor: "sky",
      fontFamily: "system",
      fontScale: "large",
    });
    expect(
      normalizeAppearancePreference({
        themeMode: "sepia",
        colorScheme: "unknown",
        accentColor: "hotpink",
        fontFamily: "comic",
        fontScale: "huge",
      }),
    ).toEqual(defaultAppearancePreference);
  });
  it("resolves system theme mode from the current system theme", () => {
    expect(resolveThemeMode("light", "dark")).toBe("light");
    expect(resolveThemeMode("dark", "light")).toBe("dark");
    expect(resolveThemeMode("system", "dark")).toBe("dark");
  });
  it("creates a snapshot with resolved token metadata", () => {
    const snapshot = createAppearanceSnapshot({
      preference: {
        themeMode: "system",
        colorScheme: "nordic",
        accentColor: "sky",
        fontFamily: "system",
        fontScale: "comfortable",
      },
      systemTheme: "dark",
    });
    expect(snapshot).toMatchObject({
      preference: {
        themeMode: "system",
        colorScheme: "nordic",
        accentColor: "sky",
        fontFamily: "system",
        fontScale: "comfortable",
      },
      resolvedTheme: "dark",
      systemTheme: "dark",
    });
    expect(snapshot.tokens.dataset.theme).toBe("dark");
    expect(snapshot.tokens.dataset.colorScheme).toBe("nordic");
    expect(snapshot.tokens.dataset.accentColor).toBe("sky");
    expect(snapshot.tokens.cssVariables["--theme-font-scale"]).toBe("1.04");
    expect(snapshot.tokens.cssVariables).toEqual(
      expect.objectContaining({
        "--theme-chat-user-bg": expect.any(String),
        "--theme-chat-user-fg": expect.any(String),
        "--theme-chat-user-hover-bg": expect.any(String),
        "--theme-chat-composer-bg": expect.any(String),
        "--theme-chat-composer-focus-bg": expect.any(String),
        "--theme-session-active-bg": expect.any(String),
        "--theme-code-editor-bg": expect.any(String),
        "--theme-code-editor-fg": expect.any(String),
        "--theme-code-editor-gutter-bg": expect.any(String),
        "--theme-code-editor-gutter-border": expect.any(String),
        "--theme-code-editor-gutter-fg": expect.any(String),
        "--theme-code-editor-active-line-bg": expect.any(String),
        "--theme-code-editor-active-gutter-bg": expect.any(String),
        "--theme-code-editor-active-gutter-fg": expect.any(String),
        "--theme-code-editor-selection-bg": expect.any(String),
        "--theme-code-editor-caret": expect.any(String),
        "--theme-code-token-keyword": expect.any(String),
        "--theme-code-token-string": expect.any(String),
        "--theme-code-token-property": expect.any(String),
        "--theme-code-token-literal": expect.any(String),
        "--theme-code-token-comment": expect.any(String),
        "--theme-code-token-name": expect.any(String),
        "--theme-code-token-punctuation": expect.any(String),
        "--theme-code-token-invalid": expect.any(String),
        "--theme-config-nav-bg": expect.any(String),
        "--theme-config-list-bg": expect.any(String),
        "--theme-config-header-bg": expect.any(String),
        "--theme-config-toolbar-bg": expect.any(String),
        "--theme-config-stage-bg": expect.any(String),
        "--theme-config-panel-bg": expect.any(String),
        "--theme-config-editor-loading-bg": expect.any(String),
        "--shadow-avatar-cropper": expect.any(String),
      }),
    );
  });
  it("exposes the Nordic cold-gray scheme from the optimized reference", () => {
    const snapshot = createAppearanceSnapshot({
      preference: {
        themeMode: "light",
        colorScheme: "nordic",
        accentColor: "sky",
        fontFamily: "brand",
        fontScale: "standard",
      },
      systemTheme: "dark",
    });
    expect(snapshot.resolvedTheme).toBe("light");
    expect(snapshot.tokens.dataset.colorScheme).toBe("nordic");
    expect(snapshot.tokens.dataset.accentColor).toBe("sky");
    expect(snapshot.tokens.cssVariables).toMatchObject({
      "--color-paper-50": "255 255 255",
      "--color-paper-100": "248 249 251",
      "--color-ink-900": "59 66 82",
      "--color-accent-400": "96 165 250",
      "--color-accent-500": "59 130 246",
      "--color-accent-600": "37 99 235",
      "--color-terra-500": "var(--color-accent-500)",
      "--theme-bg": "rgb(248 249 251)",
      "--theme-sidebar-bg": "rgb(236 239 244)",
      "--theme-elevated-bg": "rgb(255 255 255)",
      "--theme-border": "rgb(229 233 240)",
      "--theme-hover-wash": "var(--surface-hover)",
      "--theme-chat-user-bg": "rgb(var(--color-paper-200))",
      "--theme-chat-user-fg": "rgb(var(--color-ink-900))",
      "--theme-chat-user-hover-bg": "rgb(var(--color-paper-300) / 0.80)",
      "--scrollbar-thumb": "rgb(43 40 32 / 0.15)",
    });
  });
  it("derives interactive semantic roles from every accent palette", () => {
    for (const themeMode of ["light", "dark"]) {
      for (const accentColor of accentColors) {
        const snapshot = createAppearanceSnapshot({
          preference: {
            ...defaultAppearancePreference,
            themeMode,
            accentColor,
          },
          systemTheme: themeMode === "dark" ? "light" : "dark",
        });

        expect(snapshot.tokens.cssVariables).toMatchObject({
          ...expectedAccentTokens[accentColor][themeMode],
          "--color-terra-50": "var(--color-accent-50)",
          "--color-terra-500": "var(--color-accent-500)",
          "--color-terra-700": "var(--color-accent-700)",
          "--accent-solid": "rgb(var(--color-accent-500))",
          "--accent-solid-hover": "rgb(var(--color-accent-600))",
          "--accent-solid-pressed": "rgb(var(--color-accent-700))",
          "--accent-content-hover": "rgb(var(--color-accent-600))",
          "--accent-surface":
            themeMode === "dark" ? "rgb(var(--color-accent-500) / 0.14)" : "rgb(var(--color-accent-50))",
          "--accent-surface-hover":
            themeMode === "dark" ? "rgb(var(--color-accent-500) / 0.22)" : "rgb(var(--color-accent-100))",
          "--accent-border":
            themeMode === "dark" ? "rgb(var(--color-accent-400) / 0.40)" : "rgb(var(--color-accent-200))",
          "--accent-border-strong":
            themeMode === "dark" ? "rgb(var(--color-accent-400) / 0.68)" : "rgb(var(--color-accent-300))",
          "--accent-focus-ring":
            themeMode === "dark" ? "rgb(var(--color-accent-400) / 0.58)" : "rgb(var(--color-accent-200) / 0.70)",
          "--accent-on-solid": "rgb(var(--color-accent-contrast))",
          "--theme-accent-soft": "var(--accent-surface)",
          "--theme-hover-wash": "var(--surface-hover)",
          "--theme-selection-bg":
            themeMode === "dark" ? "rgb(var(--color-accent-500) / 0.26)" : "rgb(var(--color-accent-500) / 0.18)",
          "--theme-session-active-bg": "var(--accent-surface)",
        });
      }
    }
  });
  it("uses the neutral Senera palette as the default light appearance", () => {
    const snapshot = createAppearanceSnapshot({
      preference: {
        ...defaultAppearancePreference,
        themeMode: "light",
      },
      systemTheme: "dark",
    });
    expect(defaultAppearancePreference.colorScheme).toBe("senera");
    expect(snapshot.tokens.cssVariables).toMatchObject({
      "--color-paper-50": "255 255 255",
      "--color-paper-100": "247 247 248",
      "--color-accent-500": "180 93 64",
      "--color-terra-500": "var(--color-accent-500)",
      "--theme-bg": "rgb(247 247 248)",
      "--theme-sidebar-bg": "rgb(245 246 247)",
      "--theme-elevated-bg": "rgb(255 255 255)",
      "--theme-border": "rgb(222 224 228)",
      "--theme-chat-user-bg": "rgb(var(--color-paper-200))",
      "--theme-chat-user-fg": "rgb(var(--color-ink-900))",
      "--theme-chat-user-hover-bg": "rgb(var(--color-paper-300) / 0.80)",
      "--theme-chat-user-font-size": "14.5px",
      "--theme-chat-user-line-height": "1.55",
      "--theme-chat-assistant-font-size": "15px",
      "--theme-chat-assistant-line-height": "1.75",
    });
  });
  it("uses a neutral charcoal Senera palette as the default dark appearance", () => {
    const snapshot = createAppearanceSnapshot({
      preference: {
        ...defaultAppearancePreference,
        themeMode: "dark",
      },
      systemTheme: "light",
    });
    expect(snapshot.tokens.cssVariables).toMatchObject({
      "--theme-bg": "rgb(28 29 32)",
      "--theme-sidebar-bg": "rgb(23 24 27)",
      "--theme-elevated-bg": "rgb(36 37 40)",
      "--theme-border": "rgb(55 56 61)",
      "--theme-chat-user-bg": "rgb(var(--color-paper-200))",
      "--theme-chat-user-fg": "rgb(var(--color-ink-950))",
      "--theme-chat-user-hover-bg": "rgb(var(--color-paper-300))",
      "--color-accent-500": "222 142 108",
      "--color-terra-500": "var(--color-accent-500)",
      "--theme-chat-user-font-size": "14.5px",
      "--theme-chat-user-line-height": "1.55",
      "--theme-chat-assistant-font-size": "15px",
      "--theme-chat-assistant-line-height": "1.75",
    });
  });
  it("keeps the expanded schemes on complete semantic surface tokens", () => {
    const cases = [
      {
        scheme: "monochrome",
        themeMode: "dark",
        expected: {
          "--theme-bg": "rgb(10 10 10)",
          "--theme-sidebar-bg": "rgb(0 0 0)",
          "--theme-elevated-bg": "rgb(23 23 23)",
          "--theme-border": "rgb(38 38 38)",
        },
      },
      {
        scheme: "sepia",
        themeMode: "light",
        expected: {
          "--theme-bg": "rgb(238 232 213)",
          "--theme-sidebar-bg": "rgb(220 214 196)",
          "--theme-elevated-bg": "rgb(253 246 227)",
          "--theme-border": "rgb(202 196 179)",
        },
      },
      {
        scheme: "lavender",
        themeMode: "light",
        expected: {
          "--theme-bg": "rgb(250 248 252)",
          "--theme-sidebar-bg": "rgb(243 239 248)",
          "--theme-elevated-bg": "rgb(255 255 255)",
          "--theme-border": "rgb(230 223 238)",
        },
      },
      {
        scheme: "ocean",
        themeMode: "dark",
        expected: {
          "--theme-bg": "rgb(10 25 41)",
          "--theme-sidebar-bg": "rgb(15 35 56)",
          "--theme-elevated-bg": "rgb(21 52 87)",
          "--theme-border": "rgb(34 77 122)",
        },
      },
    ];

    for (const { scheme, themeMode, expected } of cases) {
      const snapshot = createAppearanceSnapshot({
        preference: {
          ...defaultAppearancePreference,
          themeMode,
          colorScheme: scheme,
        },
        systemTheme: themeMode === "dark" ? "light" : "dark",
      });
      expect(snapshot.tokens.cssVariables).toMatchObject({
        ...expected,
        "--theme-chat-user-bg": "rgb(var(--color-paper-200))",
      });
    }
  });
  it("reads resolved appearance from stored JSON and system theme", () => {
    const storage = new Map([
      ["senera.appearancePreference", JSON.stringify({ themeMode: "dark", fontScale: "compact" })],
    ]);
    const snapshot = readResolvedAppearance({
      readStorageValue: (key) => storage.get(key) ?? null,
      readSystemTheme: () => "light",
    });
    expect(snapshot.preference.themeMode).toBe("dark");
    expect(snapshot.preference.fontScale).toBe("compact");
    expect(snapshot.resolvedTheme).toBe("dark");
  });
});
