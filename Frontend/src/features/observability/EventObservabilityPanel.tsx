import { useState } from "react";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../shared/ui";
import { EventMonitorPanel } from "./EventMonitorPanel";
import { RuntimeDiagnosticPanel } from "./RuntimeDiagnosticPanel";

type ObservabilityView = "diagnostic" | "events";

export function EventObservabilityPanel(): JSX.Element {
  const [view, setView] = useState<ObservabilityView>("diagnostic");
  return (
    <Tabs
      value={view}
      onValueChange={(value) => setView(value as ObservabilityView)}
      className="flex h-full min-h-0 w-full flex-col"
      data-observability-workbench
    >
      <div className="shrink-0 border-b border-line-subtle bg-transparent px-3 pt-2">
        <TabsList className="h-8 w-full rounded-none border-0 bg-transparent p-0">
          <TabsTrigger
            value="diagnostic"
            className="h-8 rounded-none border-b-2 border-transparent px-2 data-[state=active]:border-accent-content data-[state=active]:bg-transparent data-[state=active]:shadow-none"
          >
            {frontendMessage("observability.view.diagnostic")}
          </TabsTrigger>
          <TabsTrigger
            value="events"
            className="h-8 rounded-none border-b-2 border-transparent px-2 data-[state=active]:border-accent-content data-[state=active]:bg-transparent data-[state=active]:shadow-none"
          >
            {frontendMessage("observability.view.events")}
          </TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="diagnostic" className="min-h-0 flex-1 overflow-hidden">
        <RuntimeDiagnosticPanel />
      </TabsContent>
      <TabsContent value="events" className="min-h-0 flex-1 overflow-hidden">
        <EventMonitorPanel />
      </TabsContent>
    </Tabs>
  );
}
