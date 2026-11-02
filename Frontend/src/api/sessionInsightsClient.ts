import {
  AgentSessionInsightsRoute,
  type AgentSessionInsightsPage,
} from "../../../Source/AgentSystem/Session/AgentSessionInsightsContract";
import { buildHttpApiUrl } from "./httpApiUrl";

export async function readSessionInsightsPage(
  baseUrl: string,
  sessionId: string,
  options: { after?: number; through?: number; signal: AbortSignal },
): Promise<AgentSessionInsightsPage> {
  const url = new URL(buildHttpApiUrl(baseUrl, AgentSessionInsightsRoute));
  url.searchParams.set("sessionId", sessionId);
  if (options.after !== undefined) url.searchParams.set("after", String(options.after));
  if (options.through !== undefined) url.searchParams.set("through", String(options.through));
  const response = await fetch(url, {
    credentials: "include",
    headers: { Accept: "application/json" },
    signal: options.signal,
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`.trim());
  const page: AgentSessionInsightsPage = await response.json();
  if (
    page.sessionId !== sessionId ||
    !Number.isSafeInteger(page.through) ||
    !Array.isArray(page.events) ||
    (page.nextCursor !== undefined && !Number.isSafeInteger(page.nextCursor))
  )
    throw new Error("Invalid session insights response");
  return page;
}
