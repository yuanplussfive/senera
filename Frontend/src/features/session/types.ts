export type ConfirmationIntent = {
  title: string;
  description: string;
  confirmLabel: string;
  tone: "danger" | "neutral";
  details: string[];
  onConfirm: () => void;
};

export type SessionMenuAction = {
  id: string;
  label: string;
  icon: JSX.Element;
  destructive?: boolean;
  disabled?: boolean;
  shortcut?: string;
  onSelect: () => void;
};

export type SessionMenuSection = {
  section: string;
  items: readonly SessionMenuAction[];
};

export const preferenceSections = [
  {
    id: "layout",
    title: frontendMessage("preferences.layout.title"),
    items: [
      {
        id: "sidebarCollapsed",
        title: frontendMessage("preferences.layout.sidebarCollapsed"),
        description: frontendMessage("preferences.layout.sidebarCollapsedDescription"),
      },
      {
        id: "rightPanelCollapsed",
        title: frontendMessage("preferences.layout.rightPanelCollapsed"),
        description: frontendMessage("preferences.layout.rightPanelCollapsedDescription"),
      },
    ],
  },
] as const;

export type LayoutPreferenceId = (typeof preferenceSections)[number]["items"][number]["id"];

export const motionLevelOptions = [
  {
    id: "full",
    title: frontendMessage("preferences.motion.full"),
    description: frontendMessage("preferences.motion.fullDescription"),
  },
  {
    id: "reduced",
    title: frontendMessage("preferences.motion.reduced"),
    description: frontendMessage("preferences.motion.reducedDescription"),
  },
  {
    id: "none",
    title: frontendMessage("preferences.motion.none"),
    description: frontendMessage("preferences.motion.noneDescription"),
  },
] as const;
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
