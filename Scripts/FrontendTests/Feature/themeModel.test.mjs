import { describe, expect, it } from "vitest";
import {
  createAppearanceSnapshot,
  defaultAppearancePreference,
  normalizeAppearancePreference,
  readResolvedAppearance,
  resolveThemeMode,
} from "../../../Frontend/src/shared/theme/themeModel.ts";
describe("themeModel", () => {
  it("normalizes partial stored appearance preferences", () => {
    expect(
      normalizeAppearancePreference({
        themeMode: "dark",
        colorScheme: "classic",
        accentColor: "sky",
        fontFamily: "system",
        fontScale: "large",
      }),
    ).toEqual({
      themeMode: "dark",
      colorScheme: "classic",
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
        colorScheme: "classic",
        accentColor: "sky",
        fontFamily: "system",
        fontScale: "comfortable",
      },
      systemTheme: "dark",
    });
    expect(snapshot).toMatchObject({
      preference: {
        themeMode: "system",
        colorScheme: "classic",
        accentColor: "sky",
        fontFamily: "system",
        fontScale: "comfortable",
      },
      resolvedTheme: "dark",
      systemTheme: "dark",
    });
    expect(snapshot.tokens.dataset.theme).toBe("dark");
    expect(snapshot.tokens.dataset.colorScheme).toBe("classic");
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
  it("exposes the cold gray classic scheme from the optimized reference", () => {
    const snapshot = createAppearanceSnapshot({
      preference: {
        themeMode: "light",
        colorScheme: "classic",
        accentColor: "sky",
        fontFamily: "brand",
        fontScale: "standard",
      },
      systemTheme: "dark",
    });
    expect(snapshot.resolvedTheme).toBe("light");
    expect(snapshot.tokens.dataset.colorScheme).toBe("classic");
    expect(snapshot.tokens.dataset.accentColor).toBe("sky");
    expect(snapshot.tokens.cssVariables).toMatchObject({
      "--color-paper-50": "255 255 255",
      "--color-paper-100": "249 250 251",
      "--color-ink-900": "17 24 39",
      "--color-terra-400": "96 165 250",
      "--color-terra-500": "59 130 246",
      "--color-terra-600": "37 99 235",
      "--theme-bg": "rgb(249 250 251)",
      "--theme-sidebar-bg": "rgb(243 244 246)",
      "--theme-elevated-bg": "rgb(255 255 255)",
      "--theme-border": "rgb(229 231 235)",
      "--theme-hover-wash": "rgb(17 24 39 / 0.055)",
      "--theme-chat-user-bg": "rgb(var(--color-paper-200))",
      "--theme-chat-user-fg": "rgb(var(--color-ink-900))",
      "--theme-chat-user-hover-bg": "rgb(var(--color-paper-300) / 0.80)",
      "--scrollbar-thumb": "rgb(17 24 39 / 0.15)",
    });
  });
  it("uses the Senera warm paper palette as the default light appearance", () => {
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
      "--color-paper-100": "248 248 246",
      "--color-terra-500": "180 93 64",
      "--theme-bg": "rgb(248 248 246)",
      "--theme-sidebar-bg": "rgb(244 244 241)",
      "--theme-elevated-bg": "rgb(255 255 255)",
      "--theme-border": "rgb(224 223 219)",
      "--theme-chat-user-bg": "rgb(var(--color-paper-200))",
      "--theme-chat-user-fg": "rgb(var(--color-ink-900))",
      "--theme-chat-user-hover-bg": "rgb(var(--color-paper-300) / 0.80)",
      "--theme-chat-user-font-size": "14.5px",
      "--theme-chat-user-line-height": "1.55",
      "--theme-chat-assistant-font-size": "15px",
      "--theme-chat-assistant-line-height": "1.75",
    });
  });
  it("uses a Senera dark paper bubble as the default dark appearance", () => {
    const snapshot = createAppearanceSnapshot({
      preference: {
        ...defaultAppearancePreference,
        themeMode: "dark",
      },
      systemTheme: "light",
    });
    expect(snapshot.tokens.cssVariables).toMatchObject({
      "--theme-bg": "rgb(38 36 31)",
      "--theme-sidebar-bg": "rgb(33 32 27)",
      "--theme-elevated-bg": "rgb(44 42 37)",
      "--theme-border": "rgb(61 57 47)",
      "--theme-chat-user-bg": "rgb(var(--color-paper-200))",
      "--theme-chat-user-fg": "rgb(var(--color-ink-950))",
      "--theme-chat-user-hover-bg": "rgb(var(--color-paper-300))",
      "--color-terra-500": "222 142 108",
      "--theme-chat-user-font-size": "14.5px",
      "--theme-chat-user-line-height": "1.55",
      "--theme-chat-assistant-font-size": "15px",
      "--theme-chat-assistant-line-height": "1.75",
    });
  });
  it("keeps mono and forest schemes on complete semantic surface tokens", () => {
    const mono = createAppearanceSnapshot({
      preference: {
        ...defaultAppearancePreference,
        themeMode: "dark",
        colorScheme: "mono",
      },
      systemTheme: "light",
    });
    const forest = createAppearanceSnapshot({
      preference: {
        ...defaultAppearancePreference,
        themeMode: "light",
        colorScheme: "forest",
      },
      systemTheme: "dark",
    });
    expect(mono.tokens.cssVariables).toMatchObject({
      "--theme-bg": "rgb(10 10 10)",
      "--theme-sidebar-bg": "rgb(0 0 0)",
      "--theme-elevated-bg": "rgb(23 23 23)",
      "--theme-border": "rgb(38 38 38)",
      "--theme-chat-user-bg": "rgb(var(--color-paper-200))",
    });
    expect(forest.tokens.cssVariables).toMatchObject({
      "--theme-bg": "rgb(245 247 245)",
      "--theme-sidebar-bg": "rgb(238 241 238)",
      "--theme-elevated-bg": "rgb(255 255 255)",
      "--theme-border": "rgb(209 219 209)",
      "--theme-chat-user-bg": "rgb(var(--color-paper-200))",
    });
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
