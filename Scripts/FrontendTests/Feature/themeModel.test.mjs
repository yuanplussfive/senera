import { describe, expect, it } from "vitest";
import {
  accentColors,
  colorSchemes,
  createAppearanceSnapshot,
  createAppearanceTokens,
  defaultAppearancePreference,
  normalizeAppearancePreference,
  readResolvedAppearance,
  resolveThemeMode,
} from "../../../Frontend/src/shared/theme/themeModel.ts";

const expectedSchemeSurfaces = {
  senera: { light: ["rgb(248 248 246)", "rgb(244 244 241)"], dark: ["rgb(38 36 31)", "rgb(33 32 27)"] },
  classic: { light: ["rgb(249 250 251)", "rgb(243 244 246)"], dark: ["rgb(17 24 39)", "rgb(11 15 25)"] },
  mono: { light: ["rgb(245 245 245)", "rgb(229 229 229)"], dark: ["rgb(10 10 10)", "rgb(0 0 0)"] },
  forest: { light: ["rgb(245 247 245)", "rgb(238 241 238)"], dark: ["rgb(27 34 29)", "rgb(35 43 37)"] },
  sakura: { light: ["rgb(253 246 245)", "rgb(249 241 241)"], dark: ["rgb(40 35 34)", "rgb(35 30 29)"] },
  ocean: { light: ["rgb(243 249 252)", "rgb(239 244 247)"], dark: ["rgb(33 37 39)", "rgb(28 32 34)"] },
  lavender: { light: ["rgb(248 247 252)", "rgb(244 242 248)"], dark: ["rgb(37 35 39)", "rgb(31 30 34)"] },
  matcha: { light: ["rgb(247 249 241)", "rgb(243 244 237)"], dark: ["rgb(36 37 32)", "rgb(30 32 27)"] },
  honey: { light: ["rgb(252 247 239)", "rgb(248 243 234)"], dark: ["rgb(39 36 30)", "rgb(34 31 25)"] },
  celadon: { light: ["rgb(242 249 248)", "rgb(238 245 244)"], dark: ["rgb(32 37 37)", "rgb(27 32 32)"] },
};

const expectedAccent500 = {
  terra: { light: "180 93 64", dark: "222 142 108" },
  sky: { light: "59 130 246", dark: "96 165 250" },
  moss: { light: "90 125 76", dark: "154 189 133" },
  violet: { light: "107 83 177", dark: "188 165 250" },
  rose: { light: "176 92 101", dark: "225 135 144" },
  apricot: { light: "167 103 62", dark: "215 147 105" },
  jade: { light: "47 128 124", dark: "103 181 176" },
};

describe("themeModel", () => {
  it("normalizes current and legacy stored appearance preferences", () => {
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
      colorScheme: "classic",
      accentColor: "sky",
      fontFamily: "system",
      fontScale: "large",
    });
    expect(normalizeAppearancePreference({ colorScheme: "monochrome" }).colorScheme).toBe("mono");
    expect(normalizeAppearancePreference({ colorScheme: "sepia" }).colorScheme).toBe("honey");
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

  it("uses cold gray and sky as the default appearance", () => {
    expect(defaultAppearancePreference).toEqual({
      themeMode: "system",
      colorScheme: "classic",
      accentColor: "sky",
      fontFamily: "brand",
      fontScale: "standard",
    });
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
      preference: { colorScheme: "classic", accentColor: "sky" },
      resolvedTheme: "dark",
      systemTheme: "dark",
    });
    expect(snapshot.tokens.dataset).toMatchObject({
      theme: "dark",
      colorScheme: "classic",
      accentColor: "sky",
    });
    expect(snapshot.tokens.cssVariables).toEqual(
      expect.objectContaining({
        "--theme-font-scale": "1.04",
        "--theme-chat-user-bg": expect.any(String),
        "--theme-chat-composer-bg": expect.any(String),
        "--theme-code-editor-bg": expect.any(String),
        "--theme-config-panel-bg": "rgb(var(--color-paper-50))",
        "--surface-canvas": "var(--theme-bg)",
        "--content-primary": "rgb(var(--color-ink-900))",
        "--accent-solid": "rgb(var(--color-accent-500))",
      }),
    );
  });

  it("provides complete light and dark surfaces for all ten schemes", () => {
    expect(colorSchemes).toHaveLength(10);
    for (const scheme of colorSchemes) {
      for (const themeMode of ["light", "dark"]) {
        const tokens = createAppearanceTokens({ ...defaultAppearancePreference, colorScheme: scheme }, themeMode);
        expect(tokens.cssVariables).toMatchObject({
          "--theme-bg": expectedSchemeSurfaces[scheme][themeMode][0],
          "--theme-sidebar-bg": expectedSchemeSurfaces[scheme][themeMode][1],
          "--theme-elevated-bg": expect.any(String),
          "--theme-border": expect.any(String),
          "--theme-code-editor-bg": expect.any(String),
          "--theme-code-editor-fg": expect.any(String),
          "--theme-code-preview-bg": expect.any(String),
          "--theme-canvas-grid": expect.any(String),
        });
      }
    }
  });

  it("provides all seven independent accent palettes", () => {
    expect(accentColors).toHaveLength(7);
    for (const accentColor of accentColors) {
      for (const themeMode of ["light", "dark"]) {
        const tokens = createAppearanceTokens({ ...defaultAppearancePreference, accentColor }, themeMode).cssVariables;
        expect(tokens).toMatchObject({
          "--color-accent-500": expectedAccent500[accentColor][themeMode],
          "--color-terra-500": "var(--color-accent-500)",
          "--accent-content": "rgb(var(--color-accent-700))",
          "--accent-on-solid": "rgb(var(--color-accent-contrast))",
          "--theme-session-active-bg": "var(--accent-surface)",
        });
      }
    }
  });

  it("keeps required text and controls above WCAG AA across every supported combination", () => {
    for (const colorScheme of colorSchemes) {
      for (const accentColor of accentColors) {
        for (const themeMode of ["light", "dark"]) {
          const variables = createAppearanceTokens(
            { ...defaultAppearancePreference, colorScheme, accentColor },
            themeMode,
          ).cssVariables;
          const cases = [
            ["primary", "--content-primary", "--surface-canvas", "--theme-bg"],
            ["secondary", "--content-secondary", "--surface-canvas", "--theme-bg"],
            ["user", "--theme-chat-user-fg", "--theme-chat-user-bg", "--theme-bg"],
            ["code", "--theme-code-editor-fg", "--theme-code-editor-bg", "--theme-bg"],
            ["accent solid", "--accent-on-solid", "--accent-solid", "--surface-panel"],
          ];
          for (const [label, foreground, background, base] of cases) {
            expect(
              contrastRatio(
                readColor(variables[foreground], variables),
                readColor(variables[background], variables),
                readColor(variables[base], variables),
              ),
              `${colorScheme}/${accentColor}/${themeMode} ${label}`,
            ).toBeGreaterThanOrEqual(4.5);
          }
          expect(
            contrastRatio(
              readColor(`rgb(${variables["--color-ink-500"]})`, variables),
              readColor(`rgb(${variables["--color-paper-100"]})`, variables),
              [255, 255, 255, 1],
            ),
            `${colorScheme}/${themeMode} ink-500`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it("reads resolved appearance from stored JSON and system theme", () => {
    const storage = new Map([
      ["senera.appearancePreference", JSON.stringify({ themeMode: "dark", colorScheme: "sepia" })],
    ]);
    const snapshot = readResolvedAppearance({
      readStorageValue: (key) => storage.get(key) ?? null,
      readSystemTheme: () => "light",
    });
    expect(snapshot.preference).toMatchObject({ themeMode: "dark", colorScheme: "honey" });
    expect(snapshot.resolvedTheme).toBe("dark");
  });
});

function readColor(value, variables, depth = 0) {
  if (depth > 20) throw new Error(`CSS variable cycle: ${value}`);
  const expanded = value.replace(/var\((--[\w-]+)\)/g, (_match, key) =>
    readRawValue(variables[key], variables, depth + 1),
  );
  const match = expanded.match(/^rgb\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\s*\)$/);
  if (!match) throw new Error(`Unsupported CSS color: ${value} -> ${expanded}`);
  return [Number(match[1]), Number(match[2]), Number(match[3]), match[4] === undefined ? 1 : Number(match[4])];
}

function readRawValue(value, variables, depth) {
  if (!value) throw new Error("Missing CSS variable value");
  return value.replace(/var\((--[\w-]+)\)/g, (_match, key) => readRawValue(variables[key], variables, depth + 1));
}

function contrastRatio(foreground, background, base) {
  const opaqueBackground = background[3] < 1 ? composite(background, base) : background;
  const opaqueForeground = foreground[3] < 1 ? composite(foreground, opaqueBackground) : foreground;
  const foregroundLuminance = luminance(opaqueForeground);
  const backgroundLuminance = luminance(opaqueBackground);
  return (
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  );
}

function composite(foreground, background) {
  const alpha = foreground[3] + background[3] * (1 - foreground[3]);
  return [
    (foreground[0] * foreground[3] + background[0] * background[3] * (1 - foreground[3])) / alpha,
    (foreground[1] * foreground[3] + background[1] * background[3] * (1 - foreground[3])) / alpha,
    (foreground[2] * foreground[3] + background[2] * background[3] * (1 - foreground[3])) / alpha,
    alpha,
  ];
}

function luminance(color) {
  const channel = (value) => {
    const normalized = value / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(color[0]) + 0.7152 * channel(color[1]) + 0.0722 * channel(color[2]);
}
