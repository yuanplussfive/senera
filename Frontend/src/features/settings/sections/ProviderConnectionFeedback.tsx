import { AlertTriangle, Check, Loader2, Save } from "lucide-react";
import type { SettingsConfigCommands } from "../SettingsContracts";
import { frontendMessage } from "../../../i18n/frontendMessageCatalog";

export function ProviderConnectionStatusBadge({
  dirty,
  operation,
}: {
  dirty: boolean;
  operation?: SettingsConfigCommands["providerEndpointOperations"][string];
}): JSX.Element {
  if (operation?.status === "pending") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-sky-200 bg-sky-50 px-2 py-1 text-[11px] font-medium text-sky-700">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {frontendMessage("settings.state.saving")}
      </span>
    );
  }
  if (operation?.status === "error") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-brick-200 bg-brick-50 px-2 py-1 text-[11px] font-medium text-brick-700">
        <AlertTriangle className="h-3.5 w-3.5" />
        {frontendMessage("settings.state.saveFailed")}
      </span>
    );
  }
  if (dirty) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-ink-200 bg-paper-100 px-2 py-1 text-[11px] font-medium text-umber-600">
        <Save className="h-3.5 w-3.5" />
        {frontendMessage("settings.state.pending")}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-moss-200 bg-moss-50 px-2 py-1 text-[11px] font-medium text-moss-700">
      <Check className="h-3.5 w-3.5" />
      {frontendMessage("settings.state.synced")}
    </span>
  );
}

export function ProviderFormError({ message }: { message: string }): JSX.Element {
  return (
    <div className="mt-2 rounded-md border border-brick-200 bg-brick-50 px-3 py-2 text-[12px] leading-5 text-brick-700">
      {message}
    </div>
  );
}
