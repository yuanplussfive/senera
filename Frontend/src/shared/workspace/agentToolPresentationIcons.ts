import type { AgentToolPresentationIcon } from "../../../../Source/AgentSystem/Types/AgentToolPresentationTypes";
import type { AppIconName } from "../ui/AppIcon";

/**
 * The backend owns the semantic icon vocabulary. This adapter only selects
 * the corresponding product glyph, so features never infer meaning from
 * extension IDs, capabilities, or Tool names.
 */
export const AgentToolPresentationAppIcons = {
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
} as const satisfies Record<AgentToolPresentationIcon, AppIconName>;
