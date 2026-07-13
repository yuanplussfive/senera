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
    title: frontendMessage("runtime.migrated.features.session.types.28.12"),
    items: [
      {
        id: "defaultSidebarCollapsed",
        title: frontendMessage("runtime.migrated.features.session.types.32.16"),
        description: frontendMessage("runtime.migrated.features.session.types.33.22"),
      },
      {
        id: "defaultRightPanelCollapsed",
        title: frontendMessage("runtime.migrated.features.session.types.37.16"),
        description: frontendMessage("runtime.migrated.features.session.types.38.22"),
      },
    ],
  },
] as const;

export type LayoutPreferenceId = (typeof preferenceSections)[number]["items"][number]["id"];

export const motionLevelOptions = [
  {
    id: "full",
    title: frontendMessage("runtime.migrated.features.session.types.49.12"),
    description: frontendMessage("runtime.migrated.features.session.types.50.18"),
  },
  {
    id: "reduced",
    title: frontendMessage("runtime.migrated.features.session.types.54.12"),
    description: frontendMessage("runtime.migrated.features.session.types.55.18"),
  },
  {
    id: "none",
    title: frontendMessage("runtime.migrated.features.session.types.59.12"),
    description: frontendMessage("runtime.migrated.features.session.types.60.18"),
  },
] as const;
