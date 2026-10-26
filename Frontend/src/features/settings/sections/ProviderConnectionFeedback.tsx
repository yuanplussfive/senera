import { frontendMessage } from "../../../i18n/frontendMessageCatalog";
import { InlineError, Tooltip } from "../../../shared/ui";

export function ProviderFormError({ message }: { message: string }): JSX.Element {
  return <InlineError className="mt-2">{message}</InlineError>;
}

/** Marks the provider that serves the default model instead of rendering a switch that cannot move. */
export function DefaultModelProviderTag({ reason }: { reason: string }): JSX.Element {
  return (
    <Tooltip content={reason} side="top">
      <span
        tabIndex={0}
        aria-label={`${frontendMessage("config.model.defaultBadge")} · ${reason}`}
        className="flex min-h-8 shrink-0 items-center justify-end text-[11px] font-medium text-content-muted outline-none focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-accent-border"
      >
        {frontendMessage("config.model.defaultBadge")}
      </span>
    </Tooltip>
  );
}
