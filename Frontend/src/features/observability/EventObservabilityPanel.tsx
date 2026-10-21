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
      <div className="shrink-0 border-b border-line-subtle bg-surface-panel px-3">
        <TabsList variant="underline" className="h-9 w-full justify-start">
          <TabsTrigger value="diagnostic" className="h-9 flex-none rounded-none px-0 text-[11px]">
            {frontendMessage("observability.view.diagnostic")}
          </TabsTrigger>
          <TabsTrigger value="events" className="h-9 flex-none rounded-none px-0 text-[11px]">
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
