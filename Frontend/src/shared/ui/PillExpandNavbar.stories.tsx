import { useState } from "react";
import type { Story } from "@ladle/react";
import { AppIcon } from "./AppIcon";
import { PillExpandNavbar, type PillExpandNavbarItem } from "./PillExpandNavbar";
import { Tabs, TabsContent } from "./Tabs";

const items: readonly PillExpandNavbarItem[] = [
  { id: "execution", label: "执行", icon: <AppIcon icon="list-tree" size={15} /> },
  { id: "terminal", label: "终端", icon: <AppIcon icon="terminal" size={15} /> },
  { id: "events", label: "事件", icon: <AppIcon icon="activity" size={15} /> },
  { id: "state", label: "连续性", icon: <AppIcon icon="book-open" size={15} /> },
];

export default {
  title: "UI/PillExpandNavbar",
};

export const TabsExample: Story = () => {
  const [value, setValue] = useState("execution");
  return (
    <Tabs value={value} onValueChange={setValue} className="flex max-w-xl flex-col gap-4">
      <PillExpandNavbar
        items={items}
        value={value}
        mode="tabs"
        label="功能视图"
        attributes={{ "data-story-pill-expand-navbar": "tabs" }}
      />
      <TabsContent
        value="execution"
        className="rounded-xl border border-line-subtle p-4 text-sm text-content-secondary"
      >
        执行面板
      </TabsContent>
      <TabsContent value="terminal" className="rounded-xl border border-line-subtle p-4 text-sm text-content-secondary">
        终端面板
      </TabsContent>
      <TabsContent value="events" className="rounded-xl border border-line-subtle p-4 text-sm text-content-secondary">
        事件面板
      </TabsContent>
      <TabsContent value="state" className="rounded-xl border border-line-subtle p-4 text-sm text-content-secondary">
        连续性面板
      </TabsContent>
    </Tabs>
  );
};

export const NavigationExample: Story = () => {
  const [value, setValue] = useState("execution");
  return (
    <div className="flex max-w-xl flex-col gap-3">
      <PillExpandNavbar items={items} value={value} onValueChange={setValue} label="功能视图" />
      <p className="text-sm text-content-secondary">当前视图：{value}</p>
    </div>
  );
};
