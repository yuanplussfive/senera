export type DesktopReleaseChannel = "production" | "development";

/**
 * The release channel is only ever set explicitly by a launcher that knows it is
 * running a development build (`npm run desktop.live`). Anything else, including
 * an unpackaged desktop started without that launcher, stays "production" so a
 * dev marker never leaks into a shipped build.
 */
export function parseDesktopReleaseChannel(value: string | null | undefined): DesktopReleaseChannel {
  return value?.trim().toLowerCase() === "development" ? "development" : "production";
}
