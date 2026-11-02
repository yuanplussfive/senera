export type DesktopReleaseChannel = "production" | "development";

/**
 * The desktop main process injects the channel into the loaded document URL. Web
 * mode never receives it, so a browser tab can never claim to be a dev build.
 */
export function resolveDesktopReleaseChannel(search: string): DesktopReleaseChannel {
  return new URLSearchParams(search).get("releaseChannel") === "development" ? "development" : "production";
}
