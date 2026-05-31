export type ConfirmationIntent = {
  title: string;
  description: string;
  confirmLabel: string;
  tone: "danger" | "neutral";
  details: string[];
  onConfirm: () => void;
};

export type SessionAction = {
  id: string;
  label: string;
  icon: JSX.Element;
  destructive?: boolean;
  onSelect: () => void;
};

export const preferenceSections = [
  {
    id: "layout",
    title: "界面",
    items: [
      {
        id: "sidebarCollapsed",
        title: "默认收起左侧栏",
        description: "保留当前侧栏状态，并在下次打开时恢复。",
      },
      {
        id: "rightPanelCollapsed",
        title: "默认收起思维面板",
        description: "保留右侧执行图面板状态，并在下次打开时恢复。",
      },
    ],
  },
] as const;

export type LayoutPreferenceId = (typeof preferenceSections)[number]["items"][number]["id"];
