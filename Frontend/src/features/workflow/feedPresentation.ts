import type { AppIconName } from "../../shared/ui/AppIcon";
import type { FeedGroup, FeedItemKind } from "./feedModel";
import type { ToolStageIconName } from "./toolStageIconContract";

export type FeedGroupVariant = NonNullable<FeedGroup["variant"]>;

export const FeedItemIconCatalog = {
  activity: "activity",
  tool: "tools",
  trace: "git-branch",
} as const satisfies Record<FeedItemKind, AppIconName>;

export const FeedGroupIconCatalog = {
  activity: "activity",
  tools: "tools",
  delegation: "delegation",
  trace: "git-branch",
} as const satisfies Record<FeedGroupVariant, AppIconName>;

export const ToolStageIconCatalog = {
  tools: "tools",
  search: "search",
  blocks: "package",
  "file-text": "file-text",
  pencil: "pencil",
  terminal: "terminal",
  clock: "clock",
  activity: "activity",
  "git-branch": "git-branch",
  users: "users",
  brain: "brain",
  "calendar-clock": "calendar-clock",
  image: "image",
  "message-question": "message-question",
  globe: "globe",
} as const satisfies Record<ToolStageIconName, AppIconName>;
