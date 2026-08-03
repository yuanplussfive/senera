import { Activity, GitBranch, Workflow, Wrench, type LucideIcon } from "lucide-react";
import type { FeedGroup, FeedItemKind } from "./feedModel";

export type FeedGroupVariant = NonNullable<FeedGroup["variant"]>;

export const FeedItemIconCatalog = {
  activity: Activity,
  tool: Wrench,
  trace: GitBranch,
} as const satisfies Record<FeedItemKind, LucideIcon>;

export const FeedGroupIconCatalog = {
  activity: Activity,
  tools: Wrench,
  delegation: Workflow,
  trace: GitBranch,
} as const satisfies Record<FeedGroupVariant, LucideIcon>;
