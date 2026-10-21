import type { AppIconName } from "../../shared/ui/AppIcon";
import type { FeedGroup, FeedItemKind } from "./feedModel";

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
