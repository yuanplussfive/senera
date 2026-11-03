import { toast } from "sonner";
import { openFileWithDefaultApp, readDesktopBridge } from "../../app/desktopBridge";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { AppIcon, Button, IconButton } from "../ui";

/**
 * Hands a rendered resource to the operating system's default application.
 *
 * Only the desktop build can do this, so the control is absent in the browser
 * surface, where downloading stays the only way to reach a local application.
 */
export function OpenWithDefaultAppButton({
  name,
  source,
  variant = "icon",
  size = "md",
  className,
}: {
  readonly name: string;
  readonly source?: string;
  readonly variant?: "icon" | "labeled";
  readonly size?: "sm" | "md";
  readonly className?: string;
}): JSX.Element | null {
  const bridge = readDesktopBridge();
  if (!source || !bridge?.isDesktop || !bridge.openFileExternally) return null;
  const label = frontendMessage("resource.openWithDefaultApp");
  const open = (): void => {
    void openFileWithDefaultApp({ name, source }, { bridge }).then((result) => {
      if (result === "failed") toast.error(frontendMessage("resource.openWithDefaultAppFailed"));
    });
  };
  if (variant === "labeled") {
    return (
      <Button type="button" variant="outline" size="sm" className={className} onClick={open}>
        <AppIcon icon="external-link" size={14} />
        {label}
      </Button>
    );
  }
  return (
    <IconButton label={label} tooltip={label} tooltipSide="bottom" size={size} className={className} onClick={open}>
      <AppIcon icon="external-link" size={size === "md" ? 16 : 13} />
    </IconButton>
  );
}
