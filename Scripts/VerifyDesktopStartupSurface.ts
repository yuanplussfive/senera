import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { readDesktopStartupCanvasColor } from "../Apps/Desktop/DesktopStartupSurface.js";

/**
 * The startup surface is the first document the desktop paints, so its colors have
 * to come from the shipped design system rather than from a private palette. These
 * checks bind it to the classic palette, to the app icon, and to the window
 * background the main process sets before the document loads.
 */
const workspaceRoot = process.cwd();
const startupSurfaceSource = fs.readFileSync(path.join(workspaceRoot, "Frontend", "public", "startup.html"), "utf8");
const paletteSource = fs.readFileSync(
  path.join(workspaceRoot, "Frontend", "src", "shared", "theme", "themeData", "palettes", "classicPalette.ts"),
  "utf8",
);
const markSource = fs.readFileSync(path.join(workspaceRoot, "Apps", "Desktop", "Assets", "senera-icon.svg"), "utf8");

const PaletteByTheme = {
  light: {
    canvas: "#f9fafb",
    content: "#111827",
    secondary: "#5f697a",
    paletteInk650: "95 105 122",
    paletteThemeBg: "rgb(249 250 251)",
  },
  dark: {
    canvas: "#111827",
    content: "#f9fafb",
    secondary: "#bac2cd",
    paletteInk650: "186 194 205",
    paletteThemeBg: "rgb(17 24 39)",
  },
} as const;

for (const [theme, expected] of Object.entries(PaletteByTheme)) {
  const resolvedTheme = theme as keyof typeof PaletteByTheme;
  for (const [token, value] of [
    ["canvas", expected.canvas],
    ["content", expected.content],
    ["secondary", expected.secondary],
  ] as const) {
    assert.ok(
      startupSurfaceSource.includes(value),
      `Startup surface is missing the ${theme} ${token} value (${value}).`,
    );
  }
  assert.ok(
    paletteSource.includes(`"--theme-bg": "${expected.paletteThemeBg}"`),
    `classicPalette ${theme} --theme-bg changed; update Frontend/public/startup.html and Apps/Desktop/DesktopStartupSurface.ts.`,
  );
  assert.ok(
    paletteSource.includes(`"--color-ink-650": "${expected.paletteInk650}"`),
    `classicPalette ${theme} --color-ink-650 changed; update Frontend/public/startup.html.`,
  );
  assert.equal(
    readDesktopStartupCanvasColor(resolvedTheme),
    expected.canvas,
    `The window background must match the startup surface ${theme} canvas.`,
  );
}

assert.ok(startupSurfaceSource.includes("#7e67c2"), "Startup surface must use the brand mark violet.");
assert.ok(startupSurfaceSource.includes("#f6cf52"), "Startup surface must use the brand mark gold.");
assert.ok(
  startupSurfaceSource.includes("prefers-reduced-motion"),
  "Startup surface must stop the signal motion when the user asks for reduced motion.",
);
assert.ok(!/https?:\/\//u.test(startupSurfaceSource), "Startup surface must not reference remote resources.");
assert.ok(
  startupSurfaceSource.includes("prefers-color-scheme"),
  "Startup surface must follow the system appearance when no theme override is set.",
);

for (const path of [...markSource.matchAll(/ d="([^"]+)"/gu)].map((match) => match[1])) {
  assert.ok(
    startupSurfaceSource.includes(path),
    "Startup surface mark paths must stay identical to the shipped app icon.",
  );
}

console.log("Desktop startup surface verification passed.");
