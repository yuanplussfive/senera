import type { ResolvedTheme } from "../themeModel";

export type ThemeTokenSet<TToken extends string> = Record<ResolvedTheme, Record<TToken, string>>;
