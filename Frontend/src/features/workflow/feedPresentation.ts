import type { AppIconName } from "../../shared/ui/AppIcon";
import { AgentToolPresentationAppIcons } from "../../shared/workspace/agentToolPresentationIcons";
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

export const ToolStageIconCatalog = AgentToolPresentationAppIcons satisfies Record<ToolStageIconName, AppIconName>;
