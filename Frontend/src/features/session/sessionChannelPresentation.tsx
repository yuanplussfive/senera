import type { EventSourceChannel } from "../../api/eventTypes";
import type { FrontendMessageKey } from "../../i18n/frontendMessageCatalog";
import { AppIcon, BrandIcon } from "../../shared/ui";

export const SessionChannelMessageKeys = {
  all: "session.channel.all",
  console: "session.channel.console",
  qq: "session.channel.qq",
  telegram: "session.channel.telegram",
  discord: "session.channel.discord",
  onebot11: "session.channel.onebot11",
  onebot: "session.channel.onebot",
} as const satisfies Record<"all" | EventSourceChannel, FrontendMessageKey>;

export function SessionChannelIcon({ channel }: { channel: EventSourceChannel }): JSX.Element {
  if (channel === "console") return <AppIcon icon="message" size={15} />;
  return <BrandIcon brand={channel === "onebot11" || channel === "onebot" ? "qq" : channel} size={15} />;
}
