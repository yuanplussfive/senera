import type { FrontendMessageKey } from "../../../i18n/frontendMessageCatalog";
import type { AccentColor, ColorScheme } from "../themeModel";

export const colorSchemeGroups = [
  {
    get label() {
      return "appearance.group.original" as FrontendMessageKey;
    },
    items: ["senera", "classic", "mono", "forest"],
  },
  {
    get label() {
      return "appearance.group.new" as FrontendMessageKey;
    },
    items: ["sakura", "ocean", "lavender", "matcha", "honey", "celadon"],
  },
] as const satisfies readonly {
  label: string;
  items: readonly ColorScheme[];
}[];

export const recommendedAccentColors = {
  senera: "terra",
  classic: "sky",
  mono: "terra",
  forest: "moss",
  sakura: "rose",
  ocean: "sky",
  lavender: "violet",
  matcha: "moss",
  honey: "apricot",
  celadon: "jade",
} as const satisfies Record<ColorScheme, AccentColor>;

export const colorSchemeStories = {
  senera: "appearance.story.senera",
  classic: "appearance.story.classic",
  mono: "appearance.story.mono",
  forest: "appearance.story.forest",
  sakura: "appearance.story.sakura",
  ocean: "appearance.story.ocean",
  lavender: "appearance.story.lavender",
  matcha: "appearance.story.matcha",
  honey: "appearance.story.honey",
  celadon: "appearance.story.celadon",
} as const satisfies Record<ColorScheme, FrontendMessageKey>;

export const colorSchemeSwatches = {
  senera: {
    paper: ["255 255 255", "248 248 246", "239 238 235", "224 223 219", "199 197 189"],
    ink: ["43 40 32", "81 76 64", "115 112 95", "150 145 127", "186 181 166"],
    accent: ["246 226 214", "214 143 111", "180 93 64", "132 64 43"],
  },
  classic: {
    paper: ["255 255 255", "249 250 251", "243 244 246", "229 231 235", "209 213 219"],
    ink: ["17 24 39", "75 85 99", "107 114 128", "156 163 175", "209 213 219"],
    accent: ["219 234 254", "147 197 253", "59 130 246", "29 78 216"],
  },
  mono: {
    paper: ["255 255 255", "245 245 245", "229 229 229", "212 212 212", "163 163 163"],
    ink: ["23 23 23", "82 82 82", "115 115 115", "140 140 140", "190 190 190"],
    accent: ["246 226 214", "214 143 111", "180 93 64", "132 64 43"],
  },
  forest: {
    paper: ["255 255 255", "245 247 245", "232 236 232", "209 219 209", "177 194 177"],
    ink: ["36 43 36", "75 91 75", "99 112 99", "129 145 129", "177 194 177"],
    accent: ["219 226 203", "149 176 123", "90 125 76", "51 74 43"],
  },
  sakura: {
    paper: ["255 253 253", "253 246 245", "245 235 234", "232 219 218", "209 192 191"],
    ink: ["48 37 37", "87 72 72", "124 107 107", "159 140 140", "193 177 176"],
    accent: ["247 224 225", "213 139 146", "176 92 101", "129 63 71"],
  },
  ocean: {
    paper: ["252 254 255", "243 249 252", "232 239 243", "216 224 229", "187 199 205"],
    ink: ["34 41 46", "68 78 85", "102 113 122", "135 147 156", "172 183 191"],
    accent: ["219 234 254", "147 197 253", "59 130 246", "29 78 216"],
  },
  lavender: {
    paper: ["254 253 255", "248 247 252", "239 236 244", "224 221 230", "198 194 206"],
    ink: ["40 39 46", "77 75 85", "112 110 122", "145 143 156", "182 179 191"],
    accent: ["232 224 255", "177 153 236", "107 83 177", "62 48 112"],
  },
  matcha: {
    paper: ["253 254 249", "247 249 241", "237 239 229", "221 224 212", "195 199 183"],
    ink: ["42 40 31", "79 77 63", "115 112 96", "148 146 128", "184 182 167"],
    accent: ["219 226 203", "149 176 123", "90 125 76", "51 74 43"],
  },
  honey: {
    paper: ["255 253 250", "252 247 239", "243 237 226", "229 222 208", "206 195 177"],
    ink: ["47 38 30", "86 74 63", "122 109 95", "157 142 127", "191 179 166"],
    accent: ["244 227 217", "204 148 115", "167 103 62", "122 72 40"],
  },
  celadon: {
    paper: ["250 255 254", "242 249 248", "231 240 239", "214 225 224", "185 201 198"],
    ink: ["33 42 42", "67 79 80", "100 115 115", "133 149 149", "171 184 185"],
    accent: ["218 235 233", "114 176 171", "47 128 124", "30 94 90"],
  },
} as const satisfies Record<
  ColorScheme,
  { paper: readonly string[]; ink: readonly string[]; accent: readonly string[] }
>;
