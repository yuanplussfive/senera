import { frontendMessage } from "../i18n/frontendMessageCatalog";
import { readDesktopBridge } from "./desktopBridge";
import { resolveDesktopReleaseChannel } from "./desktopReleaseChannel";

/**
 * Marks the surfaces of a development desktop build so a side-by-side production
 * window cannot be mistaken for the one the developer is running.
 */
export function DesktopReleaseChannelBadge(): JSX.Element | null {
  if (!readDesktopBridge()?.isDesktop) return null;
  if (resolveDesktopReleaseChannel(window.location.search) !== "development") return null;
  return (
    <span
      className="shrink-0 rounded-full border border-line-subtle bg-surface-panel px-1.5 py-px text-[10px] font-semibold leading-4 tracking-[0.04em] text-content-secondary"
      data-desktop-release-channel-badge
    >
      {frontendMessage("desktop.releaseChannel.development")}
    </span>
  );
}
