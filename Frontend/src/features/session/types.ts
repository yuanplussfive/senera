import { frontendMessage } from "../../i18n/frontendMessageCatalog";
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
    title: frontendMessage("settings.general.interfaceTitle"),
    items: [
      {
        id: "defaultSidebarCollapsed",
        title: frontendMessage("settings.general.sidebarCollapsedLabel"),
        description: frontendMessage("settings.general.sidebarCollapsedDescription"),
      },
      {
        id: "defaultRightPanelCollapsed",
        title: frontendMessage("settings.general.thinkingCollapsedLabel"),
        description: frontendMessage("settings.general.thinkingCollapsedDescription"),
      },
    ],
  },
] as const;

export type LayoutPreferenceId = (typeof preferenceSections)[number]["items"][number]["id"];
