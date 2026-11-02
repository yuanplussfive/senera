/**
 * The desktop startup surface is `Frontend/public/startup.html`, shipped as
 * `Frontend/dist/startup.html` and loaded before the server is ready. The window
 * cannot take its pre-paint background from that document, so the canvas color is
 * mirrored here and checked against the palette and the document by
 * `Scripts/VerifyDesktopStartupSurface.ts`.
 */
export type DesktopStartupTheme = "light" | "dark";

/** Classic palette `--theme-bg`, per theme. */
const DesktopStartupCanvasColors: Record<DesktopStartupTheme, string> = {
  light: "#f9fafb",
  dark: "#111827",
};

export function resolveDesktopStartupTheme(systemPrefersDark: boolean): DesktopStartupTheme {
  return systemPrefersDark ? "dark" : "light";
}

export function readDesktopStartupCanvasColor(theme: DesktopStartupTheme): string {
  return DesktopStartupCanvasColors[theme];
}
