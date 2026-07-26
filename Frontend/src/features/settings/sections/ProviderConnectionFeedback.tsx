import { AlertTriangle, Check, Save } from "lucide-react";
import type { SettingsConfigCommands } from "../SettingsContracts";
import { frontendMessage } from "../../../i18n/frontendMessageCatalog";
import { InlineError, Spinner } from "../../../shared/ui";

export function ProviderConnectionStatusBadge({
  dirty,
  operation,
}: {
  dirty: boolean;
  operation?: SettingsConfigCommands["providerEndpointOperations"][string];
}): JSX.Element {
  if (operation?.status === "pending") {
    return (
      <span
        role="status"
        className="inline-flex items-center gap-1.5 rounded-md border border-ink-200 bg-paper-100 px-2 py-1 text-[11px] font-medium text-ink-600"
      >
        <Spinner size="sm" />
        {frontendMessage("settings.state.saving")}
      </span>
    );
  }
  if (operation?.status === "error") {
    return (
      <span
        role="alert"
        className="inline-flex items-center gap-1.5 rounded-md border border-brick-200 bg-brick-50 px-2 py-1 text-[11px] font-medium text-brick-700"
      >
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
    <span className="inline-flex items-center gap-1.5 rounded-md border border-moss-100 bg-moss-50 px-2 py-1 text-[11px] font-medium text-moss-600">
      <Check className="h-3.5 w-3.5" />
      {frontendMessage("settings.state.synced")}
    </span>
  );
}

export function ProviderFormError({ message }: { message: string }): JSX.Element {
  return <InlineError className="mt-2">{message}</InlineError>;
}
