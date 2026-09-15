import type { ColorScheme } from "../themeModel";
import { celadonPalette } from "./palettes/celadonPalette";
import { classicPalette } from "./palettes/classicPalette";
import { forestPalette } from "./palettes/forestPalette";
import { honeyPalette } from "./palettes/honeyPalette";
import { lavenderPalette } from "./palettes/lavenderPalette";
import { matchaPalette } from "./palettes/matchaPalette";
import { monoPalette } from "./palettes/monoPalette";
import { oceanPalette } from "./palettes/oceanPalette";
import { sakuraPalette } from "./palettes/sakuraPalette";
import { seneraPalette } from "./palettes/seneraPalette";
import type { ThemeTokenSet } from "./themeTokenTypes";

export const paletteTokens = {
  senera: seneraPalette,
  classic: classicPalette,
  mono: monoPalette,
  forest: forestPalette,
  sakura: sakuraPalette,
  ocean: oceanPalette,
  lavender: lavenderPalette,
  matcha: matchaPalette,
  honey: honeyPalette,
  celadon: celadonPalette,
} as const satisfies Record<ColorScheme, ThemeTokenSet>;
