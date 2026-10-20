import type { AgentToolPresentationIcon } from "../../../../Source/AgentSystem/Types/AgentToolPresentationTypes";
import type { AppIconName } from "../ui/AppIcon";

/**
 * These operation-specific glyphs intentionally live in the workflow adapter
 * so the shared first-paint catalog only contains general application chrome.
 */
export const AgentToolSpecificPresentationIcons = [
  "audio-lines",
  "cloud-sun",
  "computer-desktop",
  "file-search",
  "scan-search",
] as const satisfies readonly AgentToolPresentationIcon[];

type AgentToolSpecificPresentationIcon = (typeof AgentToolSpecificPresentationIcons)[number];

/**
 * The backend owns the semantic icon vocabulary. This adapter only selects
 * the corresponding product glyph, so features never infer meaning from
 * extension IDs, capabilities, or Tool names.
 */
export const AgentToolPresentationAppIcons = {
  tools: "tools",
  search: "search",
  blocks: "package",
  "list-checks": "list-checks",
  "file-text": "file-text",
  pencil: "pencil",
  terminal: "terminal",
  clock: "clock",
  activity: "activity",
  "git-branch": "git-branch",
  users: "users",
  brain: "brain",
  "book-open": "book-open",
  "calendar-clock": "calendar-clock",
  image: "image",
  "message-question": "message-question",
  globe: "globe",
  alert: "alert",
  answer: "answer",
  archive: "archive",
  "arrow-down": "arrow-down",
  "arrow-left": "arrow-left",
  "arrow-right": "arrow-right",
  ban: "ban",
  camera: "camera",
  cancel: "cancel",
  check: "check",
  "circle-dot": "circle-dot",
  close: "close",
  code: "code",
  "cpu-chip": "cpu-chip",
  delegation: "delegation",
  download: "download",
  "external-link": "external-link",
  eye: "eye",
  "file-audio": "file-audio",
  "file-code": "file-code",
  "file-json": "file-json",
  flag: "flag",
  folder: "folder",
  gauge: "gauge",
  history: "history",
  info: "info",
  input: "input",
  key: "key",
  lightbulb: "lightbulb",
  link: "link",
  list: "list",
  "list-tree": "list-tree",
  loading: "loading",
  maximize: "maximize",
  message: "message",
  minus: "minus",
  "new-session": "new-session",
  output: "output",
  "panel-right-close": "panel-right-close",
  "play-circle": "play-circle",
  plus: "plus",
  progress: "progress",
  puzzle: "puzzle",
  refresh: "refresh",
  restore: "restore",
  route: "route",
  save: "save",
  server: "server",
  settings: "settings",
  shield: "shield",
  split: "split",
  square: "square",
  stack: "stack",
  tag: "tag",
  target: "target",
  trash: "trash",
  undo: "undo",
  warning: "warning",
} as const satisfies Record<Exclude<AgentToolPresentationIcon, AgentToolSpecificPresentationIcon>, AppIconName>;

const appIconByPresentationIcon = new Map<string, AppIconName>(Object.entries(AgentToolPresentationAppIcons));

/** Resolves backend semantic presentation icons without exposing the map shape to callers. */
export function resolveAgentToolPresentationAppIcon(value: unknown): AppIconName | undefined {
  return typeof value === "string" ? appIconByPresentationIcon.get(value) : undefined;
}
